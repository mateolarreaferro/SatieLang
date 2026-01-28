using System.Collections;
using UnityEngine;

namespace Satie
{
    /// <summary>
    /// Manages speaker configuration and multi-channel audio output for SatieLang.
    /// Provides runtime speaker mode switching and test tone generation.
    /// </summary>
    public class SatieSpeakerSetup : MonoBehaviour
    {
        [Header("Speaker Configuration")]
        [Tooltip("Active speaker preset defining channel mappings")]
        [SerializeField] private SatieSpeakerPreset activePreset;

        [Tooltip("Apply preset on start")]
        [SerializeField] private bool applyOnStart = true;

        [Header("Test Tone Settings")]
        [Tooltip("Frequency of test tone in Hz")]
        [Range(100f, 1000f)]
        [SerializeField] private float testToneFrequency = 440f;

        [Tooltip("Duration of test tone in seconds")]
        [Range(0.5f, 3f)]
        [SerializeField] private float testToneDuration = 1f;

        [Tooltip("Volume of test tone")]
        [Range(0f, 1f)]
        [SerializeField] private float testToneVolume = 0.5f;

        // Test tone audio source
        private AudioSource testToneSource;
        private AudioClip testToneClip;
        private Coroutine walkThroughCoroutine;

        // Properties
        public SatieSpeakerPreset ActivePreset => activePreset;
        public SpeakerMode CurrentSpeakerMode => activePreset != null ? activePreset.speakerMode : SpeakerMode.Stereo;
        public float TestToneFrequency => testToneFrequency;
        public float TestToneDuration => testToneDuration;
        public float TestToneVolume => testToneVolume;

        void Start()
        {
            if (applyOnStart && activePreset != null)
            {
                ApplyPreset(activePreset);
            }
        }

        /// <summary>
        /// Apply a speaker preset, changing Unity's speaker mode
        /// </summary>
        public void ApplyPreset(SatieSpeakerPreset preset)
        {
            if (preset == null)
            {
                Debug.LogWarning("[SatieSpeakerSetup] Cannot apply null preset");
                return;
            }

            activePreset = preset;
            SetSpeakerMode(preset.speakerMode);
            Debug.Log($"[SatieSpeakerSetup] Applied preset: {preset.presetName} ({preset.speakerMode})");
        }

        /// <summary>
        /// Change Unity's speaker mode at runtime
        /// Note: This causes a brief audio interruption
        /// </summary>
        public void SetSpeakerMode(SpeakerMode mode)
        {
            var config = AudioSettings.GetConfiguration();

            AudioSpeakerMode unityMode = mode switch
            {
                SpeakerMode.Stereo => AudioSpeakerMode.Stereo,
                SpeakerMode.Quad => AudioSpeakerMode.Quad,
                SpeakerMode.Surround51 => AudioSpeakerMode.Mode5point1,
                SpeakerMode.Surround71 => AudioSpeakerMode.Mode7point1,
                _ => AudioSpeakerMode.Stereo
            };

            if (config.speakerMode != unityMode)
            {
                config.speakerMode = unityMode;

                // Reset audio system to apply new configuration
                // This will cause a brief audio interruption
                if (!AudioSettings.Reset(config))
                {
                    Debug.LogError("[SatieSpeakerSetup] Failed to reset audio configuration. Speaker mode may not have changed.");
                }
                else
                {
                    Debug.Log($"[SatieSpeakerSetup] Speaker mode changed to {mode}");
                }
            }
        }

        /// <summary>
        /// Get the current Unity speaker mode
        /// </summary>
        public AudioSpeakerMode GetCurrentUnitySpeakerMode()
        {
            return AudioSettings.GetConfiguration().speakerMode;
        }

        /// <summary>
        /// Check if current Unity speaker mode matches the active preset
        /// </summary>
        public bool IsSpeakerModeMatchingPreset()
        {
            if (activePreset == null) return true;

            var currentMode = GetCurrentUnitySpeakerMode();
            var expectedMode = activePreset.speakerMode switch
            {
                SpeakerMode.Stereo => AudioSpeakerMode.Stereo,
                SpeakerMode.Quad => AudioSpeakerMode.Quad,
                SpeakerMode.Surround51 => AudioSpeakerMode.Mode5point1,
                SpeakerMode.Surround71 => AudioSpeakerMode.Mode7point1,
                _ => AudioSpeakerMode.Stereo
            };

            return currentMode == expectedMode;
        }

