using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;
using UnityEditor;
using Satie;
using Satie.AI;

namespace Satie.Editor
{
    [CustomEditor(typeof(SatieAgentOrchestrator))]
    public class SatieAgentOrchestratorEditor : UnityEditor.Editor
    {
        private string userPrompt = "";
        private string streamingOutput = "";
        private bool isGenerating = false;
        private bool showAdvanced = false;
        private bool showMetrics = false;
        private Vector2 scrollPosition;
        private Vector2 outputScrollPosition;
        private Vector2 historyScrollPosition;

        // History management
        private List<string> codeHistory = new List<string>();
        private List<string> promptHistory = new List<string>();
        private List<GenerationMetrics> metricsHistory = new List<GenerationMetrics>();

        private GUIStyle headerStyle;
        private GUIStyle codeStyle;
        private GUIStyle streamingStyle;
        private GenerationMetrics lastMetrics;

        // Speech input
        private SpeechInputHandler speechHandler;
        private SpeechInputSettings speechSettings;
        private bool isRecording = false;
        private string recordingStatus = "";
        private float recordingDuration = 0f;
        private bool speechEnabled = false;

        private void OnEnable()
        {
            var orchestrator = target as SatieAgentOrchestrator;
            if (orchestrator != null)
            {
                orchestrator.OnStreamUpdate += HandleStreamUpdate;
                orchestrator.OnGenerationComplete += HandleGenerationComplete;
                orchestrator.Initialize();
            }

            // Initialize speech input
            InitializeSpeechInput();

            // Register for editor updates to handle keyboard shortcuts
            EditorApplication.update += OnEditorUpdate;
        }

        private void OnDisable()
        {
            var orchestrator = target as SatieAgentOrchestrator;
            if (orchestrator != null)
            {
                orchestrator.OnStreamUpdate -= HandleStreamUpdate;
                orchestrator.OnGenerationComplete -= HandleGenerationComplete;
            }

            // Cleanup speech handler
            EditorApplication.update -= OnEditorUpdate;
            CleanupSpeechInput();
        }

        private void HandleStreamUpdate(string chunk)
        {
            streamingOutput += chunk;
            Repaint();
        }

        private void HandleGenerationComplete(GenerationMetrics metrics)
        {
            lastMetrics = metrics;
            showMetrics = true;
            Repaint();
        }

