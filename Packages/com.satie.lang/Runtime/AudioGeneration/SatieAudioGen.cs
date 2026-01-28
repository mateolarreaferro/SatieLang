using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;

namespace Satie
{
    public enum AudioProvider
    {
        ElevenLabs
    }

    [System.Serializable]
    public class AudioGenerationResult
    {
        public string prompt;
        public string[] audioFilePaths;
        public byte[][] audioData;
        public int selectedIndex = -1;
        public string timestamp;
        public AudioProvider provider;
    }

    public class SatieAudioGen : MonoBehaviour
    {
        private static SatieAudioGen instance;
        public static SatieAudioGen Instance
        {
            get
            {
                if (instance == null)
                {
                    var go = new GameObject("SatieAudioGen");
                    instance = go.AddComponent<SatieAudioGen>();
                    DontDestroyOnLoad(go);
                }
                return instance;
            }
        }

        private const string ElevenLabsApiUrl = "https://api.elevenlabs.io/v1/sound-generation";

        [Header("Generation Settings")]
        [SerializeField] private int sampleRate = 44100;
        [SerializeField] private int numOptions = 1;

        [Header("ElevenLabs Settings")]
        [SerializeField] [Range(0.5f, 30f)] private float elevenLabsDuration = 10f;
        [SerializeField] [Range(0f, 1f)] private float elevenLabsPromptInfluence = 0.3f;

        [Header("Audio Settings")]
        [SerializeField] private bool generateLoopingAudio = false;

        // Cache for generated audio
        private Dictionary<string, AudioGenerationResult> generationCache = new Dictionary<string, AudioGenerationResult>();

        void Awake()
        {
            if (instance != null && instance != this)
            {
                Destroy(gameObject);
                return;
            }
            instance = this;
            DontDestroyOnLoad(gameObject);
        }

        public async Task<AudioGenerationResult> GenerateAudioOptions(string prompt, int numOptions = 2, AudioProvider? provider = null, Action<AudioGenerationResult, int> onOptionGenerated = null)
        {
            return await GenerateAudioOptionsInternal(prompt, numOptions, provider ?? AudioProvider.ElevenLabs, onOptionGenerated);
        }

        private async Task<AudioGenerationResult> GenerateAudioOptionsInternal(string prompt, int numOptions, AudioProvider provider, Action<AudioGenerationResult, int> onOptionGenerated)
        {
            if (string.IsNullOrWhiteSpace(prompt))
            {
                Debug.LogError("[AudioGen] Cannot generate audio with empty prompt");
                return null;
            }

            // Check cache first
            string cacheKey = $"{provider}_{prompt}";
            if (generationCache.ContainsKey(cacheKey))
            {
                Debug.Log($"[AudioGen] Returning cached audio for prompt: {prompt}");
                return generationCache[cacheKey];
            }

            var result = new AudioGenerationResult
            {
                prompt = prompt,
                audioFilePaths = new string[numOptions],
                audioData = new byte[numOptions][],
                timestamp = DateTime.Now.ToString("yyyyMMdd_HHmmss"),
                provider = provider
            };

            try
            {
                Debug.Log($"[AudioGen] Generating {numOptions} audio options for: {prompt}");

                for (int i = 0; i < numOptions; i++)
                {
                    byte[] audioData = await CallElevenLabsAPI(prompt);

                    if (audioData != null && audioData.Length > 0)
                    {
                        // ElevenLabs returns MP3 by default — convert to WAV for Unity
                        byte[] wavData = ConvertMp3BytesToWav(audioData);
                        result.audioData[i] = wavData ?? audioData;

                        Debug.Log($"[AudioGen] Generated option {i + 1}/{numOptions} ({result.audioData[i].Length / 1024} KB)");
                        onOptionGenerated?.Invoke(result, i);
                    }
                    else
                    {
                        Debug.LogWarning($"[AudioGen] Failed to generate option {i + 1}/{numOptions}");
                    }
                }

                generationCache[cacheKey] = result;
                return result;
            }
            catch (Exception e)
            {
                Debug.LogError($"[AudioGen] Error generating audio: {e.Message}");
                return null;
            }
        }

