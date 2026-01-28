using UnityEngine;

namespace Satie.AI
{
    /// <summary>
    /// Configuration settings for speech input and Whisper API integration.
    /// Uses APIKeys.cs for OpenAI key - no separate key needed!
    /// </summary>
    [CreateAssetMenu(fileName = "SpeechInputSettings", menuName = "Satie/Speech Input Settings")]
    public class SpeechInputSettings : ScriptableObject
    {
        [Header("Recording Settings")]
        [Tooltip("Push-to-talk keyboard shortcut (Editor only)")]
        public KeyCode pushToTalkKey = KeyCode.Space;

        [Tooltip("Modifier key required (None, Shift, Control, Alt)")]
        public EventModifiers pushToTalkModifier = EventModifiers.None;

        [Tooltip("Minimum recording duration in seconds")]
        [Range(0.1f, 2f)]
        public float minimumRecordingDuration = 0.3f;

        [Tooltip("Maximum recording duration in seconds")]
        [Range(5f, 60f)]
        public float maximumRecordingDuration = 30f;

        [Header("Audio Quality")]
        [Tooltip("Sample rate for microphone recording (16000 Hz recommended for Whisper)")]
        public int sampleRate = 16000;

        [Tooltip("Preferred microphone device (leave empty for default)")]
        public string preferredMicrophoneDevice = "";

        [Header("UI Settings")]
        [Tooltip("Show real-time recording waveform visualization")]
        public bool showWaveformVisualization = true;

        [Tooltip("Show transcription latency metrics")]
        public bool showLatencyMetrics = true;

        [Tooltip("Auto-submit prompt after successful transcription")]
        public bool autoSubmitAfterTranscription = false;

        /// <summary>
        /// Validates settings and returns true if configuration is valid.
        /// Checks APIKeys.cs for OpenAI key automatically.
        /// </summary>
        public bool IsValid(out string errorMessage)
        {
            // Get OpenAI key from centralized APIKeys.cs
            string openAIKey = SatieAPIKeyManager.GetKey(SatieAPIKeyManager.Provider.OpenAI);

            if (string.IsNullOrWhiteSpace(openAIKey))
            {
                errorMessage = "OpenAI API key is required. Add it to Assets/APIKeys.cs (OPENAI field).";
                return false;
            }

            if (openAIKey.Length < 20 || !openAIKey.StartsWith("sk-"))
            {
                errorMessage = "Invalid OpenAI API key format in APIKeys.cs (should start with 'sk-')";
                return false;
            }

            errorMessage = null;
            return true;
        }

        /// <summary>
        /// Gets the OpenAI API key from centralized APIKeys.cs
        /// </summary>
        public string GetOpenAIKey()
        {
            return SatieAPIKeyManager.GetKey(SatieAPIKeyManager.Provider.OpenAI);
        }

        /// <summary>
        /// Gets the singleton instance, creating default settings if necessary.
        /// </summary>
        public static SpeechInputSettings GetOrCreateSettings()
        {
            var settings = Resources.Load<SpeechInputSettings>("SpeechInputSettings");

            if (settings == null)
            {
                // Create default settings in memory (no asset needed!)
                settings = CreateInstance<SpeechInputSettings>();
                Debug.Log("[SpeechInput] Using default settings (no asset needed - uses APIKeys.cs)");
            }

            return settings;
        }
    }
}
