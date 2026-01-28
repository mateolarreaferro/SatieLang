using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEditor;
using Satie;

namespace Satie.Editor
{
[CustomEditor(typeof(SatieRuntime))]
public class SatieRuntimeEditor : UnityEditor.Editor
{
    private SatieRuntime runtime;
    private SerializedProperty scriptFileProp;
    private SerializedProperty mixerGroupsProp;
    private SerializedProperty masterVolumeProp;
    private SerializedProperty masterMuteProp;

    // DSP Timing properties
    private SerializedProperty randomSeedProp;

    // Component management
    private bool showComponentSetup = false;
    private bool hasAICodeGen = false;
    private bool hasAudioGen = false;
    private bool hasSpatialAudio = false;

    // UI state
    private bool showScriptPreview = false;
    private bool showMixer = true;
    private bool showGroups = true;
    private bool showAllTracks = false;
    private Vector2 mixerScrollPos;
    private Vector2 tracksScrollPos;

    // UI styles
    private GUIStyle headerStyle;
    private GUIStyle previewStyle;
    private GUIStyle trackHeaderStyle;
    private GUIStyle mixerChannelStyle;
    private GUIStyle soloButtonStyle;
    private GUIStyle muteButtonStyle;

    // Colors
    private Color soloColor = new Color(1f, 0.8f, 0f);
    private Color muteColor = new Color(0.8f, 0.2f, 0.2f);
    private Color activeColor = new Color(0.2f, 0.8f, 0.2f);

    void OnEnable()
    {
        runtime = (SatieRuntime)target;
        scriptFileProp = serializedObject.FindProperty("scriptFile");
        mixerGroupsProp = serializedObject.FindProperty("mixerGroups");
        masterVolumeProp = serializedObject.FindProperty("masterVolume");
        masterMuteProp = serializedObject.FindProperty("masterMute");

        // DSP Timing properties
        randomSeedProp = serializedObject.FindProperty("randomSeed");

        CheckComponents();
        EditorApplication.update += OnEditorUpdate;
    }

    void OnDisable()
    {
        EditorApplication.update -= OnEditorUpdate;
    }

    void OnEditorUpdate()
    {
        if (Application.isPlaying)
        {
            // Repaint during play mode to show live track info
            Repaint();
        }
    }

    public override void OnInspectorGUI()
    {
        serializedObject.Update();
        InitStyles();

        DrawHeader();
        DrawScriptConfiguration();

        // DSP Timing section (NEW!)
        DrawDSPTiming();

        if (runtime.ScriptFile != null)
        {
            DrawScriptPreview();
        }

        // DAW-style mixer (only in play mode or if groups are configured)
        if (Application.isPlaying || mixerGroupsProp.arraySize > 0)
        {
            DrawMixer();
        }

        DrawComponentSetup();

        serializedObject.ApplyModifiedProperties();
    }

    private void InitStyles()
    {
        if (headerStyle == null)
        {
            headerStyle = new GUIStyle(EditorStyles.boldLabel)
            {
                fontSize = 14,
                normal = { textColor = EditorGUIUtility.isProSkin ? Color.white : Color.black }
            };
        }

        if (previewStyle == null)
        {
            previewStyle = new GUIStyle(EditorStyles.textArea)
            {
                wordWrap = false,
                fontSize = 11,
                fontStyle = FontStyle.Normal
            };
        }

        if (trackHeaderStyle == null)
        {
            trackHeaderStyle = new GUIStyle(EditorStyles.miniLabel)
            {
                fontSize = 9,
                alignment = TextAnchor.MiddleLeft,
                normal = { textColor = Color.gray }
            };
        }

        if (mixerChannelStyle == null)
        {
            mixerChannelStyle = new GUIStyle(EditorStyles.helpBox)
            {
                padding = new RectOffset(5, 5, 5, 5),
                margin = new RectOffset(2, 2, 2, 2)
            };
        }

        if (soloButtonStyle == null)
        {
            soloButtonStyle = new GUIStyle(EditorStyles.miniButton)
            {
                fontStyle = FontStyle.Bold,
                fontSize = 9
            };
        }

        if (muteButtonStyle == null)
        {
            muteButtonStyle = new GUIStyle(EditorStyles.miniButton)
            {
                fontStyle = FontStyle.Bold,
                fontSize = 9
            };
        }
    }