        private async Task<byte[]> CallElevenLabsAPI(string prompt)
        {
            string apiKey = SatieAPIKeyManager.GetKey(SatieAPIKeyManager.Provider.ElevenLabs);
            if (string.IsNullOrEmpty(apiKey))
            {
                Debug.LogError("[AudioGen] No ElevenLabs API key found. Add your key to Assets/APIKeys.cs or set SATIE_API_KEY_ELEVENLABS environment variable.");
                return null;
            }

            try
            {
                var requestBody = new ElevenLabsRequest
                {
                    text = prompt,
                    duration_seconds = elevenLabsDuration,
                    prompt_influence = elevenLabsPromptInfluence
                };

                string jsonRequest = JsonUtility.ToJson(requestBody);

                // Request WAV format directly to avoid MP3 conversion
                string url = $"{ElevenLabsApiUrl}?output_format=pcm_{sampleRate}";

                using (var request = new UnityWebRequest(url, "POST"))
                {
                    byte[] bodyRaw = System.Text.Encoding.UTF8.GetBytes(jsonRequest);
                    request.uploadHandler = new UploadHandlerRaw(bodyRaw);
                    request.downloadHandler = new DownloadHandlerBuffer();
                    request.SetRequestHeader("Content-Type", "application/json");
                    request.SetRequestHeader("xi-api-key", apiKey);

                    var operation = request.SendWebRequest();
                    while (!operation.isDone)
                        await Task.Yield();

                    if (request.result != UnityWebRequest.Result.Success)
                    {
                        Debug.LogError($"[AudioGen] ElevenLabs API error ({request.responseCode}): {request.error}");
                        if (request.downloadHandler.text.Length > 0)
                            Debug.LogError($"[AudioGen] Response: {request.downloadHandler.text}");
                        return null;
                    }

                    byte[] pcmData = request.downloadHandler.data;
                    Debug.Log($"[AudioGen] Received {pcmData.Length} bytes of PCM audio");

                    // Wrap raw PCM in a WAV container
                    return CreateWavFromPcm(pcmData, sampleRate, 1, 16);
                }
            }
            catch (Exception e)
            {
                Debug.LogError($"[AudioGen] API call failed: {e.Message}");
                return null;
            }
        }

        [Serializable]
        private class ElevenLabsRequest
        {
            public string text;
            public float duration_seconds;
            public float prompt_influence;
        }

        /// <summary>
        /// Wraps raw 16-bit PCM data in a WAV file container.
        /// </summary>
        private byte[] CreateWavFromPcm(byte[] pcmData, int wavSampleRate, int channels, int bitsPerSample)
        {
            using (var stream = new MemoryStream())
            using (var writer = new BinaryWriter(stream))
            {
                int byteRate = wavSampleRate * channels * bitsPerSample / 8;
                int blockAlign = channels * bitsPerSample / 8;

                // RIFF header
                writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF"));
                writer.Write(36 + pcmData.Length); // file size - 8
                writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVE"));

                // fmt chunk
                writer.Write(System.Text.Encoding.ASCII.GetBytes("fmt "));
                writer.Write(16); // chunk size
                writer.Write((short)1); // PCM format
                writer.Write((short)channels);
                writer.Write(wavSampleRate);
                writer.Write(byteRate);
                writer.Write((short)blockAlign);
                writer.Write((short)bitsPerSample);

                // data chunk
                writer.Write(System.Text.Encoding.ASCII.GetBytes("data"));
                writer.Write(pcmData.Length);
                writer.Write(pcmData);

                return stream.ToArray();
            }
        }

        /// <summary>
        /// Fallback: attempts to treat MP3 bytes as WAV. Returns null if not WAV format.
        /// </summary>
        private byte[] ConvertMp3BytesToWav(byte[] data)
        {
            // Check if it's already a WAV file
            if (data.Length > 4 &&
                data[0] == 'R' && data[1] == 'I' && data[2] == 'F' && data[3] == 'F')
            {
                return data;
            }
            // Not WAV — caller should handle or the PCM path should be used instead
            return null;
        }

        public async Task<string> SaveSelectedAudio(AudioGenerationResult result, int selectedIndex)
        {
            if (result == null || selectedIndex < 0 || selectedIndex >= result.audioData.Length)
            {
                Debug.LogError("[AudioGen] Invalid audio selection");
                return null;
            }

            if (result.audioData[selectedIndex] == null || result.audioData[selectedIndex].Length == 0)
            {
                Debug.LogError("[AudioGen] No audio data to save");
                return null;
            }

            try
            {
                string sanitizedPrompt = SanitizeFileName(result.prompt);
                if (sanitizedPrompt.Length > 30)
                    sanitizedPrompt = sanitizedPrompt.Substring(0, 30);
                string fileName = $"{sanitizedPrompt}.wav";
                string relativePath = Path.Combine("Assets", "Resources", "Audio", "generation", fileName);
                string fullPath = Path.Combine(Application.dataPath, "Resources", "Audio", "generation", fileName);

                string directory = Path.GetDirectoryName(fullPath);
                if (!Directory.Exists(directory))
                    Directory.CreateDirectory(directory);

                await File.WriteAllBytesAsync(fullPath, result.audioData[selectedIndex]);

                Debug.Log($"[AudioGen] Saved audio to: {relativePath}");

                result.selectedIndex = selectedIndex;
                result.audioFilePaths[selectedIndex] = relativePath;

                #if UNITY_EDITOR
                UnityEditor.AssetDatabase.Refresh();
                #endif

                return relativePath;
            }
            catch (Exception e)
            {
                Debug.LogError($"[AudioGen] Error saving audio: {e.Message}");
                return null;
            }
        }

