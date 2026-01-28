using UnityEngine;
using UnityEditor;
using Satie;

namespace Satie.Editor
{
[CustomEditor(typeof(SatieSpeakerSetup))]
public class SatieSpeakerSetupEditor : UnityEditor.Editor
{
    private SatieSpeakerSetup speakerSetup;

    // Foldouts
    private bool showStatus = true;
    private bool showChannelMatrix = true;
    private bool showTestTones = false;
    private bool showRoutingHelp = true;

    // Styles
    private GUIStyle headerStyle;
    private GUIStyle channelBoxStyle;
    private bool stylesInitialized = false;

    void OnEnable()
    {
        speakerSetup = (SatieSpeakerSetup)target;
    }

    private void InitializeStyles()
    {
        if (stylesInitialized) return;

        headerStyle = new GUIStyle(EditorStyles.boldLabel)
        {
            fontSize = 12
        };

        channelBoxStyle = new GUIStyle(EditorStyles.helpBox)
        {
            padding = new RectOffset(8, 8, 8, 8)
        };

        stylesInitialized = true;
    }

    public override void OnInspectorGUI()
    {
        InitializeStyles();
        serializedObject.Update();

        EditorGUILayout.LabelField("Speaker Setup Configuration", EditorStyles.boldLabel);
        EditorGUILayout.Space(5);

        // Preset selection
        DrawPresetSection();

        // Status section
        DrawStatusSection();

        EditorGUILayout.Space(5);

        // Channel matrix
        DrawChannelMatrix();

        EditorGUILayout.Space(5);

        // Test tones
        DrawTestToneSection();

        EditorGUILayout.Space(5);

        // Routing help
        DrawRoutingHelpSection();

        EditorGUILayout.Space(10);

        // Action buttons
        DrawActionButtons();

        serializedObject.ApplyModifiedProperties();
    }

    private void DrawPresetSection()
    {
        EditorGUILayout.LabelField("Preset", headerStyle);

        EditorGUI.BeginChangeCheck();
        EditorGUILayout.PropertyField(serializedObject.FindProperty("activePreset"),
            new GUIContent("Active Preset", "The speaker configuration to use"));

        if (EditorGUI.EndChangeCheck())
        {
            serializedObject.ApplyModifiedProperties();
        }

        EditorGUILayout.PropertyField(serializedObject.FindProperty("applyOnStart"),
            new GUIContent("Apply On Start", "Automatically apply this preset when the game starts"));

        // Quick preset buttons
        EditorGUILayout.Space(3);
        EditorGUILayout.BeginHorizontal();
        EditorGUILayout.LabelField("Quick Switch:", GUILayout.Width(80));

        if (GUILayout.Button("Stereo", GUILayout.Height(20)))
        {
            SwitchToMode(SpeakerMode.Stereo);
        }
        if (GUILayout.Button("Quad", GUILayout.Height(20)))
        {
            SwitchToMode(SpeakerMode.Quad);
        }
        if (GUILayout.Button("5.1", GUILayout.Height(20)))
        {
            SwitchToMode(SpeakerMode.Surround51);
        }
        if (GUILayout.Button("7.1", GUILayout.Height(20)))
        {
            SwitchToMode(SpeakerMode.Surround71);
        }

        EditorGUILayout.EndHorizontal();

        EditorGUILayout.Space(5);
    }

