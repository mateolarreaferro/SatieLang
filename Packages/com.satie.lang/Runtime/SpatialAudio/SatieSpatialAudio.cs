using UnityEngine;

#if STEAMAUDIO_ENABLED
using SteamAudio;
#endif

namespace Satie
{
    /// <summary>
    /// Handles spatial audio configuration and Steam Audio integration for SatieLang
    /// </summary>
    public class SatieSpatialAudio : MonoBehaviour
    {
        [Header("Spatial Audio Settings")]
        [Tooltip("Enable Head-Related Transfer Function for realistic 3D audio positioning")]
        [SerializeField] private bool useHRTF = true;

        [Tooltip("Automatically setup Steam Audio components when needed")]
        [SerializeField] private bool autoSetupSteamAudio = true;

        [Header("3D Audio Settings")]
        [Tooltip("Default settings applied to 3D audio sources")]
        [SerializeField] private AudioSpatialSettings defaultSpatialSettings = new AudioSpatialSettings();

        [Header("Steam Audio Features")]
        [Tooltip("Enable occlusion effects (impacts performance)")]
        [SerializeField] private bool enableOcclusion = false;

        [Tooltip("Enable transmission effects (impacts performance)")]
        [SerializeField] private bool enableTransmission = false;

        [Tooltip("Enable reflection/reverb effects (impacts performance)")]
        [SerializeField] private bool enableReflections = false;

        // Properties
        public bool UseHRTF => useHRTF;
        public bool AutoSetupSteamAudio => autoSetupSteamAudio;
        public AudioSpatialSettings DefaultSpatialSettings => defaultSpatialSettings;
        public bool EnableOcclusion => enableOcclusion;
        public bool EnableTransmission => enableTransmission;
        public bool EnableReflections => enableReflections;

        void Start()
        {
            if (useHRTF && autoSetupSteamAudio)
            {
                // Defer setup by one frame to avoid initialization order issues
                StartCoroutine(DelayedSetup());
            }
        }

        private System.Collections.IEnumerator DelayedSetup()
        {
            // Wait for one frame to ensure all Unity systems are initialized
            yield return null;

#if UNITY_STANDALONE_WIN && STEAMAUDIO_ENABLED
            // On Windows, disable existing Steam Audio Manager to prevent crashes
            var existingManager = FindObjectOfType<SteamAudio.SteamAudioManager>();
            if (existingManager != null)
            {
                Debug.LogWarning("[SpatialAudio] Disabling Steam Audio Manager on Windows to prevent phonon.dll crashes. Using Unity's native spatializer instead.");
                existingManager.enabled = false;
            }

            // Also disable any SteamAudioListener components
            var steamListeners = FindObjectsOfType<SteamAudio.SteamAudioListener>();
            foreach (var listener in steamListeners)
            {
                listener.enabled = false;
            }

            Debug.Log("[SpatialAudio] Steam Audio components disabled on Windows. Spatial audio will use Unity's built-in spatializer.");
            yield break;
#else
            Debug.Log("[SpatialAudio] Starting delayed Steam Audio setup...");
            SetupSteamAudio();
#endif
        }

        /// <summary>
        /// Configure an AudioSource for spatial audio
        /// </summary>
        public void ConfigureAudioSource(AudioSource source, bool is3D = true)
        {
            if (!is3D)
            {
                source.spatialBlend = 0f;
                source.spatialize = false;
                return;
            }

            // Apply 3D settings
            source.spatialBlend = 1f;
            source.spatialize = useHRTF;
            source.spatializePostEffects = true;

            // Apply default spatial settings
            source.dopplerLevel = defaultSpatialSettings.dopplerLevel;
            source.spread = defaultSpatialSettings.spread;
            source.rolloffMode = defaultSpatialSettings.rolloffMode;
            source.minDistance = defaultSpatialSettings.minDistance;
            source.maxDistance = defaultSpatialSettings.maxDistance;
        }