        public override void OnInspectorGUI()
        {
            InitializeStyles();

            var orchestrator = target as SatieAgentOrchestrator;

            EditorGUILayout.Space(10);

            // Header
            EditorGUILayout.LabelField("sAtIe Multi-Agent System", headerStyle);
            EditorGUILayout.HelpBox(
                "Hierarchical orchestrator with Claude Sonnet 4.5 (orchestrator) + Haiku 4.5 (specialists)\n" +
                "Features: Parallel validation, streaming responses, self-corrective verification",
                MessageType.Info
            );

            EditorGUILayout.Space(10);

            // Speech Input Section
            DrawSpeechInputUI();

            // Prompt Section
            EditorGUILayout.LabelField("Prompt", EditorStyles.boldLabel);

            EditorGUILayout.BeginHorizontal();
            userPrompt = EditorGUILayout.TextArea(userPrompt, GUILayout.Height(80));

            // Push-to-talk button (HOLD to record)
            if (speechEnabled)
            {
                GUIStyle buttonStyle = new GUIStyle(GUI.skin.button);
                if (isRecording)
                {
                    buttonStyle.normal.textColor = Color.red;
                    buttonStyle.fontStyle = FontStyle.Bold;
                }

                // Use RepeatButton for hold-to-talk functionality
                Rect buttonRect = GUILayoutUtility.GetRect(60, 80);

                Event e = Event.current;
                bool isButtonPressed = false;

                // Detect mouse down/up on button
                if (e.type == EventType.MouseDown && buttonRect.Contains(e.mousePosition))
                {
                    isButtonPressed = true;
                    if (!isRecording)
                    {
                        StartRecording();
                    }
                    e.Use();
                }
                else if (e.type == EventType.MouseUp && isRecording)
                {
                    // Stop recording when mouse is released anywhere
                    StopRecordingAndGenerate();
                    e.Use();
                }

                // Draw the button
                if (GUI.Button(buttonRect, isRecording ? "🎤\nHOLD" : "🎤\nHold", buttonStyle))
                {
                    // This handles the visual feedback
                }
            }
            EditorGUILayout.EndHorizontal();

            // Show recording status
            if (isRecording)
            {
                EditorGUILayout.HelpBox($"🎤 Recording... {recordingDuration:F1}s - KEEP HOLDING! Release to auto-generate", MessageType.Warning);
            }

            EditorGUILayout.Space(10);

            // Generate Button
            EditorGUI.BeginDisabledGroup(isGenerating || string.IsNullOrEmpty(userPrompt));
            if (GUILayout.Button(isGenerating ? "Generating..." : "⚡ Generate Code (Multi-Agent)", GUILayout.Height(40)))
            {
                GenerateCode(orchestrator);
            }
            EditorGUI.EndDisabledGroup();

            // Streaming Output Section (only show when generating or has content)
            if (isGenerating || !string.IsNullOrEmpty(streamingOutput))
            {
                EditorGUILayout.Space(10);
                EditorGUILayout.LabelField("Live Output", EditorStyles.boldLabel);

                outputScrollPosition = EditorGUILayout.BeginScrollView(
                    outputScrollPosition,
                    EditorStyles.helpBox,
                    GUILayout.Height(200)
                );

                EditorGUILayout.LabelField(streamingOutput, streamingStyle);

                EditorGUILayout.EndScrollView();

                // Auto-scroll to bottom during generation
                if (isGenerating)
                {
                    outputScrollPosition.y = Mathf.Infinity;
                }
            }

            // Metrics Section
            if (showMetrics && lastMetrics != null)
            {
                EditorGUILayout.Space(10);
                EditorGUILayout.LabelField("Performance Metrics", EditorStyles.boldLabel);

                EditorGUILayout.BeginVertical(EditorStyles.helpBox);
                EditorGUILayout.LabelField($"Total Time: {lastMetrics.TotalLatencyMs}ms", EditorStyles.miniLabel);
                EditorGUILayout.LabelField($"  - Validation: {lastMetrics.ValidationLatencyMs}ms", EditorStyles.miniLabel);
                EditorGUILayout.LabelField($"  - Generation: {lastMetrics.GenerationLatencyMs}ms", EditorStyles.miniLabel);
                EditorGUILayout.LabelField($"  - Verification: {lastMetrics.VerificationLatencyMs}ms", EditorStyles.miniLabel);
                EditorGUILayout.LabelField($"Repair Attempts: {lastMetrics.RepairAttempts}", EditorStyles.miniLabel);

                // Performance rating
                string rating = lastMetrics.TotalLatencyMs < 2000 ? "⚡ Excellent" :
                               lastMetrics.TotalLatencyMs < 5000 ? "✓ Good" :
                               "⚠ Slow";
                EditorGUILayout.LabelField($"Rating: {rating}", EditorStyles.miniLabel);

                EditorGUILayout.EndVertical();
            }

            // History Section
            if (codeHistory.Count > 0)
            {
                EditorGUILayout.Space(10);
                EditorGUILayout.LabelField($"Generation History ({codeHistory.Count} items)", EditorStyles.boldLabel);

                historyScrollPosition = EditorGUILayout.BeginScrollView(historyScrollPosition, GUILayout.Height(200));

                for (int i = codeHistory.Count - 1; i >= 0; i--) // Newest first
                {
                    EditorGUILayout.BeginVertical(EditorStyles.helpBox);

                    // Show prompt that generated this code
                    EditorGUILayout.LabelField($"#{codeHistory.Count - i}: \"{promptHistory[i]}\"", EditorStyles.miniLabel);

                    // Show metrics if available
                    if (i < metricsHistory.Count && metricsHistory[i] != null)
                    {
                        EditorGUILayout.LabelField(
                            $"⏱ {metricsHistory[i].TotalLatencyMs}ms | 🔧 {metricsHistory[i].RepairAttempts} repairs",
                            EditorStyles.miniLabel
                        );
                    }

                    // Show code preview (first few lines)
                    string preview = GetCodePreview(codeHistory[i]);
                    EditorGUILayout.LabelField(preview, codeStyle, GUILayout.Height(40));

                    EditorGUILayout.BeginHorizontal();

                    if (GUILayout.Button("Restore", GUILayout.Width(60)))
                    {
                        RestoreFromHistory(i);
                    }

                    if (GUILayout.Button("Copy", GUILayout.Width(60)))
                    {
                        GUIUtility.systemCopyBuffer = codeHistory[i];
                        Debug.Log($"[Orchestrator] History item #{codeHistory.Count - i} copied to clipboard");
                    }

                    EditorGUILayout.EndHorizontal();
                    EditorGUILayout.EndVertical();
                    EditorGUILayout.Space(2);
                }

                EditorGUILayout.EndScrollView();

                EditorGUILayout.BeginHorizontal();
                if (GUILayout.Button("Clear History"))
                {
                    if (EditorUtility.DisplayDialog("Clear History", "Are you sure you want to clear the generation history?", "Clear", "Cancel"))
                    {
                        codeHistory.Clear();
                        promptHistory.Clear();
                        metricsHistory.Clear();
                    }
                }
                EditorGUILayout.EndHorizontal();
            }

            EditorGUILayout.Space(10);

            // Advanced Settings
            showAdvanced = EditorGUILayout.Foldout(showAdvanced, "Advanced Settings");
            if (showAdvanced)
            {
                EditorGUI.indentLevel++;

                EditorGUILayout.LabelField("Model Configuration", EditorStyles.boldLabel);

                var serializedObject = new SerializedObject(target);
                EditorGUILayout.PropertyField(serializedObject.FindProperty("orchestratorModel"));
                EditorGUILayout.PropertyField(serializedObject.FindProperty("specialistModel"));
                serializedObject.ApplyModifiedProperties();

                EditorGUILayout.Space(5);

                if (GUILayout.Button("Reinitialize Orchestrator"))
                {
                    orchestrator.Initialize();
                }

                EditorGUI.indentLevel--;
            }

            // Status
            EditorGUILayout.Space(10);
            EditorGUILayout.HelpBox(
                "Status: " + (isGenerating ? "🔄 Generating code..." : "✓ Ready") +
                "\nMode: Multi-Agent with Parallel Validation" +
                "\nProvider: Anthropic Claude (Sonnet 4.5 + Haiku 4.5)",
                isGenerating ? MessageType.Info : MessageType.None
            );
        }

