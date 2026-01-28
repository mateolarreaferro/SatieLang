using UnityEngine;
using UnityEditor;
using Satie;

namespace Satie.Editor
{
[CustomEditor(typeof(SatieSpatialAudio))]
public class SatieSpatialAudioEditor : UnityEditor.Editor
{
    private SatieSpatialAudio spatialAudio;

    // Foldouts
    private bool showStatus = true;
    private bool showAdvancedFeatures = false;
    private bool showDefaultSettings = false;

    void OnEnable()
    {
        spatialAudio = (SatieSpatialAudio)target;
    }

    public override void OnInspectorGUI()
    {
        serializedObject.Update();

        EditorGUILayout.LabelField("Spatial Audio Configuration", EditorStyles.boldLabel);
        EditorGUILayout.Space(5);

        // Basic settings (first)
        DrawBasicSettings();

        // Default spatial settings
        DrawDefaultSettings();

        // Advanced Steam Audio features
        DrawAdvancedFeatures();

        EditorGUILayout.Space(10);
        EditorGUILayout.LabelField("", GUI.skin.horizontalSlider);
        EditorGUILayout.Space(5);

        // Status section
        DrawStatusSection();

        EditorGUILayout.Space(10);

        // Action buttons (last)
        DrawActionButtons();

        serializedObject.ApplyModifiedProperties();
    }

    private void DrawStatusSection()
    {
        showStatus = EditorGUILayout.Foldout(showStatus, "Spatial Audio Status", true);

        if (showStatus)
        {
            EditorGUI.indentLevel++;

            var status = spatialAudio.GetStatus();

            // Overall status
            string overallStatus = status.IsFullyConfigured ? "✓ Fully Configured" : "⚠ Needs Configuration";
            Color statusColor = status.IsFullyConfigured ? Color.green : Color.yellow;

            Color originalColor = GUI.color;
            GUI.color = statusColor;
            EditorGUILayout.LabelField("Overall Status:", overallStatus, EditorStyles.boldLabel);
            GUI.color = originalColor;

            EditorGUILayout.Space(3);

            // Individual status items
            DrawStatusItem("HRTF Enabled", status.useHRTF, status.useHRTF ? "Enabled" : "Disabled");
            DrawStatusItem("Steam Audio Available", status.steamAudioAvailable, status.steamAudioAvailable ? "Available" : "Not Available");
            DrawStatusItem("Steam Audio Configured", status.steamAudioConfigured, status.steamAudioConfigured ? "Configured" : "Not Configured");
            DrawStatusItem("Main Camera Found", status.mainCameraFound, status.mainCameraFound ? "Found" : "Missing");
            DrawStatusItem("Audio Listener Found", status.audioListenerFound, status.audioListenerFound ? "Found" : "Missing");

            if (!status.steamAudioAvailable && status.useHRTF)
            {
                EditorGUILayout.Space(5);
                EditorGUILayout.HelpBox(
                    "Steam Audio is not available but HRTF is enabled. To enable Steam Audio:\n" +
                    "1. Add 'STEAMAUDIO_ENABLED' to Scripting Define Symbols\n" +
                    "2. Set Project Settings > Audio > Spatializer Plugin to 'Steam Audio Spatializer'",
                    MessageType.Warning);
            }

            if (!status.IsFullyConfigured)
            {
                EditorGUILayout.Space(5);
                EditorGUILayout.HelpBox(
                    "Some spatial audio components are missing. Use the 'Setup Steam Audio' button below to automatically configure them.",
                    MessageType.Info);
            }

            EditorGUI.indentLevel--;
        }
    }

    private void DrawStatusItem(string label, bool condition, string value)
    {
        EditorGUILayout.BeginHorizontal();

        Color statusColor = condition ? Color.green : Color.red;
        string statusIcon = condition ? "✓" : "✗";

        Color originalColor = GUI.color;
        GUI.color = statusColor;
        EditorGUILayout.LabelField(statusIcon, GUILayout.Width(20));
        GUI.color = originalColor;

        EditorGUILayout.LabelField(label, GUILayout.Width(150));
        EditorGUILayout.LabelField(value, EditorStyles.miniLabel);

        EditorGUILayout.EndHorizontal();
    }

    private void DrawBasicSettings()
    {
        EditorGUILayout.LabelField("Basic Settings", EditorStyles.boldLabel);

        EditorGUILayout.PropertyField(serializedObject.FindProperty("useHRTF"),
            new GUIContent("Enable HRTF", "Use Head-Related Transfer Function for realistic 3D audio positioning"));

        EditorGUILayout.PropertyField(serializedObject.FindProperty("autoSetupSteamAudio"),
            new GUIContent("Auto Setup Steam Audio", "Automatically create Steam Audio components when needed"));

        EditorGUILayout.Space(5);
    }

