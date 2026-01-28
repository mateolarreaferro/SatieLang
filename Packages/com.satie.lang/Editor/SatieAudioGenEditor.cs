using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using UnityEngine;
using UnityEditor;
using Satie;

namespace Satie.Editor
{
[CustomEditor(typeof(SatieAudioGen))]
public class SatieAudioGenEditor : UnityEditor.Editor
{
    private SatieAudioGen audioGen;

    // UI State
    private string audioPrompt = "";
    private bool isGeneratingAudio = false;
    private AudioGenerationResult currentAudioResult;
    private int selectedAudioIndex = -1;
    private AudioSource previewAudioSource;

    // Foldouts
    private bool showProviderSettings = true;
    private bool showGeneratedFiles = false;

    void OnEnable()
    {
        audioGen = (SatieAudioGen)target;
    }

    void OnDisable()
    {
        if (previewAudioSource != null)
        {
            DestroyImmediate(previewAudioSource.gameObject);
        }
    }

    public override void OnInspectorGUI()
    {
        serializedObject.Update();

        EditorGUILayout.LabelField("Audio Generation", EditorStyles.boldLabel);
        EditorGUILayout.Space(5);

        // Generation interface (prompt first)
        DrawGenerationInterface();

        // Show current generation results
        if (currentAudioResult != null)
        {
            DrawGenerationResults();
        }

        EditorGUILayout.Space(10);

        // Show generated files
        DrawGeneratedFiles();

        EditorGUILayout.Space(10);
        EditorGUILayout.LabelField("", GUI.skin.horizontalSlider);
        EditorGUILayout.Space(5);

        // Provider settings
        DrawProviderSettings();

        serializedObject.ApplyModifiedProperties();
    }

    private void DrawProviderSettings()
    {
        showProviderSettings = EditorGUILayout.Foldout(showProviderSettings, "ElevenLabs Settings", true);

        if (showProviderSettings)
        {
            EditorGUI.indentLevel++;

            EditorGUILayout.PropertyField(serializedObject.FindProperty("numOptions"));
            EditorGUILayout.PropertyField(serializedObject.FindProperty("generateLoopingAudio"));
            EditorGUILayout.PropertyField(serializedObject.FindProperty("sampleRate"));

            EditorGUILayout.Space(5);

            EditorGUILayout.LabelField("Audio Generation", EditorStyles.boldLabel);
            EditorGUILayout.PropertyField(serializedObject.FindProperty("elevenLabsDuration"));
            EditorGUILayout.PropertyField(serializedObject.FindProperty("elevenLabsPromptInfluence"));

            EditorGUILayout.Space(5);

            if (GUILayout.Button("Clear Cache", GUILayout.Height(20)))
            {
                audioGen.ClearCache();
                Debug.Log("Audio generation cache cleared");
            }

            EditorGUI.indentLevel--;
        }
    }

    private void DrawGenerationInterface()
    {
        EditorGUILayout.LabelField("Generate Audio", EditorStyles.boldLabel);

        EditorGUILayout.LabelField("Prompt:");
        audioPrompt = EditorGUILayout.TextArea(audioPrompt, GUILayout.Height(40));

        EditorGUI.BeginDisabledGroup(isGeneratingAudio || string.IsNullOrWhiteSpace(audioPrompt));

        Color bgColor = GUI.backgroundColor;
        GUI.backgroundColor = isGeneratingAudio ? Color.yellow : new Color(0.5f, 0.8f, 1f);

        string buttonText = isGeneratingAudio ? "Generating Audio..." : "Generate Audio Options";
        if (GUILayout.Button(buttonText, GUILayout.Height(30)))
        {
            GenerateAudioOptions();
        }

        GUI.backgroundColor = bgColor;
        EditorGUI.EndDisabledGroup();
    }

    private void DrawGenerationResults()
    {
        EditorGUILayout.Space(10);
        EditorGUILayout.LabelField("Generated Audio Options", EditorStyles.boldLabel);

        if (currentAudioResult.audioData != null)
        {
            for (int i = 0; i < currentAudioResult.audioData.Length; i++)
            {
                EditorGUILayout.BeginHorizontal();

                bool hasData = currentAudioResult.audioData[i] != null && currentAudioResult.audioData[i].Length > 0;
                EditorGUI.BeginDisabledGroup(!hasData);

                string optionLabel = $"Option {i + 1}";
                if (hasData)
                {
                    optionLabel += $" ({currentAudioResult.audioData[i].Length / 1024} KB)";
                }
                else
                {
                    optionLabel += " (Generating...)";
                }

                EditorGUILayout.LabelField(optionLabel, GUILayout.Width(150));

                if (GUILayout.Button("▶ Preview", GUILayout.Width(80)))
                {
                    PlayAudioPreview(i);
                }

                bool isSelected = selectedAudioIndex == i;
                GUI.backgroundColor = isSelected ? Color.green : GUI.backgroundColor;

                if (GUILayout.Button(isSelected ? "✓ Selected" : "Select", GUILayout.Width(80)))
                {
                    selectedAudioIndex = i;
                }

                GUI.backgroundColor = GUI.backgroundColor;
                EditorGUI.EndDisabledGroup();

                EditorGUILayout.EndHorizontal();
            }

            EditorGUILayout.Space(5);

            if (previewAudioSource != null && previewAudioSource.isPlaying)
            {
                if (GUILayout.Button("■ Stop Preview", GUILayout.Height(25)))
                {
                    StopAudioPreview();
                }
            }

            if (selectedAudioIndex >= 0)
            {
                EditorGUILayout.Space(5);

                Color bgColor = GUI.backgroundColor;
                GUI.backgroundColor = Color.cyan;

                if (GUILayout.Button("Save Selected Audio", GUILayout.Height(30)))
                {
                    SaveSelectedAudio();
                }

                GUI.backgroundColor = bgColor;
            }
        }
    }