    private void DrawHeader()
    {
        EditorGUILayout.LabelField("Satie Runtime", headerStyle);
        EditorGUILayout.LabelField("Executes .sp scripts with spatial audio support", EditorStyles.miniLabel);
        EditorGUILayout.Space(10);
    }

    private void DrawScriptConfiguration()
    {
        EditorGUILayout.LabelField("Script Configuration", EditorStyles.boldLabel);
        EditorGUILayout.PropertyField(scriptFileProp, new GUIContent("Script File (.sp)"));

        if (runtime.ScriptFile == null)
        {
            EditorGUILayout.HelpBox(
                "Assign a .sp script file to execute. You can generate scripts using the AI Code Generation component.",
                MessageType.Info);
        }

        EditorGUILayout.Space(5);
    }

    private void DrawDSPTiming()
    {
        EditorGUILayout.Space(5);
        EditorGUILayout.PropertyField(randomSeedProp,
            new GUIContent("Random Seed", "Seed for reproducible renders (0 = time-based)"));
        EditorGUILayout.Space(5);
    }

    private void DrawScriptPreview()
    {
        showScriptPreview = EditorGUILayout.Foldout(showScriptPreview, "Script Preview", true);

        if (showScriptPreview)
        {
            EditorGUI.indentLevel++;

            string scriptContent = runtime.ScriptFile.text;
            string[] lines = scriptContent.Split('\n');

            EditorGUILayout.LabelField($"Lines: {lines.Length}", EditorStyles.miniLabel);

            EditorGUILayout.BeginVertical("box");
            Vector2 scrollPos = Vector2.zero;
            scrollPos = EditorGUILayout.BeginScrollView(scrollPos, GUILayout.MaxHeight(150));
            EditorGUILayout.TextArea(scriptContent, previewStyle);
            EditorGUILayout.EndScrollView();
            EditorGUILayout.EndVertical();

            EditorGUI.indentLevel--;
        }
    }

    private void DrawMixer()
    {
        EditorGUILayout.Space(10);

        // Mixer header with track count
        EditorGUILayout.BeginHorizontal();
        string mixerTitle = Application.isPlaying
            ? $"🎚 DAW Mixer ({runtime.GetTrackCount()} active tracks)"
            : "🎚 DAW Mixer (Edit Mode)";

        showMixer = EditorGUILayout.Foldout(showMixer, mixerTitle, true, EditorStyles.foldoutHeader);

        if (Application.isPlaying)
        {
            if (GUILayout.Button("Refresh", EditorStyles.miniButton, GUILayout.Width(60)))
            {
                Repaint();
            }
        }
        EditorGUILayout.EndHorizontal();

        if (!showMixer) return;

        EditorGUILayout.BeginVertical(EditorStyles.helpBox);

        // Master channel
        DrawMasterChannel();

        EditorGUILayout.Space(5);
        EditorGUILayout.LabelField("", GUI.skin.horizontalSlider);
        EditorGUILayout.Space(5);

        // Mixer groups
        DrawMixerGroups();

        EditorGUILayout.Space(5);
        EditorGUILayout.LabelField("", GUI.skin.horizontalSlider);
        EditorGUILayout.Space(5);

        // All tracks (ungrouped or detailed view)
        if (Application.isPlaying)
        {
            DrawAllTracks();
        }

        EditorGUILayout.EndVertical();
    }

    private void DrawMasterChannel()
    {
        EditorGUILayout.BeginVertical(mixerChannelStyle);

        // Master label
        EditorGUILayout.LabelField("MASTER", EditorStyles.boldLabel);

        EditorGUILayout.BeginHorizontal();

        // Mute button
        GUI.backgroundColor = masterMuteProp.boolValue ? muteColor : Color.white;
        if (GUILayout.Button("M", muteButtonStyle, GUILayout.Width(30), GUILayout.Height(20)))
        {
            masterMuteProp.boolValue = !masterMuteProp.boolValue;
            if (Application.isPlaying)
                runtime.SetMasterMute(masterMuteProp.boolValue);
        }
        GUI.backgroundColor = Color.white;

        // Volume slider
        EditorGUI.BeginChangeCheck();
        float newMasterVol = EditorGUILayout.Slider(masterVolumeProp.floatValue, 0f, 1f);
        if (EditorGUI.EndChangeCheck())
        {
            masterVolumeProp.floatValue = newMasterVol;
            if (Application.isPlaying)
                runtime.SetMasterVolume(newMasterVol);
        }

        // Volume label
        EditorGUILayout.LabelField($"{(newMasterVol * 100):F0}%", GUILayout.Width(40));

        EditorGUILayout.EndHorizontal();

        EditorGUILayout.EndVertical();
    }

