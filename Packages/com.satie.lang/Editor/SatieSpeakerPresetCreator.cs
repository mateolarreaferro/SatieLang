using UnityEngine;
using UnityEditor;
using Satie;
using System.IO;

namespace Satie.Editor
{
/// <summary>
/// Editor utility to create default speaker presets for SatieLang
/// </summary>
public static class SatieSpeakerPresetCreator
{
    private const string PresetFolder = "Assets/Resources/SpeakerPresets";

    [MenuItem("Satie/Create Default Speaker Presets")]
    public static void CreateDefaultPresets()
    {
        // Ensure folder exists
        if (!AssetDatabase.IsValidFolder(PresetFolder))
        {
            string parentFolder = Path.GetDirectoryName(PresetFolder).Replace("\\", "/");
            string folderName = Path.GetFileName(PresetFolder);

            if (!AssetDatabase.IsValidFolder(parentFolder))
            {
                AssetDatabase.CreateFolder("Assets", "Resources");
            }
            AssetDatabase.CreateFolder(parentFolder, folderName);
        }

        // Create presets
        CreateStereoPreset();
        CreateQuadCustomPreset();
        CreateSurround51Preset();
        CreateSurround51CustomPreset();
        CreateSurround71Preset();

        AssetDatabase.SaveAssets();
        AssetDatabase.Refresh();

        Debug.Log("[Satie] Default speaker presets created in " + PresetFolder);
        EditorUtility.DisplayDialog("Presets Created",
            $"Default speaker presets have been created in:\n{PresetFolder}", "OK");
    }

    private static void CreateStereoPreset()
    {
        string path = $"{PresetFolder}/Stereo.asset";

        if (AssetDatabase.LoadAssetAtPath<SatieSpeakerPreset>(path) != null)
        {
            Debug.Log("[Satie] Stereo preset already exists, skipping");
            return;
        }

        var preset = ScriptableObject.CreateInstance<SatieSpeakerPreset>();
        preset.presetName = "Stereo";
        preset.speakerMode = SpeakerMode.Stereo;
        preset.channels.Add(new SpeakerChannel(ChannelRole.Left, 1));
        preset.channels.Add(new SpeakerChannel(ChannelRole.Right, 2));
        preset.routingNotes = "Standard stereo output to channels 1 and 2.";

        AssetDatabase.CreateAsset(preset, path);
        Debug.Log($"[Satie] Created preset: {path}");
    }

    private static void CreateQuadCustomPreset()
    {
        string path = $"{PresetFolder}/Quad_Custom.asset";

        if (AssetDatabase.LoadAssetAtPath<SatieSpeakerPreset>(path) != null)
        {
            Debug.Log("[Satie] Quad Custom preset already exists, skipping");
            return;
        }

        // Custom Quad mapping:
        // Left - analog 7
        // Right - main out 2
        // Left Surround - analog 8
        // Right Surround - analog 9

        var preset = ScriptableObject.CreateInstance<SatieSpeakerPreset>();
        preset.presetName = "Quad Custom";
        preset.speakerMode = SpeakerMode.Quad;
        preset.channels.Add(new SpeakerChannel(ChannelRole.Left, 7) { customLabel = "Left (Analog 7)" });
        preset.channels.Add(new SpeakerChannel(ChannelRole.Right, 2) { customLabel = "Right (Main Out 2)" });
        preset.channels.Add(new SpeakerChannel(ChannelRole.LeftSurround, 8) { customLabel = "Left Surr (Analog 8)" });
        preset.channels.Add(new SpeakerChannel(ChannelRole.RightSurround, 9) { customLabel = "Right Surr (Analog 9)" });
        preset.routingNotes = @"Custom Quad routing:
- Left → Analog 7
- Right → Main Out 2
- Left Surround → Analog 8
- Right Surround → Analog 9

Configure your audio interface's mixer to route:
Unity Ch 0 (Left) → Physical Out 7
Unity Ch 1 (Right) → Physical Out 2
Unity Ch 2 (Left Surr) → Physical Out 8
Unity Ch 3 (Right Surr) → Physical Out 9";

        AssetDatabase.CreateAsset(preset, path);
        Debug.Log($"[Satie] Created preset: {path}");
    }

    private static void CreateSurround51Preset()
    {
        string path = $"{PresetFolder}/Surround51.asset";

        if (AssetDatabase.LoadAssetAtPath<SatieSpeakerPreset>(path) != null)
        {
            Debug.Log("[Satie] 5.1 Surround preset already exists, skipping");
            return;
        }

        var preset = ScriptableObject.CreateInstance<SatieSpeakerPreset>();
        preset.presetName = "5.1 Surround";
        preset.speakerMode = SpeakerMode.Surround51;
        preset.channels.Add(new SpeakerChannel(ChannelRole.Left, 1));
        preset.channels.Add(new SpeakerChannel(ChannelRole.Right, 2));
        preset.channels.Add(new SpeakerChannel(ChannelRole.Center, 3));
        preset.channels.Add(new SpeakerChannel(ChannelRole.Subwoofer, 4));
        preset.channels.Add(new SpeakerChannel(ChannelRole.LeftSurround, 5));
        preset.channels.Add(new SpeakerChannel(ChannelRole.RightSurround, 6));
        preset.routingNotes = "Standard 5.1 surround mapping:\nL=1, R=2, C=3, LFE=4, LS=5, RS=6";

        AssetDatabase.CreateAsset(preset, path);
        Debug.Log($"[Satie] Created preset: {path}");
    }