    private void DrawGeneratedFiles()
    {
        showGeneratedFiles = EditorGUILayout.Foldout(showGeneratedFiles, "Previously Generated Audio", true);

        if (showGeneratedFiles)
        {
            var files = audioGen.GetGeneratedAudioFiles();

            if (files.Count > 0)
            {
                EditorGUI.indentLevel++;

                EditorGUILayout.LabelField($"Found {files.Count} generated audio files:", EditorStyles.miniLabel);

                int maxDisplay = Mathf.Min(10, files.Count);
                for (int i = 0; i < maxDisplay; i++)
                {
                    EditorGUILayout.BeginHorizontal();
                    EditorGUILayout.LabelField(files[i], EditorStyles.miniLabel);

                    if (GUILayout.Button("Load", GUILayout.Width(50), GUILayout.Height(16)))
                    {
                        string fullPath = Path.Combine("Audio", "generation", files[i]);
                        AudioClip clip = Resources.Load<AudioClip>(fullPath);
                        if (clip != null)
                        {
                            Debug.Log($"Loaded audio clip: {files[i]}");
                            PlayLoadedClip(clip);
                        }
                    }

                    EditorGUILayout.EndHorizontal();
                }

                if (files.Count > maxDisplay)
                {
                    EditorGUILayout.LabelField($"... and {files.Count - maxDisplay} more", EditorStyles.miniLabel);
                }

                EditorGUI.indentLevel--;
            }
            else
            {
                EditorGUI.indentLevel++;
                EditorGUILayout.LabelField("No generated audio files found.", EditorStyles.miniLabel);
                EditorGUI.indentLevel--;
            }
        }
    }

    private async void GenerateAudioOptions()
    {
        isGeneratingAudio = true;
        currentAudioResult = null;
        selectedAudioIndex = -1;
        Repaint();

        try
        {
            int numOptions = serializedObject.FindProperty("numOptions").intValue;
            currentAudioResult = await audioGen.GenerateAudioOptions(
                audioPrompt,
                numOptions,
                null,
                OnAudioOptionGenerated
            );

            if (currentAudioResult == null)
            {
                EditorUtility.DisplayDialog("Generation Failed",
                    "Failed to generate audio. Check the Console for details.", "OK");
            }
        }
        catch (Exception e)
        {
            Debug.LogError($"Audio generation error: {e.Message}");
            EditorUtility.DisplayDialog("Generation Error", $"Error: {e.Message}", "OK");
        }
        finally
        {
            isGeneratingAudio = false;
            Repaint();
        }
    }

    private void OnAudioOptionGenerated(AudioGenerationResult result, int optionIndex)
    {
        currentAudioResult = result;
        EditorApplication.delayCall += () => Repaint();
    }

    private void PlayAudioPreview(int index)
    {
        if (currentAudioResult == null || index < 0 || index >= currentAudioResult.audioData.Length)
            return;

        if (currentAudioResult.audioData[index] == null || currentAudioResult.audioData[index].Length == 0)
            return;

        try
        {
            if (previewAudioSource == null)
            {
                GameObject tempGO = new GameObject("AudioPreview");
                tempGO.hideFlags = HideFlags.HideAndDontSave;
                previewAudioSource = tempGO.AddComponent<AudioSource>();
            }

            var audioClip = audioGen.ConvertBytesToAudioClip(
                currentAudioResult.audioData[index],
                $"Preview_{index}"
            );

            if (audioClip != null)
            {
                previewAudioSource.clip = audioClip;
                previewAudioSource.Play();
            }
        }
        catch (Exception e)
        {
            Debug.LogError($"Error playing audio preview: {e.Message}");
        }
    }

    private void PlayLoadedClip(AudioClip clip)
    {
        if (clip == null) return;

        try
        {
            if (previewAudioSource == null)
            {
                GameObject tempGO = new GameObject("AudioPreview");
                tempGO.hideFlags = HideFlags.HideAndDontSave;
                previewAudioSource = tempGO.AddComponent<AudioSource>();
            }

            previewAudioSource.clip = clip;
            previewAudioSource.Play();
        }
        catch (Exception e)
        {
            Debug.LogError($"Error playing loaded clip: {e.Message}");
        }
    }

    private void StopAudioPreview()
    {
        if (previewAudioSource != null && previewAudioSource.isPlaying)
        {
            previewAudioSource.Stop();
        }
    }

    private async void SaveSelectedAudio()
    {
        if (currentAudioResult == null || selectedAudioIndex < 0) return;

        try
        {
            string savedPath = await audioGen.SaveSelectedAudio(
                currentAudioResult,
                selectedAudioIndex
            );

            if (!string.IsNullOrEmpty(savedPath))
            {
                EditorUtility.DisplayDialog("Audio Saved",
                    $"Audio saved to: {savedPath}", "OK");
            }
        }
        catch (Exception e)
        {
            Debug.LogError($"Error saving audio: {e.Message}");
            EditorUtility.DisplayDialog("Save Error", $"Error: {e.Message}", "OK");
        }
    }
}
}