    private void DrawMixerGroups()
    {
        EditorGUILayout.BeginHorizontal();
        showGroups = EditorGUILayout.Foldout(showGroups, "Mixer Groups", true, EditorStyles.foldout);

        if (GUILayout.Button("+", EditorStyles.miniButton, GUILayout.Width(25)))
        {
            runtime.AddMixerGroup($"Group {mixerGroupsProp.arraySize + 1}");
            EditorUtility.SetDirty(runtime);
        }
        EditorGUILayout.EndHorizontal();

        if (!showGroups) return;

        EditorGUI.indentLevel++;

        if (mixerGroupsProp.arraySize == 0)
        {
            EditorGUILayout.HelpBox("No mixer groups. Click + to add a group for organizing tracks.", MessageType.Info);
        }
        else
        {
            mixerScrollPos = EditorGUILayout.BeginScrollView(mixerScrollPos, GUILayout.MaxHeight(300));

            for (int i = 0; i < mixerGroupsProp.arraySize; i++)
            {
                DrawMixerGroup(i);
            }

            EditorGUILayout.EndScrollView();
        }

        EditorGUI.indentLevel--;
    }

    private void DrawMixerGroup(int index)
    {
        var groupProp = mixerGroupsProp.GetArrayElementAtIndex(index);
        var nameProp = groupProp.FindPropertyRelative("name");
        var colorProp = groupProp.FindPropertyRelative("color");
        var soloProp = groupProp.FindPropertyRelative("solo");
        var muteProp = groupProp.FindPropertyRelative("mute");
        var volumeProp = groupProp.FindPropertyRelative("volume");
        var collapsedProp = groupProp.FindPropertyRelative("collapsed");
        var clipPatternsProp = groupProp.FindPropertyRelative("clipNamePatterns");
        var kindFiltersProp = groupProp.FindPropertyRelative("kindFilters");

        // Get actual group object for track counting
        var group = runtime.GetMixerGroups()[index];
        int trackCount = 0;
        if (Application.isPlaying)
        {
            trackCount = group.GetTracks(runtime.GetTrackManager()).Count();
        }

        // Channel strip background
        var originalBg = GUI.backgroundColor;
        GUI.backgroundColor = colorProp.colorValue * 0.3f;
        EditorGUILayout.BeginVertical(mixerChannelStyle);
        GUI.backgroundColor = originalBg;

        // Header with fold and delete
        EditorGUILayout.BeginHorizontal();

        // Foldout for collapsing groups
        GUILayout.Space(5);
        collapsedProp.boolValue = !EditorGUILayout.Foldout(!collapsedProp.boolValue, "", true);

        EditorGUI.BeginChangeCheck();
        nameProp.stringValue = EditorGUILayout.TextField(nameProp.stringValue, EditorStyles.boldLabel);
        if (EditorGUI.EndChangeCheck())
        {
            EditorUtility.SetDirty(runtime);
        }

        if (Application.isPlaying)
        {
            EditorGUILayout.LabelField($"({trackCount})", EditorStyles.miniLabel, GUILayout.Width(30));
        }

        if (GUILayout.Button("×", EditorStyles.miniButton, GUILayout.Width(20)))
        {
            runtime.RemoveMixerGroup(group);
            EditorUtility.SetDirty(runtime);
            return;
        }

        EditorGUILayout.EndHorizontal();

        if (!collapsedProp.boolValue)
        {
            // Solo and Mute buttons
            EditorGUILayout.BeginHorizontal();

            GUI.backgroundColor = soloProp.boolValue ? soloColor : Color.white;
            if (GUILayout.Button("S", soloButtonStyle, GUILayout.Width(30), GUILayout.Height(20)))
            {
                soloProp.boolValue = !soloProp.boolValue;
                if (Application.isPlaying)
                    runtime.ApplyMixerGroups();
            }
            GUI.backgroundColor = Color.white;

            GUI.backgroundColor = muteProp.boolValue ? muteColor : Color.white;
            if (GUILayout.Button("M", muteButtonStyle, GUILayout.Width(30), GUILayout.Height(20)))
            {
                muteProp.boolValue = !muteProp.boolValue;
                if (Application.isPlaying)
                    runtime.ApplyMixerGroups();
            }
            GUI.backgroundColor = Color.white;

            // Volume slider
            EditorGUI.BeginChangeCheck();
            float newVol = EditorGUILayout.Slider(volumeProp.floatValue, 0f, 1f);
            if (EditorGUI.EndChangeCheck())
            {
                volumeProp.floatValue = newVol;
                if (Application.isPlaying)
                    runtime.ApplyMixerGroups();
            }

            EditorGUILayout.LabelField($"{(newVol * 100):F0}%", GUILayout.Width(40));

            EditorGUILayout.EndHorizontal();

            // Color picker
            EditorGUILayout.PropertyField(colorProp, new GUIContent("Color"));

            // Track matching patterns
            EditorGUILayout.LabelField("Track Matching", EditorStyles.miniBoldLabel);
            EditorGUI.indentLevel++;

            EditorGUILayout.PropertyField(clipPatternsProp, new GUIContent("Clip Name Contains"), true);
            EditorGUILayout.PropertyField(kindFiltersProp, new GUIContent("Kind Filter (loop/oneshot)"), true);

            EditorGUI.indentLevel--;

            // Show tracks in this group (play mode only)
            if (Application.isPlaying && trackCount > 0)
            {
                EditorGUILayout.LabelField($"Tracks ({trackCount}):", EditorStyles.miniLabel);
                EditorGUI.indentLevel++;
                foreach (var track in group.GetTracks(runtime.GetTrackManager()))
                {
                    EditorGUILayout.LabelField($"• {track.Statement.clip} ({track.Statement.kind})", trackHeaderStyle);
                }
                EditorGUI.indentLevel--;
            }
        }

        EditorGUILayout.EndVertical();
        EditorGUILayout.Space(3);
    }

