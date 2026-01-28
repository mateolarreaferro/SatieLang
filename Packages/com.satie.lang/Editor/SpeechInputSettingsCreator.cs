using UnityEngine;
using UnityEditor;
using System.IO;
using Satie;
using Satie.AI;

namespace Satie.Editor
{
    /// <summary>
    /// Editor utility to create Speech Input Settings asset.
    /// </summary>
    public static class SpeechInputSettingsCreator
    {
        [MenuItem("Satie/Create Speech Input Settings", false, 1)]
        public static void CreateSpeechInputSettings()
        {
            // Ensure Resources folder exists
            string resourcesPath = "Assets/Resources";
            if (!Directory.Exists(resourcesPath))
            {
                Directory.CreateDirectory(resourcesPath);
                AssetDatabase.Refresh();
            }

            // Check if settings already exist
            string assetPath = resourcesPath + "/SpeechInputSettings.asset";
            var existingSettings = AssetDatabase.LoadAssetAtPath<SpeechInputSettings>(assetPath);

            if (existingSettings != null)
            {
                bool overwrite = EditorUtility.DisplayDialog(
                    "Settings Already Exist",
                    "Speech Input Settings already exists at:\n" + assetPath + "\n\nDo you want to select it?",
                    "Select Existing",
                    "Cancel"
                );

                if (overwrite)
                {
                    Selection.activeObject = existingSettings;
                    EditorGUIUtility.PingObject(existingSettings);
                }
                return;
            }

            // Create new settings
            var settings = ScriptableObject.CreateInstance<SpeechInputSettings>();

            AssetDatabase.CreateAsset(settings, assetPath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            Selection.activeObject = settings;
            EditorGUIUtility.PingObject(settings);

            Debug.Log($"[Satie] Speech Input Settings created at: {assetPath}");
            EditorUtility.DisplayDialog(
                "Success!",
                "Speech Input Settings created!\n\n" +
                "Next steps:\n" +
                "1. Add your OpenAI API key in the Inspector\n" +
                "2. The microphone button will appear in the Orchestrator\n" +
                "3. Hold Space or click the 🎤 button to talk",
                "Got it!"
            );
        }

        [MenuItem("Satie/Open Speech Input Settings", false, 2)]
        public static void OpenSpeechInputSettings()
        {
            var settings = Resources.Load<SpeechInputSettings>("SpeechInputSettings");

            if (settings != null)
            {
                Selection.activeObject = settings;
                EditorGUIUtility.PingObject(settings);
            }
            else
            {
                bool create = EditorUtility.DisplayDialog(
                    "Settings Not Found",
                    "Speech Input Settings not found.\n\nWould you like to create it now?",
                    "Create",
                    "Cancel"
                );

                if (create)
                {
                    CreateSpeechInputSettings();
                }
            }
        }
    }
}