        private async void GenerateCode(SatieAgentOrchestrator orchestrator)
        {
            isGenerating = true;
            streamingOutput = "";
            showMetrics = false;

            try
            {
                Debug.Log($"[Orchestrator] Generating code with prompt: {userPrompt}");

                // Get current script from Satie runtime
                string currentScript = GetCurrentSatieScript();

                // Generate code with streaming
                var result = await orchestrator.GenerateCodeAsync(userPrompt, currentScript);

                if (!result.Success)
                {
                    Debug.LogError($"[Orchestrator] Generation failed: {result.Error}");
                    streamingOutput += $"\n\n❌ Error: {result.Error}";
                }
                else
                {
                    Debug.Log("[Orchestrator] Code generated successfully!");

                    // Add to history
                    AddToHistory(userPrompt, result.Code, result.Metrics);

                    // Auto-apply the generated code
                    ApplyGeneratedCodeAuto(result.Code);

                    // Show explanation if any
                    if (!string.IsNullOrEmpty(result.Explanation))
                    {
                        Debug.Log($"[Orchestrator] {result.Explanation}");
                    }

                    // Clear prompt for next use
                    userPrompt = "";
                }
            }
            catch (Exception e)
            {
                Debug.LogError($"[Orchestrator] Generation error: {e.Message}");
                streamingOutput += $"\n\n❌ Exception: {e.Message}";
            }
            finally
            {
                isGenerating = false;
                Repaint();
            }
        }