    private void DrawAllTracks()
    {
        EditorGUILayout.BeginHorizontal();
        showAllTracks = EditorGUILayout.Foldout(showAllTracks, "All Active Tracks", true, EditorStyles.foldout);
        EditorGUILayout.EndHorizontal();

        if (!showAllTracks) return;

        EditorGUI.indentLevel++;

        var tracks = runtime.GetAllTracks().ToList();

        if (tracks.Count == 0)
        {
            EditorGUILayout.HelpBox("No active tracks. Press Play in the scene to see active tracks.", MessageType.Info);
        }
        else
        {
            tracksScrollPos = EditorGUILayout.BeginScrollView(tracksScrollPos, GUILayout.MaxHeight(200));

            foreach (var track in tracks)
            {
                DrawTrackChannel(track);
            }

            EditorGUILayout.EndScrollView();
        }

        EditorGUI.indentLevel--;
    }

    private void DrawTrackChannel(SatieTrack track)
    {
        EditorGUILayout.BeginVertical(mixerChannelStyle);

        // Track info header
        EditorGUILayout.BeginHorizontal();

        string playingIndicator = track.IsPlaying ? "▶" : "▢";
        Color indicatorColor = track.IsPlaying ? activeColor : Color.gray;

        var oldColor = GUI.color;
        GUI.color = indicatorColor;
        EditorGUILayout.LabelField(playingIndicator, GUILayout.Width(15));
        GUI.color = oldColor;

        EditorGUILayout.LabelField($"{track.Statement.clip}", EditorStyles.boldLabel);
        EditorGUILayout.LabelField($"({track.Statement.kind})", EditorStyles.miniLabel, GUILayout.Width(60));

        if (GUILayout.Button("Stop", EditorStyles.miniButton, GUILayout.Width(50)))
        {
            runtime.StopTrack(track.Key);
        }

        EditorGUILayout.EndHorizontal();

        // Track controls
        EditorGUILayout.BeginHorizontal();

        bool isMuted = track.Sources.Count > 0 ? track.Sources[0].mute : false;
        GUI.backgroundColor = isMuted ? muteColor : Color.white;
        if (GUILayout.Button("M", muteButtonStyle, GUILayout.Width(30), GUILayout.Height(18)))
        {
            runtime.SetTrackMute(track.Key, !isMuted);
        }
        GUI.backgroundColor = Color.white;

        // Volume control
        float currentVol = track.Sources.Count > 0 ? track.Sources[0].volume : 1f;
        float newVol = EditorGUILayout.Slider(currentVol, 0f, 1f);
        if (Math.Abs(newVol - currentVol) > 0.001f)
        {
            runtime.SetTrackVolume(track.Key, newVol);
        }

        EditorGUILayout.LabelField($"{(newVol * 100):F0}%", GUILayout.Width(40));

        EditorGUILayout.EndHorizontal();

        // Track details
        EditorGUILayout.LabelField($"Key: {track.Key}", trackHeaderStyle);
        EditorGUILayout.LabelField($"Sources: {track.Sources.Count} | Persistent: {track.IsPersistent}", trackHeaderStyle);

        EditorGUILayout.EndVertical();
        EditorGUILayout.Space(2);
    }