        public AudioClip ConvertBytesToAudioClip(byte[] audioData, string name = "GeneratedAudio")
        {
            if (audioData == null || audioData.Length == 0)
            {
                Debug.LogError("[AudioGen] Cannot convert null or empty audio data");
                return null;
            }

            try
            {
                WAVData wavData = ParseWAVData(audioData);
                if (wavData == null)
                {
                    Debug.LogError("[AudioGen] Failed to parse WAV data");
                    return null;
                }

                AudioClip audioClip = AudioClip.Create(
                    name,
                    wavData.samples.Length / wavData.channels,
                    wavData.channels,
                    wavData.sampleRate,
                    false
                );

                audioClip.SetData(wavData.samples, 0);
                return audioClip;
            }
            catch (Exception e)
            {
                Debug.LogError($"[AudioGen] Error converting audio: {e.Message}");
                return null;
            }
        }

        private class WAVData
        {
            public int channels;
            public int sampleRate;
            public float[] samples;
        }

        private WAVData ParseWAVData(byte[] wavFile)
        {
            try
            {
                int pos = 12; // Skip RIFF header

                while (pos < wavFile.Length - 8)
                {
                    string chunkId = System.Text.Encoding.ASCII.GetString(wavFile, pos, 4);
                    int chunkSize = BitConverter.ToInt32(wavFile, pos + 4);

                    if (chunkId == "fmt ")
                    {
                        var wavData = new WAVData();
                        wavData.channels = BitConverter.ToInt16(wavFile, pos + 10);
                        wavData.sampleRate = BitConverter.ToInt32(wavFile, pos + 12);
                        int bitDepth = BitConverter.ToInt16(wavFile, pos + 22);

                        pos += 8 + chunkSize;
                        while (pos < wavFile.Length - 8)
                        {
                            chunkId = System.Text.Encoding.ASCII.GetString(wavFile, pos, 4);
                            chunkSize = BitConverter.ToInt32(wavFile, pos + 4);

                            if (chunkId == "data")
                            {
                                int sampleCount = chunkSize / (bitDepth / 8);
                                wavData.samples = new float[sampleCount];

                                int dataPos = pos + 8;
                                if (bitDepth == 16)
                                {
                                    for (int i = 0; i < sampleCount; i++)
                                    {
                                        short sample = BitConverter.ToInt16(wavFile, dataPos + i * 2);
                                        wavData.samples[i] = sample / 32768f;
                                    }
                                }
                                else if (bitDepth == 24)
                                {
                                    for (int i = 0; i < sampleCount; i++)
                                    {
                                        int sample = (wavFile[dataPos + i * 3] |
                                                     (wavFile[dataPos + i * 3 + 1] << 8) |
                                                     (wavFile[dataPos + i * 3 + 2] << 16));
                                        if ((sample & 0x800000) != 0)
                                            sample |= unchecked((int)0xFF000000);
                                        wavData.samples[i] = sample / 8388608f;
                                    }
                                }

                                return wavData;
                            }

                            pos += 8 + chunkSize;
                        }

                        break;
                    }

                    pos += 8 + chunkSize;
                }

                return null;
            }
            catch (Exception e)
            {
                Debug.LogError($"[AudioGen] Error parsing WAV: {e.Message}");
                return null;
            }
        }

        private string SanitizeFileName(string fileName)
        {
            string invalid = new string(Path.GetInvalidFileNameChars());
            string sanitized = fileName;

            foreach (char c in invalid)
                sanitized = sanitized.Replace(c.ToString(), "_");

            if (sanitized.Length > 50)
                sanitized = sanitized.Substring(0, 50);

            return sanitized.Replace(" ", "_").ToLower();
        }

        public void ClearCache()
        {
            generationCache.Clear();
            Debug.Log("[AudioGen] Cache cleared");
        }

        public List<string> GetGeneratedAudioFiles()
        {
            string generationPath = Path.Combine(Application.dataPath, "Resources", "Audio", "generation");

            if (!Directory.Exists(generationPath))
                return new List<string>();

            return Directory.GetFiles(generationPath, "*.wav")
                .Select(f => Path.GetFileName(f))
                .OrderByDescending(f => File.GetCreationTime(Path.Combine(generationPath, f)))
                .ToList();
        }

        public void SetLoopingAudio(bool looping)
        {
            generateLoopingAudio = looping;
        }

        public bool GetLoopingAudio()
        {
            return generateLoopingAudio;
        }
    }
}