        /// <summary>
        /// Add Steam Audio components to an AudioSource GameObject
        /// </summary>
        public void AddSteamAudioComponents(GameObject audioObject)
        {
            if (!useHRTF) return;

#if STEAMAUDIO_ENABLED
#if UNITY_STANDALONE_WIN
            // Disable SteamAudioSource component on Windows due to phonon.dll crash
            // Unity's native spatializer will still work for 3D audio
            // The crash occurs in iplContextSetVariableBool during SteamAudioManager.LateUpdate
            if (Application.isPlaying)
            {
                Debug.LogWarning("[SpatialAudio] SteamAudioSource components disabled on Windows due to phonon.dll compatibility issues. Using Unity's native spatializer instead.");
            }
            return;
#else
            try
            {
                var steamSource = audioObject.GetComponent<SteamAudioSource>();
                if (steamSource == null)
                {
                    steamSource = audioObject.AddComponent<SteamAudioSource>();
                }

                // Configure Steam Audio Source
                steamSource.directivity = false;
                steamSource.dipoleWeight = 0.0f;
                steamSource.dipolePower = 1.0f;

                // Enable distance attenuation for moving objects
                // This is critical for proper spatial audio with dynamic positioning
                steamSource.distanceAttenuation = true;
                steamSource.distanceAttenuationInput = DistanceAttenuationInput.CurveDriven; // Uses Unity's rolloff curve

                // Improve binaural quality (slight performance cost, but better spatial accuracy)
                steamSource.interpolation = HRTFInterpolation.Bilinear; // Better than Nearest, not as slow as Trilinear

                // Enable air absorption for realistic high-frequency rolloff over distance
                steamSource.airAbsorption = true;
                steamSource.airAbsorptionInput = AirAbsorptionInput.SimulationDefined;

                // Advanced features based on settings
                steamSource.occlusion = enableOcclusion;
                steamSource.occlusionType = OcclusionType.Raycast;
                steamSource.occlusionRadius = 0.1f;

                steamSource.transmission = enableTransmission;
                steamSource.transmissionType = TransmissionType.FrequencyDependent;

                steamSource.reflections = enableReflections;
                steamSource.reflectionsType = ReflectionsType.Realtime;

                Debug.Log($"[SpatialAudio] Added Steam Audio components to {audioObject.name}");
            }
            catch (System.Exception e)
            {
                Debug.LogWarning($"[SpatialAudio] Failed to add Steam Audio components: {e.Message}");
            }
#endif
#else
            if (Application.isPlaying)
            {
                Debug.Log("[SpatialAudio] Steam Audio not enabled. Using Unity's default spatializer.");
            }
#endif
        }

        /// <summary>
        /// Setup Steam Audio manager and listener components
        /// </summary>
        public void SetupSteamAudio()
        {
#if STEAMAUDIO_ENABLED
            try
            {
                // Check if Steam Audio Manager exists, create if missing
                var manager = FindObjectOfType<SteamAudioManager>();
                if (manager == null)
                {
                    Debug.Log("[SpatialAudio] Creating Steam Audio Manager for HRTF support.");
                    var managerGO = new GameObject("Steam Audio Manager");
                    manager = managerGO.AddComponent<SteamAudioManager>();
                }

                // Check if main camera has Steam Audio Listener
                var mainCamera = Camera.main;
                if (mainCamera != null)
                {
                    SetupCameraAudioComponents(mainCamera);
                }
                else
                {
                    Debug.LogWarning("[SpatialAudio] No Main Camera found. Please ensure a camera with AudioListener exists in the scene.");
                }
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[SpatialAudio] Failed to setup Steam Audio (this may cause Unity to crash): {e.Message}\nStack: {e.StackTrace}");
                Debug.LogError("[SpatialAudio] Disabling auto-setup to prevent further crashes.");
                autoSetupSteamAudio = false;
            }
#else
            Debug.Log("[SpatialAudio] Steam Audio not enabled. To enable:" +
                     "\n1. Add 'STEAMAUDIO_ENABLED' to Scripting Define Symbols" +
                     "\n2. Set Project Settings > Audio > Spatializer Plugin to 'Steam Audio Spatializer'");
#endif
        }