    private void DrawComponentSetup()
    {
        EditorGUILayout.Space(10);
        Color bgColor = GUI.backgroundColor;

        // Check if any components are missing
        bool anyMissing = !hasAICodeGen || !hasAudioGen || !hasSpatialAudio;

        if (anyMissing)
        {
            GUI.backgroundColor = new Color(1f, 0.8f, 0.2f, 0.3f);
        }
        else
        {
            GUI.backgroundColor = new Color(0.2f, 0.8f, 0.2f, 0.3f);
        }

        EditorGUILayout.BeginVertical(EditorStyles.helpBox);
        GUI.backgroundColor = bgColor;

        showComponentSetup = EditorGUILayout.Foldout(showComponentSetup,
            anyMissing ? "⚠ Component Setup (Missing Components)" : "✓ Component Setup (Complete)", true);

        if (showComponentSetup)
        {
            EditorGUI.indentLevel++;

            DrawComponentStatus("AI Code Generation", hasAICodeGen, typeof(Satie.AI.SatieAgentOrchestrator));
            DrawComponentStatus("Audio Generation", hasAudioGen, typeof(SatieAudioGen));
            DrawComponentStatus("Spatial Audio", hasSpatialAudio, typeof(SatieSpatialAudio));

            if (anyMissing)
            {
                EditorGUILayout.Space(5);
                EditorGUILayout.HelpBox(
                    "For full functionality, add the missing components above.",
                    MessageType.Info);

                if (GUILayout.Button("Add All Missing Components", GUILayout.Height(25)))
                {
                    AddMissingComponents();
                }
            }

            EditorGUI.indentLevel--;
        }

        EditorGUILayout.EndVertical();
    }

    private void DrawComponentStatus(string componentName, bool hasComponent, System.Type componentType)
    {
        EditorGUILayout.BeginHorizontal();

        string statusIcon = hasComponent ? "✓" : "✗";
        Color statusColor = hasComponent ? Color.green : Color.red;

        Color originalColor = GUI.color;
        GUI.color = statusColor;
        EditorGUILayout.LabelField(statusIcon, GUILayout.Width(20));
        GUI.color = originalColor;

        EditorGUILayout.LabelField(componentName, GUILayout.ExpandWidth(true));

        if (!hasComponent)
        {
            if (GUILayout.Button("Add", GUILayout.Width(50)))
            {
                runtime.gameObject.AddComponent(componentType);
                CheckComponents();
            }
        }
        else
        {
            EditorGUILayout.LabelField("Present", EditorStyles.miniLabel, GUILayout.Width(50));
        }

        EditorGUILayout.EndHorizontal();
    }

    private void CheckComponents()
    {
        if (runtime == null) return;

        hasAICodeGen = runtime.GetComponent<Satie.AI.SatieAgentOrchestrator>() != null;
        hasAudioGen = runtime.GetComponent<SatieAudioGen>() != null;
        hasSpatialAudio = runtime.GetComponent<SatieSpatialAudio>() != null;
    }

    private void AddMissingComponents()
    {
        if (!hasAICodeGen)
        {
            runtime.gameObject.AddComponent<Satie.AI.SatieAgentOrchestrator>();
            Debug.Log("[Satie] Added SatieAgentOrchestrator component");
        }

        if (!hasAudioGen)
        {
            runtime.gameObject.AddComponent<SatieAudioGen>();
            Debug.Log("[Satie] Added SatieAudioGen component");
        }

        if (!hasSpatialAudio)
        {
            runtime.gameObject.AddComponent<SatieSpatialAudio>();
            Debug.Log("[Satie] Added SatieSpatialAudio component");
        }

        CheckComponents();
        EditorUtility.SetDirty(runtime);
    }
}
}