    private void DrawDefaultSettings()
    {
        showDefaultSettings = EditorGUILayout.Foldout(showDefaultSettings, "Default 3D Audio Settings", true);

        if (showDefaultSettings)
        {
            EditorGUI.indentLevel++;

            SerializedProperty defaultSettings = serializedObject.FindProperty("defaultSpatialSettings");

            EditorGUILayout.PropertyField(defaultSettings.FindPropertyRelative("minDistance"),
                new GUIContent("Min Distance", "Distance where audio begins to fade"));

            EditorGUILayout.PropertyField(defaultSettings.FindPropertyRelative("maxDistance"),
                new GUIContent("Max Distance", "Distance where audio is completely silent"));

            EditorGUILayout.PropertyField(defaultSettings.FindPropertyRelative("dopplerLevel"),
                new GUIContent("Doppler Level", "Strength of doppler effect"));

            EditorGUILayout.PropertyField(defaultSettings.FindPropertyRelative("spread"),
                new GUIContent("Spread", "Spread angle for 3D sound (0 = point source, better for HRTF)"));

            EditorGUILayout.PropertyField(defaultSettings.FindPropertyRelative("rolloffMode"),
                new GUIContent("Rolloff Mode", "How audio fades with distance"));

            EditorGUI.indentLevel--;
        }

        EditorGUILayout.Space(5);
    }

    private void DrawAdvancedFeatures()
    {
        showAdvancedFeatures = EditorGUILayout.Foldout(showAdvancedFeatures, "Advanced Steam Audio Features", true);

        if (showAdvancedFeatures)
        {
            EditorGUI.indentLevel++;

            EditorGUILayout.HelpBox(
                "These features provide enhanced realism but impact performance. Enable with caution.",
                MessageType.Info);

            EditorGUILayout.PropertyField(serializedObject.FindProperty("enableOcclusion"),
                new GUIContent("Enable Occlusion", "Block sound when objects are between source and listener"));

            EditorGUILayout.PropertyField(serializedObject.FindProperty("enableTransmission"),
                new GUIContent("Enable Transmission", "Allow sound to pass through objects with attenuation"));

            EditorGUILayout.PropertyField(serializedObject.FindProperty("enableReflections"),
                new GUIContent("Enable Reflections", "Add realistic reverb based on environment geometry"));

            if (spatialAudio.EnableOcclusion || spatialAudio.EnableTransmission || spatialAudio.EnableReflections)
            {
                EditorGUILayout.Space(3);
                EditorGUILayout.HelpBox(
                    "Advanced features are enabled. Monitor performance carefully, especially with many audio sources.",
                    MessageType.Warning);
            }

            EditorGUI.indentLevel--;
        }

        EditorGUILayout.Space(5);
    }

    private void DrawActionButtons()
    {
        EditorGUILayout.LabelField("Actions", EditorStyles.boldLabel);

        EditorGUILayout.BeginHorizontal();

        if (GUILayout.Button("Setup Steam Audio", GUILayout.Height(25)))
        {
            SetupSteamAudio();
        }

        if (GUILayout.Button("Check Configuration", GUILayout.Height(25)))
        {
            CheckConfiguration();
        }

        EditorGUILayout.EndHorizontal();

        if (!spatialAudio.UseHRTF)
        {
            EditorGUILayout.Space(5);
            EditorGUILayout.HelpBox(
                "HRTF is disabled. Audio will use Unity's basic 3D positioning without advanced spatial effects.",
                MessageType.Info);
        }
    }

    private void SetupSteamAudio()
    {
        try
        {
            spatialAudio.SetupSteamAudio();

            // Refresh status
            Repaint();

            EditorUtility.DisplayDialog("Steam Audio Setup",
                "Steam Audio setup completed. Check the status section above for results.", "OK");
        }
        catch (System.Exception e)
        {
            EditorUtility.DisplayDialog("Steam Audio Setup Failed",
                $"Failed to setup Steam Audio: {e.Message}", "OK");
        }
    }

    private void CheckConfiguration()
    {
        var status = spatialAudio.GetStatus();

        string message = "Spatial Audio Configuration Report:\n\n";

        message += $"HRTF Enabled: {(status.useHRTF ? "Yes" : "No")}\n";
        message += $"Steam Audio Available: {(status.steamAudioAvailable ? "Yes" : "No")}\n";
        message += $"Steam Audio Configured: {(status.steamAudioConfigured ? "Yes" : "No")}\n";
        message += $"Main Camera Found: {(status.mainCameraFound ? "Yes" : "No")}\n";
        message += $"Audio Listener Found: {(status.audioListenerFound ? "Yes" : "No")}\n\n";

        if (status.IsFullyConfigured)
        {
            message += "✓ Configuration is complete and ready for use.";
        }
        else
        {
            message += "⚠ Configuration needs attention. See status section for details.";
        }

        EditorUtility.DisplayDialog("Configuration Check", message, "OK");
    }
}
}