    private void DrawStatusSection()
    {
        showStatus = EditorGUILayout.Foldout(showStatus, "Status", true);

        if (showStatus)
        {
            EditorGUI.indentLevel++;

            var status = speakerSetup.GetStatus();

            // Overall status
            string overallStatus = status.IsConfigured ? "Configured" : "Needs Attention";
            Color statusColor = status.IsConfigured ? Color.green : Color.yellow;

            Color originalColor = GUI.color;
            GUI.color = statusColor;
            EditorGUILayout.LabelField("Overall:", overallStatus, EditorStyles.boldLabel);
            GUI.color = originalColor;

            EditorGUILayout.Space(3);

            // Status items
            DrawStatusItem("Preset Loaded", status.hasPreset, status.presetName);
            DrawStatusItem("Speaker Mode Match", status.speakerModeMatches,
                status.speakerModeMatches ? "OK" : $"Preset: {status.presetSpeakerMode}, Unity: {status.unitySpeakerMode}");
            DrawStatusItem("Channels", true, $"{status.channelCount} configured");
            DrawStatusItem("Sample Rate", true, $"{status.sampleRate} Hz");
            DrawStatusItem("DSP Buffer", true, $"{status.dspBufferSize} samples");

            if (!status.speakerModeMatches && status.hasPreset)
            {
                EditorGUILayout.Space(3);
                EditorGUILayout.HelpBox(
                    $"Unity's speaker mode ({status.unitySpeakerMode}) doesn't match the preset ({status.presetSpeakerMode}). " +
                    "Click 'Apply Preset' to fix this.",
                    MessageType.Warning);
            }

            EditorGUI.indentLevel--;
        }
    }

    private void DrawStatusItem(string label, bool condition, string value)
    {
        EditorGUILayout.BeginHorizontal();

        Color statusColor = condition ? Color.green : Color.red;
        string statusIcon = condition ? "\u2713" : "\u2717";

        Color originalColor = GUI.color;
        GUI.color = statusColor;
        EditorGUILayout.LabelField(statusIcon, GUILayout.Width(20));
        GUI.color = originalColor;

        EditorGUILayout.LabelField(label, GUILayout.Width(120));
        EditorGUILayout.LabelField(value, EditorStyles.miniLabel);

        EditorGUILayout.EndHorizontal();
    }

    private void DrawChannelMatrix()
    {
        showChannelMatrix = EditorGUILayout.Foldout(showChannelMatrix, "Channel Routing Matrix", true);

        if (showChannelMatrix)
        {
            var preset = speakerSetup.ActivePreset;

            if (preset == null)
            {
                EditorGUILayout.HelpBox("No preset selected. Create or assign a Speaker Preset to configure channels.", MessageType.Info);
                return;
            }

            EditorGUI.indentLevel++;

            // Header row
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField("Channel", EditorStyles.boldLabel, GUILayout.Width(120));
            EditorGUILayout.LabelField("Unity", EditorStyles.boldLabel, GUILayout.Width(50));
            EditorGUILayout.LabelField("Output", EditorStyles.boldLabel, GUILayout.Width(60));
            EditorGUILayout.LabelField("Status", EditorStyles.boldLabel, GUILayout.Width(60));
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.LabelField("", GUI.skin.horizontalSlider);

            // Channel rows
            foreach (var channel in preset.channels)
            {
                DrawChannelRow(channel);
            }

            EditorGUI.indentLevel--;

            EditorGUILayout.Space(3);

            if (GUILayout.Button("Edit Preset", GUILayout.Height(22)))
            {
                Selection.activeObject = preset;
            }
        }
    }

    private void DrawChannelRow(SpeakerChannel channel)
    {
        EditorGUILayout.BeginHorizontal();

        // Channel name with color
        Color channelColor = GetChannelColor(channel.role);
        Color originalBg = GUI.backgroundColor;
        GUI.backgroundColor = channelColor;

        EditorGUILayout.LabelField(channel.GetDisplayName(), GUILayout.Width(120));

        GUI.backgroundColor = originalBg;

        // Unity channel
        EditorGUILayout.LabelField($"Ch {channel.GetUnityChannel()}", GUILayout.Width(50));

        // Hardware output
        EditorGUILayout.LabelField($"Out {channel.hardwareOutput}", GUILayout.Width(60));

        // Status
        string statusIcon = channel.enabled ? "\u2713" : "\u2717";
        Color statusColor = channel.enabled ? Color.green : Color.gray;
        Color originalColor = GUI.color;
        GUI.color = statusColor;
        EditorGUILayout.LabelField(statusIcon, GUILayout.Width(60));
        GUI.color = originalColor;

        EditorGUILayout.EndHorizontal();
    }