    private static void CreateSurround51CustomPreset()
    {
        string path = $"{PresetFolder}/Surround51_Custom.asset";

        if (AssetDatabase.LoadAssetAtPath<SatieSpeakerPreset>(path) != null)
        {
            Debug.Log("[Satie] 5.1 Custom preset already exists, skipping");
            return;
        }

        // Create preset with user's custom mapping:
        // Left - main out: 1
        // Right - analog: 6
        // Center - analog: 7
        // Subwoofer - analog: 10
        // Left Surround - analog: 8
        // Right Surround - analog: 9

        var preset = ScriptableObject.CreateInstance<SatieSpeakerPreset>();
        preset.presetName = "5.1 Custom (Analog Outputs)";
        preset.speakerMode = SpeakerMode.Surround51;
        preset.channels.Add(new SpeakerChannel(ChannelRole.Left, 1) { customLabel = "Left (Main Out)" });
        preset.channels.Add(new SpeakerChannel(ChannelRole.Right, 6) { customLabel = "Right (Analog 6)" });
        preset.channels.Add(new SpeakerChannel(ChannelRole.Center, 7) { customLabel = "Center (Analog 7)" });
        preset.channels.Add(new SpeakerChannel(ChannelRole.Subwoofer, 10) { customLabel = "Sub (Analog 10)" });
        preset.channels.Add(new SpeakerChannel(ChannelRole.LeftSurround, 8) { customLabel = "Left Surr (Analog 8)" });
        preset.channels.Add(new SpeakerChannel(ChannelRole.RightSurround, 9) { customLabel = "Right Surr (Analog 9)" });
        preset.routingNotes = @"Custom 5.1 routing for multi-channel interface:
- Left → Main Out 1
- Right → Analog 6
- Center → Analog 7
- Subwoofer → Analog 10
- Left Surround → Analog 8
- Right Surround → Analog 9

Configure your audio interface's mixer to route:
Unity Ch 0 (Left) → Physical Out 1
Unity Ch 1 (Right) → Physical Out 6
Unity Ch 2 (Center) → Physical Out 7
Unity Ch 3 (LFE) → Physical Out 10
Unity Ch 4 (LS) → Physical Out 8
Unity Ch 5 (RS) → Physical Out 9";

        AssetDatabase.CreateAsset(preset, path);
        Debug.Log($"[Satie] Created preset: {path}");
    }

    private static void CreateSurround71Preset()
    {
        string path = $"{PresetFolder}/Surround71.asset";

        if (AssetDatabase.LoadAssetAtPath<SatieSpeakerPreset>(path) != null)
        {
            Debug.Log("[Satie] 7.1 Surround preset already exists, skipping");
            return;
        }

        var preset = ScriptableObject.CreateInstance<SatieSpeakerPreset>();
        preset.presetName = "7.1 Surround";
        preset.speakerMode = SpeakerMode.Surround71;
        preset.channels.Add(new SpeakerChannel(ChannelRole.Left, 1));
        preset.channels.Add(new SpeakerChannel(ChannelRole.Right, 2));
        preset.channels.Add(new SpeakerChannel(ChannelRole.Center, 3));
        preset.channels.Add(new SpeakerChannel(ChannelRole.Subwoofer, 4));
        preset.channels.Add(new SpeakerChannel(ChannelRole.LeftSurround, 5));
        preset.channels.Add(new SpeakerChannel(ChannelRole.RightSurround, 6));
        preset.channels.Add(new SpeakerChannel(ChannelRole.LeftBack, 7));
        preset.channels.Add(new SpeakerChannel(ChannelRole.RightBack, 8));
        preset.routingNotes = "Standard 7.1 surround mapping:\nL=1, R=2, C=3, LFE=4, LS=5, RS=6, LB=7, RB=8";

        AssetDatabase.CreateAsset(preset, path);
        Debug.Log($"[Satie] Created preset: {path}");
    }

    [MenuItem("Satie/Open Speaker Presets Folder")]
    public static void OpenPresetsFolder()
    {
        if (AssetDatabase.IsValidFolder(PresetFolder))
        {
            Object folder = AssetDatabase.LoadAssetAtPath<Object>(PresetFolder);
            Selection.activeObject = folder;
            EditorGUIUtility.PingObject(folder);
        }
        else
        {
            Debug.LogWarning($"[Satie] Presets folder not found. Run 'Satie/Create Default Speaker Presets' first.");
        }
    }
}
}