        /// <summary>
        /// Play a test tone on a specific channel role
        /// </summary>
        public void PlayTestTone(ChannelRole role)
        {
            if (activePreset == null)
            {
                Debug.LogWarning("[SatieSpeakerSetup] No active preset. Cannot play test tone.");
                return;
            }

            // Find the channel in the preset
            SpeakerChannel channel = null;
            foreach (var ch in activePreset.channels)
            {
                if (ch.role == role && ch.enabled)
                {
                    channel = ch;
                    break;
                }
            }

            if (channel == null)
            {
                Debug.LogWarning($"[SatieSpeakerSetup] Channel {role} not found or disabled in preset");
                return;
            }

            StartCoroutine(PlayTestToneCoroutine(channel));
        }

        /// <summary>
        /// Play test tones on all channels sequentially
        /// </summary>
        public void WalkThroughAllChannels()
        {
            if (walkThroughCoroutine != null)
            {
                StopCoroutine(walkThroughCoroutine);
            }
            walkThroughCoroutine = StartCoroutine(WalkThroughCoroutine());
        }

        /// <summary>
        /// Stop any playing test tone
        /// </summary>
        public void StopTestTone()
        {
            if (walkThroughCoroutine != null)
            {
                StopCoroutine(walkThroughCoroutine);
                walkThroughCoroutine = null;
            }

            if (testToneSource != null)
            {
                testToneSource.Stop();
            }
        }

        private IEnumerator PlayTestToneCoroutine(SpeakerChannel channel)
        {
            // Create test tone source if needed
            EnsureTestToneSource();

            // Generate test tone clip
            GenerateTestToneClip();

            // Position the source to route to the correct channel
            // For multi-channel output, we use specific positions in 3D space
            Vector3 position = GetChannelPosition(channel.role);
            testToneSource.transform.position = position;

            // Configure for spatial output
            testToneSource.spatialBlend = 1f;
            testToneSource.clip = testToneClip;
            testToneSource.volume = testToneVolume;

            Debug.Log($"[SatieSpeakerSetup] Playing test tone: {channel.GetDisplayName()} → Output {channel.hardwareOutput}");

            testToneSource.Play();

            yield return new WaitForSeconds(testToneDuration);

            testToneSource.Stop();
        }

        private IEnumerator WalkThroughCoroutine()
        {
            if (activePreset == null)
            {
                Debug.LogWarning("[SatieSpeakerSetup] No active preset for walk-through");
                yield break;
            }

            Debug.Log("[SatieSpeakerSetup] Starting channel walk-through...");

            foreach (var channel in activePreset.channels)
            {
                if (channel.enabled)
                {
                    yield return PlayTestToneCoroutine(channel);
                    yield return new WaitForSeconds(0.3f); // Pause between channels
                }
            }

            Debug.Log("[SatieSpeakerSetup] Channel walk-through complete");
            walkThroughCoroutine = null;
        }

        private void EnsureTestToneSource()
        {
            if (testToneSource == null)
            {
                var go = new GameObject("[Satie] Test Tone Source");
                go.transform.SetParent(transform);
                testToneSource = go.AddComponent<AudioSource>();
                testToneSource.playOnAwake = false;
                testToneSource.loop = false;
                testToneSource.spatialBlend = 1f;
                testToneSource.rolloffMode = AudioRolloffMode.Linear;
                testToneSource.minDistance = 0.1f;
                testToneSource.maxDistance = 100f;
            }
        }