    private Color GetChannelColor(ChannelRole role)
    {
        return role switch
        {
            ChannelRole.Left => new Color(0.8f, 0.9f, 1f),
            ChannelRole.Right => new Color(1f, 0.9f, 0.8f),
            ChannelRole.Center => new Color(0.9f, 1f, 0.9f),
            ChannelRole.Subwoofer => new Color(1f, 0.85f, 0.85f),
            ChannelRole.LeftSurround => new Color(0.85f, 0.85f, 1f),
            ChannelRole.RightSurround => new Color(1f, 0.95f, 0.85f),
            ChannelRole.LeftBack => new Color(0.8f, 0.8f, 0.95f),
            ChannelRole.RightBack => new Color(0.95f, 0.9f, 0.8f),
            _ => Color.white
        };
    }

    private void DrawTestToneSection()
    {
        showTestTones = EditorGUILayout.Foldout(showTestTones, "Test Tones", true);

        if (showTestTones)
        {
            EditorGUI.indentLevel++;

            // Test tone settings
            EditorGUILayout.PropertyField(serializedObject.FindProperty("testToneFrequency"),
                new GUIContent("Frequency (Hz)", "Test tone frequency"));
            EditorGUILayout.PropertyField(serializedObject.FindProperty("testToneDuration"),
                new GUIContent("Duration (s)", "How long each test tone plays"));
            EditorGUILayout.PropertyField(serializedObject.FindProperty("testToneVolume"),
                new GUIContent("Volume", "Test tone volume"));

            EditorGUILayout.Space(5);

            var preset = speakerSetup.ActivePreset;

            if (preset != null && Application.isPlaying)
            {
                EditorGUILayout.LabelField("Test Individual Channels:", EditorStyles.miniLabel);

                EditorGUILayout.BeginHorizontal();

                int buttonsPerRow = 3;
                int buttonCount = 0;

                foreach (var channel in preset.channels)
                {
                    if (!channel.enabled) continue;

                    if (buttonCount > 0 && buttonCount % buttonsPerRow == 0)
                    {
                        EditorGUILayout.EndHorizontal();
                        EditorGUILayout.BeginHorizontal();
                    }

                    string buttonLabel = $"{channel.role}\n(Out {channel.hardwareOutput})";
                    if (GUILayout.Button(buttonLabel, GUILayout.Height(35), GUILayout.MinWidth(80)))
                    {
                        speakerSetup.PlayTestTone(channel.role);
                    }

                    buttonCount++;
                }

                EditorGUILayout.EndHorizontal();

                EditorGUILayout.Space(5);

                EditorGUILayout.BeginHorizontal();

                if (GUILayout.Button("Walk All Channels", GUILayout.Height(25)))
                {
                    speakerSetup.WalkThroughAllChannels();
                }

                if (GUILayout.Button("Stop", GUILayout.Height(25), GUILayout.Width(60)))
                {
                    speakerSetup.StopTestTone();
                }

                EditorGUILayout.EndHorizontal();
            }
            else if (!Application.isPlaying)
            {
                EditorGUILayout.HelpBox("Enter Play Mode to test speaker channels.", MessageType.Info);
            }
            else
            {
                EditorGUILayout.HelpBox("Select a preset to enable test tones.", MessageType.Info);
            }

            EditorGUI.indentLevel--;
        }
    }

    private void DrawRoutingHelpSection()
    {
        showRoutingHelp = EditorGUILayout.Foldout(showRoutingHelp, "External Routing Instructions", true);

        if (showRoutingHelp)
        {
            EditorGUI.indentLevel++;

            string instructions = speakerSetup.GetRoutingInstructions();

            EditorGUILayout.BeginVertical(channelBoxStyle);
            EditorGUILayout.LabelField(instructions, EditorStyles.wordWrappedMiniLabel);
            EditorGUILayout.EndVertical();

            if (GUILayout.Button("Copy to Clipboard", GUILayout.Height(20)))
            {
                GUIUtility.systemCopyBuffer = instructions;
                Debug.Log("[SatieSpeakerSetup] Routing instructions copied to clipboard");
            }

            EditorGUI.indentLevel--;
        }
    }

