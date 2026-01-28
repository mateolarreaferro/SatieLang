using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace Satie.AI
{
    /// <summary>
    /// Handles speech-to-text conversion using OpenAI Whisper API with optimizations for low latency.
    /// Supports push-to-talk microphone recording and streaming transcription.
    /// </summary>
    public class SpeechInputHandler : IDisposable
    {
        // Configuration
        private readonly string apiKey;
        private readonly string apiEndpoint = "https://api.openai.com/v1/audio/transcriptions";
        private readonly string model = "whisper-1";

        // HTTP client (reused for low latency)
        private readonly HttpClient httpClient;

        // Microphone state
        private AudioClip recordingClip;
        private string microphoneDevice;
        private bool isRecording;
        private float recordingStartTime;
        private const int SAMPLE_RATE = 16000; // Whisper optimized sample rate
        private const int MAX_RECORDING_SECONDS = 30; // Safety limit

        // Events
        public event Action<string> OnTranscriptionReceived;
        public event Action<string> OnTranscriptionError;
        public event Action OnRecordingStarted;
        public event Action<float> OnRecordingProgress; // Duration in seconds

        /// <summary>
        /// Creates a new speech input handler with OpenAI API key.
        /// </summary>
        public SpeechInputHandler(string openAIApiKey)
        {
            if (string.IsNullOrEmpty(openAIApiKey))
            {
                throw new ArgumentException("OpenAI API key is required for speech recognition");
            }

            this.apiKey = openAIApiKey;

            // Configure HTTP client for optimal latency
            httpClient = new HttpClient
            {
                Timeout = TimeSpan.FromSeconds(60) // Generous timeout for audio processing
            };
            httpClient.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", apiKey);

            // Use best available microphone device
            if (Microphone.devices.Length > 0)
            {
                microphoneDevice = Microphone.devices[0];
                Debug.Log($"[SpeechInput] Using microphone: {microphoneDevice}");
            }
            else
            {
                Debug.LogWarning("[SpeechInput] No microphone devices detected");
            }
        }

        /// <summary>
        /// Gets whether microphone is currently recording.
        /// </summary>
        public bool IsRecording => isRecording;

        /// <summary>
        /// Gets current recording duration in seconds.
        /// </summary>
        public float RecordingDuration => isRecording ? (Time.realtimeSinceStartup - recordingStartTime) : 0f;

        /// <summary>
        /// Starts recording from the microphone.
        /// </summary>
        public bool StartRecording()
        {
            if (isRecording)
            {
                Debug.LogWarning("[SpeechInput] Already recording");
                return false;
            }

            if (string.IsNullOrEmpty(microphoneDevice))
            {
                Debug.LogError("[SpeechInput] No microphone device available");
                OnTranscriptionError?.Invoke("No microphone detected");
                return false;
            }

            try
            {
                // Start microphone capture at Whisper's optimal sample rate
                recordingClip = Microphone.Start(microphoneDevice, false, MAX_RECORDING_SECONDS, SAMPLE_RATE);

                if (recordingClip == null)
                {
                    Debug.LogError("[SpeechInput] Failed to start microphone");
                    OnTranscriptionError?.Invoke("Failed to start microphone");
                    return false;
                }

                isRecording = true;
                recordingStartTime = Time.realtimeSinceStartup;
                OnRecordingStarted?.Invoke();

                Debug.Log("[SpeechInput] Recording started");
                return true;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[SpeechInput] Error starting recording: {ex.Message}");
                OnTranscriptionError?.Invoke($"Recording error: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Stops recording and sends audio to Whisper for transcription.
        /// Returns true if transcription request was initiated successfully.
        /// </summary>
        public async Task<bool> StopRecordingAndTranscribeAsync(CancellationToken cancellationToken = default)
        {
            if (!isRecording)
            {
                Debug.LogWarning("[SpeechInput] Not currently recording");
                return false;
            }

            float duration = RecordingDuration;

            // Stop microphone
            Microphone.End(microphoneDevice);
            isRecording = false;

            // Validate recording duration
            if (duration < 0.3f)
            {
                Debug.LogWarning("[SpeechInput] Recording too short, skipping transcription");
                OnTranscriptionError?.Invoke("Recording too short (minimum 0.3s)");
                return false;
            }

            Debug.Log($"[SpeechInput] Recording stopped ({duration:F2}s), processing...");

            try
            {
                // Convert AudioClip to WAV bytes
                byte[] wavData = ConvertAudioClipToWav(recordingClip, duration);

                if (wavData == null || wavData.Length == 0)
                {
                    OnTranscriptionError?.Invoke("Failed to process audio data");
                    return false;
                }

                Debug.Log($"[SpeechInput] Audio data size: {wavData.Length / 1024}KB, sending to Whisper...");

                // Send to Whisper API
                await TranscribeAudioAsync(wavData, cancellationToken);

                return true;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[SpeechInput] Transcription error: {ex.Message}");
                OnTranscriptionError?.Invoke($"Transcription failed: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Converts AudioClip to WAV format bytes optimized for Whisper.
        /// </summary>
        private byte[] ConvertAudioClipToWav(AudioClip clip, float duration)
        {
            if (clip == null)
                return null;

            // Calculate actual sample count based on duration
            int sampleCount = Mathf.Min(
                (int)(duration * clip.frequency),
                clip.samples
            );

            // Get audio samples
            float[] samples = new float[sampleCount * clip.channels];
            clip.GetData(samples, 0);

            // Convert to 16-bit PCM WAV
            using (var memoryStream = new MemoryStream())
            using (var writer = new BinaryWriter(memoryStream))
            {
                int sampleRate = clip.frequency;
                int channels = clip.channels;
                int bitDepth = 16;

                // WAV header
                writer.Write(new char[4] { 'R', 'I', 'F', 'F' });
                writer.Write(36 + sampleCount * channels * (bitDepth / 8)); // File size - 8
                writer.Write(new char[4] { 'W', 'A', 'V', 'E' });

                // fmt chunk
                writer.Write(new char[4] { 'f', 'm', 't', ' ' });
                writer.Write(16); // Chunk size
                writer.Write((ushort)1); // Audio format (PCM)
                writer.Write((ushort)channels);
                writer.Write(sampleRate);
                writer.Write(sampleRate * channels * (bitDepth / 8)); // Byte rate
                writer.Write((ushort)(channels * (bitDepth / 8))); // Block align
                writer.Write((ushort)bitDepth);

                // data chunk
                writer.Write(new char[4] { 'd', 'a', 't', 'a' });
                writer.Write(sampleCount * channels * (bitDepth / 8));

                // Write audio samples as 16-bit PCM
                for (int i = 0; i < samples.Length; i++)
                {
                    short sample = (short)(samples[i] * 32767f);
                    writer.Write(sample);
                }

                return memoryStream.ToArray();
            }
        }

        /// <summary>
        /// Sends audio data to Whisper API for transcription.
        /// </summary>
        private async Task TranscribeAudioAsync(byte[] wavData, CancellationToken cancellationToken)
        {
            using (var content = new MultipartFormDataContent())
            {
                // Add audio file
                var audioContent = new ByteArrayContent(wavData);
                audioContent.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
                content.Add(audioContent, "file", "audio.wav");

                // Add model parameter
                content.Add(new StringContent(model), "model");

                // Add language hint (optional, but speeds up processing)
                content.Add(new StringContent("en"), "language");

                // Add response format (prefer JSON for structure)
                content.Add(new StringContent("json"), "response_format");

                // Send request
                var startTime = Time.realtimeSinceStartup;
                var response = await httpClient.PostAsync(apiEndpoint, content, cancellationToken);
                var latency = (Time.realtimeSinceStartup - startTime) * 1000f;

                if (!response.IsSuccessStatusCode)
                {
                    var errorBody = await response.Content.ReadAsStringAsync();
                    Debug.LogError($"[SpeechInput] API error: {response.StatusCode} - {errorBody}");
                    OnTranscriptionError?.Invoke($"API error: {response.StatusCode}");
                    return;
                }

                // Parse response
                var responseBody = await response.Content.ReadAsStringAsync();
                var transcription = ParseTranscriptionResponse(responseBody);

                if (!string.IsNullOrWhiteSpace(transcription))
                {
                    Debug.Log($"[SpeechInput] Transcription received in {latency:F0}ms: \"{transcription}\"");
                    OnTranscriptionReceived?.Invoke(transcription);
                }
                else
                {
                    Debug.LogWarning("[SpeechInput] Empty transcription received");
                    OnTranscriptionError?.Invoke("No speech detected");
                }
            }
        }

        /// <summary>
        /// Parses Whisper API JSON response to extract transcription text.
        /// </summary>
        private string ParseTranscriptionResponse(string jsonResponse)
        {
            try
            {
                // Simple JSON parsing for {"text": "..."} response
                var textStart = jsonResponse.IndexOf("\"text\"");
                if (textStart < 0)
                    return null;

                var valueStart = jsonResponse.IndexOf(":", textStart) + 1;
                var quotStart = jsonResponse.IndexOf("\"", valueStart) + 1;
                var quotEnd = jsonResponse.IndexOf("\"", quotStart);

                if (quotStart > 0 && quotEnd > quotStart)
                {
                    return jsonResponse.Substring(quotStart, quotEnd - quotStart).Trim();
                }

                return null;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[SpeechInput] Error parsing response: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Cancels current recording without transcription.
        /// </summary>
        public void CancelRecording()
        {
            if (isRecording)
            {
                Microphone.End(microphoneDevice);
                isRecording = false;
                Debug.Log("[SpeechInput] Recording cancelled");
            }
        }

        /// <summary>
        /// Gets list of available microphone devices.
        /// </summary>
        public static string[] GetAvailableMicrophones()
        {
            return Microphone.devices;
        }

        /// <summary>
        /// Sets the microphone device to use for recording.
        /// </summary>
        public void SetMicrophoneDevice(string deviceName)
        {
            if (!isRecording)
            {
                microphoneDevice = deviceName;
                Debug.Log($"[SpeechInput] Microphone device set to: {deviceName}");
            }
            else
            {
                Debug.LogWarning("[SpeechInput] Cannot change microphone while recording");
            }
        }

        public void Dispose()
        {
            CancelRecording();
            httpClient?.Dispose();
        }
    }
}