        private void AddToHistory(string prompt, string code, GenerationMetrics metrics)
        {
            codeHistory.Add(code);
            promptHistory.Add(prompt);
            metricsHistory.Add(metrics);

            // Limit history to 20 items
            if (codeHistory.Count > 20)
            {
                codeHistory.RemoveAt(0);
                promptHistory.RemoveAt(0);
                metricsHistory.RemoveAt(0);
            }
        }

        private string GetCodePreview(string code)
        {
            if (string.IsNullOrEmpty(code)) return "";

            var lines = code.Split('\n');
            var preview = "";
            int lineCount = 0;

            foreach (var line in lines)
            {
                if (lineCount >= 2) break;
                if (!string.IsNullOrWhiteSpace(line))
                {
                    preview += line.Trim() + "\n";
                    lineCount++;
                }
            }

            if (lines.Length > 2)
            {
                preview += "...";
            }

            return preview.Trim();
        }

        private void RestoreFromHistory(int index)
        {
            if (index >= 0 && index < codeHistory.Count)
            {
                string codeToRestore = codeHistory[index];
                string promptUsed = promptHistory[index];

                Debug.Log($"[Orchestrator] Restoring from history: \"{promptUsed}\"");

                // Apply the historical code
                ApplyCodeToScript(codeToRestore);

                // Add to history as a new entry (restoration)
                AddToHistory($"Restored: {promptUsed}", codeToRestore, null);
            }
        }

        private void ApplyGeneratedCodeAuto(string code)
        {
            if (string.IsNullOrEmpty(code))
            {
                Debug.LogError("[Orchestrator] No generated code to apply");
                return;
            }

            ApplyCodeToScript(code);
        }

        private void ApplyCodeToScript(string code)
        {
            try
            {
                // Find the SatieRuntime in the scene
                var satieRuntime = FindObjectOfType<SatieRuntime>();
                if (satieRuntime == null)
                {
                    Debug.LogError("[Orchestrator] No SatieRuntime found in scene. Please add one to apply the code.");
                    return;
                }

                // Get the current TextAsset
                if (satieRuntime.ScriptFile == null)
                {
                    Debug.LogError("[Orchestrator] No script file assigned to SatieRuntime. Please assign a TextAsset first.");
                    return;
                }

                // Get asset path and write the code
                string assetPath = UnityEditor.AssetDatabase.GetAssetPath(satieRuntime.ScriptFile);

                if (!string.IsNullOrEmpty(assetPath))
                {
                    // Write the code to the file
                    System.IO.File.WriteAllText(assetPath, code);

                    // Refresh the asset database
                    UnityEditor.AssetDatabase.ImportAsset(assetPath, ImportAssetOptions.ForceUpdate);
                    UnityEditor.AssetDatabase.Refresh();

                    // Auto Shift+R: Sync if in play mode
                    if (Application.isPlaying)
                    {
                        Debug.Log("[Orchestrator] Auto-syncing runtime (Shift+R)...");
                        satieRuntime.Sync(fullReset: true);
                    }

                    Debug.Log($"[Orchestrator] ✓ Code auto-applied to {System.IO.Path.GetFileName(assetPath)}");
                }
                else
                {
                    Debug.LogError("[Orchestrator] Could not find asset path for current script file");
                }
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[Orchestrator] Failed to apply code: {e.Message}");
            }
        }