    private void DrawActionButtons()
    {
        EditorGUILayout.LabelField("Actions", headerStyle);

        EditorGUILayout.BeginHorizontal();

        if (GUILayout.Button("Apply Preset", GUILayout.Height(25)))
        {
            if (speakerSetup.ActivePreset != null)
            {
                speakerSetup.ApplyPreset(speakerSetup.ActivePreset);
                Repaint();
            }
            else
            {
                EditorUtility.DisplayDialog("No Preset",
                    "Please assign a Speaker Preset first.", "OK");
            }
        }

        if (GUILayout.Button("Create New Preset", GUILayout.Height(25)))
        {
            CreateNewPreset();
        }

        EditorGUILayout.EndHorizontal();

        EditorGUILayout.BeginHorizontal();

        if (GUILayout.Button("Open Audio Settings", GUILayout.Height(22)))
        {
            SettingsService.OpenProjectSettings("Project/Audio");
        }

        if (GUILayout.Button("Refresh Status", GUILayout.Height(22)))
        {
            Repaint();
        }

        EditorGUILayout.EndHorizontal();
    }

    private void SwitchToMode(SpeakerMode mode)
    {
        // Check if we have a preset for this mode
        string[] guids = AssetDatabase.FindAssets("t:SatieSpeakerPreset");

        foreach (string guid in guids)
        {
            string path = AssetDatabase.GUIDToAssetPath(guid);
            var preset = AssetDatabase.LoadAssetAtPath<SatieSpeakerPreset>(path);

            if (preset != null && preset.speakerMode == mode)
            {
                serializedObject.FindProperty("activePreset").objectReferenceValue = preset;
                serializedObject.ApplyModifiedProperties();

                if (Application.isPlaying)
                {
                    speakerSetup.ApplyPreset(preset);
                }

                Repaint();
                return;
            }
        }

        // No preset found, offer to create one
        if (EditorUtility.DisplayDialog("No Preset Found",
            $"No preset found for {mode}. Would you like to create one?", "Create", "Cancel"))
        {
            CreatePresetForMode(mode);
        }
    }

    private void CreateNewPreset()
    {
        // Show a menu to choose the speaker mode
        GenericMenu menu = new GenericMenu();
        menu.AddItem(new GUIContent("Stereo"), false, () => CreatePresetForMode(SpeakerMode.Stereo));
        menu.AddItem(new GUIContent("Quad"), false, () => CreatePresetForMode(SpeakerMode.Quad));
        menu.AddItem(new GUIContent("5.1 Surround"), false, () => CreatePresetForMode(SpeakerMode.Surround51));
        menu.AddItem(new GUIContent("7.1 Surround"), false, () => CreatePresetForMode(SpeakerMode.Surround71));
        menu.ShowAsContext();
    }

    private void CreatePresetForMode(SpeakerMode mode)
    {
        string path = EditorUtility.SaveFilePanelInProject(
            "Save Speaker Preset",
            $"{mode}Preset",
            "asset",
            "Choose a location for the new speaker preset");

        if (string.IsNullOrEmpty(path)) return;

        var preset = ScriptableObject.CreateInstance<SatieSpeakerPreset>();
        preset.presetName = System.IO.Path.GetFileNameWithoutExtension(path);
        preset.speakerMode = mode;
        preset.InitializeDefaultChannels();

        AssetDatabase.CreateAsset(preset, path);
        AssetDatabase.SaveAssets();

        // Assign to the setup
        serializedObject.FindProperty("activePreset").objectReferenceValue = preset;
        serializedObject.ApplyModifiedProperties();

        Selection.activeObject = preset;

        Debug.Log($"[SatieSpeakerSetup] Created new preset: {path}");
    }
}
}