        /// <summary>
        /// Setup audio components on the main camera
        /// </summary>
        private void SetupCameraAudioComponents(Camera camera)
        {
#if STEAMAUDIO_ENABLED
            try
            {
                var steamListener = camera.GetComponent<SteamAudioListener>();
                var audioListener = camera.GetComponent<AudioListener>();

                // Ensure Unity's AudioListener exists (required by Steam Audio)
                if (audioListener == null)
                {
                    Debug.Log("[SpatialAudio] Adding Unity AudioListener to Main Camera (required by Steam Audio).");
                    audioListener = camera.gameObject.AddComponent<AudioListener>();
                }

                // Add Steam Audio Listener component if missing
                if (steamListener == null)
                {
                    Debug.Log("[SpatialAudio] Adding Steam Audio Listener to Main Camera for HRTF support.");
                    steamListener = camera.gameObject.AddComponent<SteamAudioListener>();

                    // Configure Steam Audio Listener
                    steamListener.applyReverb = enableReflections;
                    steamListener.reverbType = ReverbType.Realtime;
                }
            }
            catch (System.Exception e)
            {
                Debug.LogError($"[SpatialAudio] Failed to setup camera audio components: {e.Message}");
                throw; // Re-throw to be caught by outer try-catch
            }
#endif
        }

        /// <summary>
        /// Check if Steam Audio is properly configured
        /// </summary>
        public bool IsSteamAudioConfigured()
        {
#if STEAMAUDIO_ENABLED
            var manager = FindObjectOfType<SteamAudioManager>();
            var mainCamera = Camera.main;

            if (mainCamera != null)
            {
                var steamListener = mainCamera.GetComponent<SteamAudioListener>();
                var audioListener = mainCamera.GetComponent<AudioListener>();

                return manager != null && steamListener != null && audioListener != null;
            }

            return manager != null;
#else
            return false;
#endif
        }

        /// <summary>
        /// Get status information about the spatial audio setup
        /// </summary>
        public SpatialAudioStatus GetStatus()
        {
            return new SpatialAudioStatus
            {
                useHRTF = this.useHRTF,
                steamAudioAvailable = IsSteamAudioAvailable(),
                steamAudioConfigured = IsSteamAudioConfigured(),
                mainCameraFound = Camera.main != null,
                audioListenerFound = Camera.main != null && Camera.main.GetComponent<AudioListener>() != null
            };
        }

        private bool IsSteamAudioAvailable()
        {
#if STEAMAUDIO_ENABLED
            return true;
#else
            return false;
#endif
        }

        // Validation in editor
        void OnValidate()
        {
            // Ensure reasonable values
            defaultSpatialSettings.Validate();
        }
    }

    /// <summary>
    /// Settings for 3D audio spatialization
    /// </summary>
    [System.Serializable]
    public class AudioSpatialSettings
    {
        [Header("Distance Settings")]
        [Tooltip("Distance where audio begins to fade")]
        [Range(0.1f, 50f)] public float minDistance = 1f;

        [Tooltip("Distance where audio is completely silent")]
        [Range(1f, 500f)] public float maxDistance = 100f;

        [Header("Effect Settings")]
        [Tooltip("Strength of doppler effect")]
        [Range(0f, 5f)] public float dopplerLevel = 0.5f;

        [Tooltip("Spread angle for 3D sound (0 = point source)")]
        [Range(0f, 360f)] public float spread = 0f;

        [Header("Rolloff")]
        [Tooltip("How audio fades with distance")]
        public AudioRolloffMode rolloffMode = AudioRolloffMode.Logarithmic;

        public void Validate()
        {
            minDistance = Mathf.Clamp(minDistance, 0.1f, 50f);
            maxDistance = Mathf.Clamp(maxDistance, minDistance + 0.1f, 500f);
            dopplerLevel = Mathf.Clamp(dopplerLevel, 0f, 5f);
            spread = Mathf.Clamp(spread, 0f, 360f);
        }
    }

    /// <summary>
    /// Status information about spatial audio configuration
    /// </summary>
    public struct SpatialAudioStatus
    {
        public bool useHRTF;
        public bool steamAudioAvailable;
        public bool steamAudioConfigured;
        public bool mainCameraFound;
        public bool audioListenerFound;

        public bool IsFullyConfigured => useHRTF ?
            (steamAudioAvailable && steamAudioConfigured && mainCameraFound && audioListenerFound) :
            (mainCameraFound && audioListenerFound);
    }
}