        private string GetCurrentSatieScript()
        {
            try
            {
                var satieRuntime = FindObjectOfType<SatieRuntime>();
                if (satieRuntime != null)
                {
                    var scriptProperty = typeof(SatieRuntime).GetProperty("ScriptFile");
                    if (scriptProperty != null)
                    {
                        var textAsset = scriptProperty.GetValue(satieRuntime) as TextAsset;
                        if (textAsset != null && !string.IsNullOrEmpty(textAsset.text))
                        {
                            Debug.Log($"[Orchestrator] Found current script: {textAsset.text.Length} characters from {textAsset.name}");
                            return textAsset.text;
                        }
                    }

                    // Fallback: try to access private field
                    var scriptField = typeof(SatieRuntime).GetField("scriptFile",
                        System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

                    if (scriptField != null)
                    {
                        var textAsset = scriptField.GetValue(satieRuntime) as TextAsset;
                        if (textAsset != null && !string.IsNullOrEmpty(textAsset.text))
                        {
                            Debug.Log($"[Orchestrator] Found current script via fallback: {textAsset.text.Length} characters from {textAsset.name}");
                            return textAsset.text;
                        }
                    }
                }

                Debug.Log("[Orchestrator] No SatieRuntime found or script is empty. Starting with blank script.");
                return "";
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[Orchestrator] Failed to get current script: {e.Message}");
                return "";
            }
        }

        private void InitializeStyles()
        {
            if (headerStyle == null)
            {
                headerStyle = new GUIStyle(EditorStyles.boldLabel)
                {
                    fontSize = 18,
                    alignment = TextAnchor.MiddleCenter
                };
            }

            if (codeStyle == null)
            {
                codeStyle = new GUIStyle(EditorStyles.textArea)
                {
                    font = Font.CreateDynamicFontFromOSFont("Courier New", 11),
                    wordWrap = true
                };
            }

            if (streamingStyle == null)
            {
                streamingStyle = new GUIStyle(EditorStyles.label)
                {
                    font = Font.CreateDynamicFontFromOSFont("Courier New", 11),
                    wordWrap = true,
                    richText = false
                };
            }
        }

        // ============================
        // SPEECH INPUT METHODS
        // ============================

        private void InitializeSpeechInput()
        {
            speechSettings = SpeechInputSettings.GetOrCreateSettings();

            if (speechSettings == null)
            {
                Debug.LogWarning("[SpeechInput] Not enabled: Settings not found");
                speechEnabled = false;
                return;
            }

            string errorMessage = "";
            if (speechSettings.IsValid(out errorMessage))
            {
                try
                {
                    // Get OpenAI key from centralized APIKeys.cs
                    string openAIKey = speechSettings.GetOpenAIKey();
                    speechHandler = new SpeechInputHandler(openAIKey);

                    // Subscribe to events
                    speechHandler.OnTranscriptionReceived += HandleTranscriptionReceived;
                    speechHandler.OnTranscriptionError += HandleTranscriptionError;
                    speechHandler.OnRecordingStarted += HandleRecordingStarted;
                    speechHandler.OnRecordingProgress += HandleRecordingProgress;

                    // Set preferred microphone if specified
                    if (!string.IsNullOrEmpty(speechSettings.preferredMicrophoneDevice))
                    {
                        speechHandler.SetMicrophoneDevice(speechSettings.preferredMicrophoneDevice);
                    }

                    speechEnabled = true;
                    Debug.Log("[SpeechInput] Initialized successfully");
                }
                catch (Exception ex)
                {
                    Debug.LogError($"[SpeechInput] Initialization failed: {ex.Message}");
                    speechEnabled = false;
                }
            }
            else
            {
                Debug.LogWarning($"[SpeechInput] Not enabled: {errorMessage}");
                speechEnabled = false;
            }
        }

        private void CleanupSpeechInput()
        {
            if (speechHandler != null)
            {
                speechHandler.OnTranscriptionReceived -= HandleTranscriptionReceived;
                speechHandler.OnTranscriptionError -= HandleTranscriptionError;
                speechHandler.OnRecordingStarted -= HandleRecordingStarted;
                speechHandler.OnRecordingProgress -= HandleRecordingProgress;

                speechHandler.Dispose();
                speechHandler = null;
            }
        }

        private void OnEditorUpdate()
        {
            if (!speechEnabled || speechSettings == null)
                return;

            // Update recording duration
            if (isRecording && speechHandler != null)
            {
                recordingDuration = speechHandler.RecordingDuration;
                Repaint();
            }

            // Handle keyboard shortcuts for push-to-talk (HOLD functionality)
            Event e = Event.current;
            if (e != null && e.isKey)
            {
                bool modifierMatch = speechSettings.pushToTalkModifier == EventModifiers.None ||
                                    (e.modifiers & speechSettings.pushToTalkModifier) != 0;

                // Key down - start recording
                if (e.type == EventType.KeyDown && e.keyCode == speechSettings.pushToTalkKey && modifierMatch && !isRecording)
                {
                    StartRecording();
                    e.Use();
                }
                // Key up - stop recording AND auto-generate
                else if (e.type == EventType.KeyUp && e.keyCode == speechSettings.pushToTalkKey && isRecording)
                {
                    StopRecordingAndGenerate();
                    e.Use();
                }
            }
        }

        private void DrawSpeechInputUI()
        {
            if (!speechEnabled)
            {
                EditorGUILayout.HelpBox(
                    "🎤 Speech Input Disabled\n" +
                    "OpenAI API key not found in Assets/APIKeys.cs. Add your key to the OPENAI field.",
                    MessageType.Warning
                );
                return;
            }

            // Show keyboard shortcut hint
            string shortcutText = speechSettings.pushToTalkModifier == EventModifiers.None
                ? speechSettings.pushToTalkKey.ToString()
                : $"{speechSettings.pushToTalkModifier} + {speechSettings.pushToTalkKey}";

            EditorGUILayout.HelpBox(
                $"🎤 Speech Input Ready | HOLD '{shortcutText}' or button while talking - Auto-generates on release!",
                MessageType.None
            );
        }

        private void StartRecording()
        {
            if (speechHandler == null || isRecording || isGenerating)
                return;

            bool success = speechHandler.StartRecording();
            if (success)
            {
                isRecording = true;
                recordingStatus = "Recording...";
                recordingDuration = 0f;
                Debug.Log("[SpeechInput] Started recording");
            }
        }

        private async void StopRecording()
        {
            if (speechHandler == null || !isRecording)
                return;

            isRecording = false;
            recordingStatus = "Processing...";

            try
            {
                await speechHandler.StopRecordingAndTranscribeAsync();
            }
            catch (Exception ex)
            {
                Debug.LogError($"[SpeechInput] Error during transcription: {ex.Message}");
                recordingStatus = $"Error: {ex.Message}";
            }

            Repaint();
        }

        private async void StopRecordingAndGenerate()
        {
            if (speechHandler == null || !isRecording)
                return;

            isRecording = false;
            recordingStatus = "Processing...";

            try
            {
                await speechHandler.StopRecordingAndTranscribeAsync();
                // Transcription will trigger HandleTranscriptionReceived which auto-generates
            }
            catch (Exception ex)
            {
                Debug.LogError($"[SpeechInput] Error during transcription: {ex.Message}");
                recordingStatus = $"Error: {ex.Message}";
            }

            Repaint();
        }

        private void HandleTranscriptionReceived(string transcription)
        {
            Debug.Log($"[SpeechInput] Transcription: {transcription}");

            // Set prompt to transcription (replace, not append)
            userPrompt = transcription;

            recordingStatus = "✓ Transcribed - Generating...";

            // ALWAYS auto-submit after transcription
            var orchestrator = target as SatieAgentOrchestrator;
            if (orchestrator != null && !string.IsNullOrEmpty(transcription))
            {
                GenerateCode(orchestrator);
            }

            Repaint();
        }

        private void HandleTranscriptionError(string error)
        {
            Debug.LogWarning($"[SpeechInput] Transcription error: {error}");
            recordingStatus = $"Error: {error}";
            Repaint();
        }

        private void HandleRecordingStarted()
        {
            recordingStatus = "Recording...";
            Repaint();
        }

        private void HandleRecordingProgress(float duration)
        {
            recordingDuration = duration;
            Repaint();
        }
    }
}