        private void GenerateTestToneClip()
        {
            int sampleRate = AudioSettings.outputSampleRate;
            int sampleCount = Mathf.RoundToInt(sampleRate * testToneDuration);

            if (testToneClip == null || testToneClip.samples != sampleCount)
            {
                testToneClip = AudioClip.Create("TestTone", sampleCount, 1, sampleRate, false);
            }

            float[] samples = new float[sampleCount];
            float increment = testToneFrequency * 2f * Mathf.PI / sampleRate;
            float phase = 0f;

            // Generate sine wave with fade in/out
            int fadeLength = sampleRate / 20; // 50ms fade

            for (int i = 0; i < sampleCount; i++)
            {
                float amplitude = 1f;

                // Fade in
                if (i < fadeLength)
                {
                    amplitude = (float)i / fadeLength;
                }
                // Fade out
                else if (i > sampleCount - fadeLength)
                {
                    amplitude = (float)(sampleCount - i) / fadeLength;
                }

                samples[i] = Mathf.Sin(phase) * amplitude;
                phase += increment;
            }

            testToneClip.SetData(samples, 0);
        }

        /// <summary>
        /// Get a 3D position that will route audio to a specific channel
        /// based on Unity's surround sound speaker layout
        /// </summary>
        private Vector3 GetChannelPosition(ChannelRole role)
        {
            // Listener is assumed at origin
            // Positions at a fixed distance (10 units) in the standard surround layout
            float distance = 10f;

            return role switch
            {
                // Front speakers: 30 degrees off center
                ChannelRole.Left => new Vector3(-distance * 0.5f, 0f, distance * 0.866f),
                ChannelRole.Right => new Vector3(distance * 0.5f, 0f, distance * 0.866f),
                ChannelRole.Center => new Vector3(0f, 0f, distance),

                // LFE/Subwoofer: typically center-front (non-directional in practice)
                ChannelRole.Subwoofer => new Vector3(0f, -distance * 0.5f, distance * 0.5f),

                // Surround speakers: 110 degrees from center
                ChannelRole.LeftSurround => new Vector3(-distance * 0.94f, 0f, -distance * 0.34f),
                ChannelRole.RightSurround => new Vector3(distance * 0.94f, 0f, -distance * 0.34f),

                // Back speakers (7.1): 150 degrees from center
                ChannelRole.LeftBack => new Vector3(-distance * 0.5f, 0f, -distance * 0.866f),
                ChannelRole.RightBack => new Vector3(distance * 0.5f, 0f, -distance * 0.866f),

                _ => Vector3.forward * distance
            };
        }

        /// <summary>
        /// Get status information about the speaker setup
        /// </summary>
        public SpeakerSetupStatus GetStatus()
        {
            var config = AudioSettings.GetConfiguration();

            return new SpeakerSetupStatus
            {
                hasPreset = activePreset != null,
                presetName = activePreset != null ? activePreset.presetName : "None",
                presetSpeakerMode = activePreset != null ? activePreset.speakerMode : SpeakerMode.Stereo,
                unitySpeakerMode = config.speakerMode,
                speakerModeMatches = IsSpeakerModeMatchingPreset(),
                channelCount = activePreset != null ? activePreset.channels.Count : 0,
                sampleRate = config.sampleRate,
                dspBufferSize = config.dspBufferSize
            };
        }

        /// <summary>
        /// Get routing instructions for external configuration
        /// </summary>
        public string GetRoutingInstructions()
        {
            if (activePreset == null)
            {
                return "No preset selected. Please assign a speaker preset.";
            }

            return activePreset.GenerateRoutingInstructions();
        }

        void OnDestroy()
        {
            if (testToneSource != null)
            {
                Destroy(testToneSource.gameObject);
            }
        }

        void OnValidate()
        {
            testToneFrequency = Mathf.Clamp(testToneFrequency, 100f, 1000f);
            testToneDuration = Mathf.Clamp(testToneDuration, 0.5f, 3f);
            testToneVolume = Mathf.Clamp01(testToneVolume);
        }
    }

    /// <summary>
    /// Status information about the speaker setup
    /// </summary>
    public struct SpeakerSetupStatus
    {
        public bool hasPreset;
        public string presetName;
        public SpeakerMode presetSpeakerMode;
        public AudioSpeakerMode unitySpeakerMode;
        public bool speakerModeMatches;
        public int channelCount;
        public int sampleRate;
        public int dspBufferSize;

        public bool IsConfigured => hasPreset && speakerModeMatches;
    }
}
