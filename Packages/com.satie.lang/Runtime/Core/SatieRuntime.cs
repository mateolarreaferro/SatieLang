using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using UnityEngine;

namespace Satie
{
public class SatieRuntime : MonoBehaviour
{
    [Tooltip(".sp script (TextAsset)")]
    [SerializeField] private TextAsset scriptFile;
    public TextAsset ScriptFile => scriptFile;

    // Track manager handles all voice lifecycle
    private SatieTrackManager trackManager;

    // DSP timing infrastructure
    [Header("DSP Timing")]
    [Tooltip("Random seed for reproducible renders (0 = time-based)")]
    [SerializeField] private int randomSeed = 0;

    private SatieDSPClock dspClock;
    private SatieScheduler scheduler;
    private SatieRandom random;
    private SatieDSPFade dspFade;

    // Mixer groups for DAW-style control
    [SerializeField] private List<SatieMixerGroup> mixerGroups = new List<SatieMixerGroup>();

    // Master controls
    [SerializeField] [Range(0f, 1f)] private float masterVolume = 1f;
    [SerializeField] private bool masterMute = false;

    // Recording
    [Header("Ambisonic Recording")]
    [Tooltip("Reference to AmbisonicRecorder component for scene recording (auto-detected if not set)")]
    [SerializeField] private AmbisonicRecorder ambisonicRecorder;

    // Tracks gen prompts currently being generated to avoid duplicate API calls
    private HashSet<string> pendingGenerations = new HashSet<string>();

    // Components
    private SatieSpatialAudio spatialAudio;

    void Start()
    {
        if (!scriptFile)
        {
            Debug.LogError("SatieRuntime: TextAsset missing.");
            return;
        }

        // Initialize DSP timing infrastructure
        dspClock = new SatieDSPClock();
        dspClock.Start();

        scheduler = new SatieScheduler(dspClock);

        int seed = randomSeed == 0 ? System.Environment.TickCount : randomSeed;
        random = new SatieRandom(seed);

        var fadeGO = new GameObject("[Satie] DSP Fade Manager");
        fadeGO.transform.SetParent(transform);
        dspFade = fadeGO.AddComponent<SatieDSPFade>();
        dspFade.Initialize(dspClock);

        Debug.Log($"[SatieRuntime] Initialized (seed: {seed})");

        // Initialize track manager BEFORE Sync
        trackManager = new SatieTrackManager(this);

        // Get spatial audio component
        spatialAudio = GetComponent<SatieSpatialAudio>();

        // Auto-detect ambisonic recorder if not set
        if (ambisonicRecorder == null)
        {
            ambisonicRecorder = FindObjectOfType<AmbisonicRecorder>();
            if (ambisonicRecorder != null)
            {
                Debug.Log("[SatieRuntime] Auto-detected AmbisonicRecorder");
            }
        }

        Sync(fullReset: true);
    }

#if UNITY_EDITOR
    void Update()
    {
        if (Input.GetKeyDown(KeyCode.R) && !Input.GetKey(KeyCode.LeftShift)) Sync(false);
        if (Input.GetKeyDown(KeyCode.R) &&  Input.GetKey(KeyCode.LeftShift)) Sync(true);

        // Process scheduled events
        if (scheduler != null)
        {
            scheduler.Process();
        }
    }
#else
    void Update()
    {
        // Process scheduled events
        if (scheduler != null)
        {
            scheduler.Process();
        }
    }
#endif
    
    public void Sync(bool fullReset)
    {
        if (fullReset) HardReset();

        // Parse all statements first to check if any are soloed
        List<Satie.Statement> allStatements;
        try
        {
            allStatements = SatieParser.Parse(scriptFile.text);
        }
        catch (Satie.SatieSyntaxException ex)
        {
            Debug.LogError(ex.Message);
            return; // Don't continue with broken script
        }
        catch (System.Exception ex)
        {
            Debug.LogError($"[Satie] Unexpected error parsing script: {ex.Message}\n{ex.StackTrace}");
            return;
        }
        bool anySolo = allStatements.Any(s => s.solo);

        if (anySolo)
            Debug.Log($"[SP] Solo mode active - only solo statements will play");

        // Build a map of current statement keys and their persistent status
        var currentPersistentKeys = new HashSet<string>();
        int lineNumber = 0;
        foreach (var stmt in allStatements)
        {
            for (int i = 0; i < Mathf.Max(1, stmt.count); ++i)
            {
                string stmtKey = $"{lineNumber}_{stmt.kind}_{stmt.clip}_{i}";
                if (stmt.persistent)
                    currentPersistentKeys.Add(stmtKey);
            }
            lineNumber++;
        }

        // Stop any previously persistent tracks that are no longer marked as persistent
        var keysToStop = new List<string>();
        foreach (var track in trackManager.GetPersistentTracks())
        {
            if (!currentPersistentKeys.Contains(track.Key))
            {
                keysToStop.Add(track.Key);
            }
        }
        foreach (var key in keysToStop)
        {
            Debug.Log($"[SP] Stopping previously persistent track (no longer persistent): {key}");
            trackManager.StopTrack(key);
        }

        // Now process all statements
        lineNumber = 0;
        foreach (var stmt in allStatements)
        {
            // Determine if this statement should actually spawn based on solo logic
            bool shouldSpawn = true;

            if (anySolo)
            {
                // If anything is soloed, only spawn solo statements
                shouldSpawn = stmt.solo;
            }
            // Note: mute doesn't affect spawning, only volume (handled in SpawnSource)

            for (int i = 0; i < Mathf.Max(1, stmt.count); ++i)
            {
                // Generate stable key based on script content and position
                // This key will be the same across parses if the script structure doesn't change
                string stmtKey = $"{lineNumber}_{stmt.kind}_{stmt.clip}_{i}";

                // Check if this track is already running
                bool isAlreadyRunning = trackManager.HasTrack(stmtKey);

                // Check if we're past the end time - if so, don't spawn/respawn
                if (stmt.end.isSet)
                {
                    float endTime = random.Sample(stmt.end);
                    if (dspClock.CurrentTime >= endTime)
                    {
                        if (isAlreadyRunning)
                        {
                            trackManager.StopTrack(stmtKey);
                        }
                        continue;
                    }
                }

                // If unsoloed (when solo mode is active), stop it
                if (!shouldSpawn)
                {
                    Debug.Log($"[SP] Skipping non-solo statement: {stmt.clip} (solo mode active)");
                    if (isAlreadyRunning)
                    {
                        trackManager.StopTrack(stmtKey);
                    }
                    continue;
                }

                // Update properties of already-running tracks
                if (isAlreadyRunning)
                {
                    UpdateTrackMuteState(stmtKey, stmt.mute, anySolo && !stmt.solo);
                    continue;
                }

                // Create new track
                var track = trackManager.CreateTrack(stmtKey, stmt);

                // DSP-based playback
                ScheduleDSPPlayback(track, anySolo);
            }
            lineNumber++;
        }

        Debug.Log($"[SP] Synced ({(fullReset ? "full" : "delta")}).");
    }

    void UpdateTrackMuteState(string stmtKey, bool explicitMute, bool implicitMuteFromSolo)
    {
        bool shouldBeMuted = explicitMute || implicitMuteFromSolo;
        trackManager.SetTrackMute(stmtKey, shouldBeMuted);
    }

    AudioSource SpawnSource(Statement s, bool anySoloActive)
    {
        string clipName = SatieUtil.ResolveClip(s.clip, random);
        string fullPath = SatieParser.PathFor(clipName);

        var clip = Resources.Load<AudioClip>(fullPath);
        if (!clip)
        {
            Debug.LogWarning($"[Satie] Audio clip '{clipName}' not found. "
                             + $"Looked for Resources/{fullPath}.*");
            return null;
        }

        var go = new GameObject($"[SP] {clipName}");
        go.transform.SetParent(transform);

        var src = go.AddComponent<AudioSource>();

        src.clip = clip;
        src.loop = (s.kind == "loop");

        // Set mute state: explicit mute flag OR implicitly muted if solo is active and this isn't soloed
        bool shouldBeMuted = s.mute || (anySoloActive && !s.solo);
        src.mute = shouldBeMuted;

        // Initialize volume based on interpolation type to avoid clicks
        if (s.volumeInterpolation != null &&
            s.volumeInterpolation.interpolationType == InterpolationType.Goto)
        {
            src.volume = s.volumeInterpolation.minValue;
        }
        else
        {
            src.volume = 0f;  // Default to 0 for fade-ins or normal volume setting
        }

        // Initialize pitch based on interpolation type
        if (s.pitchInterpolation != null &&
            s.pitchInterpolation.interpolationType == InterpolationType.Goto)
        {
            src.pitch = s.pitchInterpolation.minValue;
        }
        else
        {
            src.pitch = random.Sample(s.pitch);
        }

        if (s.volumeInterpolation != null || s.pitchInterpolation != null)
        {
            var interpComp = go.AddComponent<SatieDSPInterpolator>();
            interpComp.Initialize(dspClock, random);
            interpComp.SetupInterpolations(s);
        }

        // Configure spatial audio using the spatial audio component
        bool is3D = s.wanderType != Statement.WanderType.None;
        if (spatialAudio != null)
        {
            spatialAudio.ConfigureAudioSource(src, is3D);
        }
        else
        {
            // Fallback configuration if no spatial audio component
            src.spatialBlend = is3D ? 1f : 0f;
            if (is3D)
            {
                src.spatialize = true;
                src.spatializePostEffects = true;
                src.dopplerLevel = 0.5f;
                src.spread = 0f;
                src.rolloffMode = AudioRolloffMode.Logarithmic;
                src.minDistance = 1f;
                src.maxDistance = 100f;
            }
        }

        // Random start position (useful for oneshots and loops)
        if (s.randomStart && clip != null)
        {
            src.time = random.Range(0f, clip.length);
        }

        src.Play();

        if (s.wanderType == Statement.WanderType.Walk ||
            s.wanderType == Statement.WanderType.Fly)
        {
            var mover = go.AddComponent<SSpatial>();
            mover.Initialize(dspClock, random, s);
            mover.type = s.wanderType;
            mover.minPos = s.areaMin;
            mover.maxPos = s.areaMax;
            mover.hz = random.Sample(s.wanderHz);
        }
        else if (s.wanderType == Statement.WanderType.Fixed)
        {
            UnityEngine.Vector3 p = new UnityEngine.Vector3(
                random.Range(s.areaMin.x, s.areaMax.x),
                random.Range(s.areaMin.y, s.areaMax.y),
                random.Range(s.areaMin.z, s.areaMax.z));
            go.transform.position = p;
        }

        AddVisuals(go, s);

        // Add color component if color is specified
        if (s.staticColor.HasValue || s.colorRInterpolation != null || s.colorGInterpolation != null || s.colorBInterpolation != null)
        {
            var colorComp = go.AddComponent<SColor>();
            colorComp.Initialize(dspClock, random, s);
        }

        // ===== ADD DSP EFFECTS =====

        float tailTime = 0f;
        bool hasDelayOrReverb = false;

        // Reverb
        if (s.reverbDryWet.isSet || s.reverbRoomSize.isSet || s.reverbDamping.isSet ||
            s.reverbDryWetInterpolation != null || s.reverbRoomSizeInterpolation != null || s.reverbDampingInterpolation != null)
        {
            var reverbComp = go.AddComponent<SatieDSPReverb>();
            reverbComp.Initialize(dspClock, random, s);

            // Reverb tail: larger room = longer tail
            float roomSize = s.reverbRoomSize.isSet ? random.Sample(s.reverbRoomSize) : 0.5f;
            float reverbTail = 2f + roomSize * 4f; // 2-6 seconds based on room size
            tailTime = Mathf.Max(tailTime, reverbTail);
            hasDelayOrReverb = true;
        }

        // Delay
        if (s.delayDryWet.isSet || s.delayTime.isSet || s.delayFeedback.isSet || s.delayPingPong.isSet ||
            s.delayDryWetInterpolation != null || s.delayTimeInterpolation != null ||
            s.delayFeedbackInterpolation != null || s.delayPingPongInterpolation != null)
        {
            var delayComp = go.AddComponent<SatieDSPDelay>();
            delayComp.Initialize(dspClock, random, s);

            // Delay tail: based on time and feedback
            float delayTimeVal = s.delayTime.isSet ? random.Sample(s.delayTime) : 0.5f;
            float feedbackVal = s.delayFeedback.isSet ? random.Sample(s.delayFeedback) : 0.5f;
            // Calculate decay time: time it takes for feedback to drop to -60dB
            float delayTail = delayTimeVal * Mathf.Log(0.001f) / Mathf.Log(feedbackVal);
            delayTail = Mathf.Clamp(delayTail, 1f, 10f); // Clamp to reasonable range
            tailTime = Mathf.Max(tailTime, delayTail);
            hasDelayOrReverb = true;
        }

        // Filter
        if (s.filterCutoff.isSet || s.filterResonance.isSet || s.filterDryWet.isSet || s.filterMode != null ||
            s.filterCutoffInterpolation != null || s.filterResonanceInterpolation != null || s.filterDryWetInterpolation != null)
        {
            var filterComp = go.AddComponent<SatieDSPFilter>();
            filterComp.Initialize(dspClock, random, s);
        }

        // Distortion
        if (s.distortionDrive.isSet || s.distortionDryWet.isSet || s.distortionMode != null ||
            s.distortionDriveInterpolation != null || s.distortionDryWetInterpolation != null)
        {
            var distortionComp = go.AddComponent<SatieDSPDistortion>();
            distortionComp.Initialize(dspClock, random, s);
        }

        // EQ
        if (s.eqLowGain.isSet || s.eqMidGain.isSet || s.eqHighGain.isSet ||
            s.eqLowGainInterpolation != null || s.eqMidGainInterpolation != null || s.eqHighGainInterpolation != null)
        {
            var eqComp = go.AddComponent<SatieDSPEQ>();
            eqComp.Initialize(dspClock, random, s);
        }

        // Add tail handler for oneshots with delay/reverb
        if (s.kind == "oneshot" && hasDelayOrReverb && tailTime > 0f)
        {
            var tailHandler = go.AddComponent<SatieDSPTailHandler>();
            tailHandler.Initialize(src, tailTime, false); // false = oneshot (not loop)
        }

        // Add Steam Audio components if available and source is spatialized
        if (spatialAudio != null && s.wanderType != Statement.WanderType.None)
        {
            spatialAudio.AddSteamAudioComponents(go);
        }

        // Add ambisonic encoder if recorder is present
        if (ambisonicRecorder != null)
        {
            go.AddComponent<AmbisonicSourceEncoder>();
            Debug.Log($"[SatieRuntime] Added AmbisonicSourceEncoder to {go.name}");
        }
        else
        {
            Debug.LogWarning($"[SatieRuntime] ambisonicRecorder is NULL, cannot add encoder to {go.name}");
        }

        // Handle initial volume based on interpolation type
        if (s.volumeInterpolation != null &&
            s.volumeInterpolation.interpolationType == InterpolationType.Goto)
        {
            // For goto, start at the min value to avoid clicks
            src.volume = s.volumeInterpolation.minValue;
        }
        else if (s.volumeInterpolation == null && s.fade_in.isSet)
        {
            float targetVol = random.Sample(s.volume);
            float fadeInDur = random.Sample(s.fade_in);
            dspFade.FadeVolume(src, 0f, targetVol, fadeInDur);
        }
        else if (s.volumeInterpolation == null)
        {
            src.volume = random.Sample(s.volume);
        }

        return src;
    }

    void AddVisuals(GameObject go, Statement s)
    {
        foreach (string visual in s.visual)
        {
            if (visual.StartsWith("object:"))
            {
                // Load prefab from Resources
                string prefabPath = visual.Substring(7);
                string fullPath = $"Prefabs/{SatieUtil.ResolveClip(prefabPath, random)}";
                GameObject prefab = Resources.Load<GameObject>(fullPath);
                
                if (prefab != null)
                {
                    GameObject instance = Instantiate(prefab, go.transform);
                    instance.transform.localPosition = UnityEngine.Vector3.zero;
                }
                else
                {
                    Debug.LogWarning($"[Satie] Prefab '{fullPath}' not found in Resources.");
                }
            }
            else
            {
                // Handle primitive visuals
                switch (visual)
                {
                    case "trail":
                        AddTrail(go);
                        break;
                    case "sphere":
                        AddPrimitive(go, PrimitiveType.Sphere);
                        break;
                    case "cube":
                        AddPrimitive(go, PrimitiveType.Cube);
                        break;
                    case "cylinder":
                        AddPrimitive(go, PrimitiveType.Cylinder);
                        break;
                    case "capsule":
                        AddPrimitive(go, PrimitiveType.Capsule);
                        break;
                    case "plane":
                        AddPrimitive(go, PrimitiveType.Plane);
                        break;
                    case "quad":
                        AddPrimitive(go, PrimitiveType.Quad);
                        break;
                    default:
                        Debug.LogWarning($"[Satie] Unknown visual type: '{visual}'");
                        break;
                }
            }
        }
    }

    void AddTrail(GameObject go)
    {
        var tr = go.AddComponent<TrailRenderer>();
        tr.widthMultiplier = 0.1f;
        tr.time = 5f;
        tr.material = new UnityEngine.Material(Shader.Find("Sprites/Default"));
        tr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;

        // Default to white, will be overridden by SColor if specified
        Color start = Color.white;
        Color end   = new Color(start.r, start.g, start.b, 0f);

        var grad = new Gradient();
        grad.SetKeys(
            new[] { new GradientColorKey(start, 0f), new GradientColorKey(end, 1f) },
            new[] { new GradientAlphaKey(1f, 0f),    new GradientAlphaKey(0f, 1f) }
        );
        tr.colorGradient = grad;
    }

    void AddPrimitive(GameObject go, PrimitiveType type)
    {
        GameObject primitive = GameObject.CreatePrimitive(type);
        primitive.transform.SetParent(go.transform);
        primitive.transform.localPosition = UnityEngine.Vector3.zero;
        primitive.transform.localScale = UnityEngine.Vector3.one * 0.5f;

        Collider col = primitive.GetComponent<Collider>();
        if (col) Destroy(col);

        Renderer rend = primitive.GetComponent<Renderer>();
        if (rend)
        {
            rend.material = new UnityEngine.Material(Shader.Find("Standard"));
            // Default to white, will be overridden by SColor if specified
            rend.material.color = Color.white;
        }
    }

    void HardReset()
    {
        // Safety check - trackManager might not be initialized yet
        if (trackManager == null) return;

        // Stop all non-persistent tracks
        trackManager.StopAllTracks(includePersistent: false);

        // Cancel all scheduled DSP events
        if (scheduler != null)
        {
            scheduler.CancelAll();
        }

        // DO NOT reset DSP clock - this would restart interpolations on persistent tracks
        // The clock continues running to preserve the state of persistent content
        // Only reset it if there are no persistent tracks
        int persistentCount = trackManager.GetPersistentTrackCount();
        if (persistentCount == 0 && dspClock != null)
        {
            dspClock.Reset();
        }

        // Reset random seed
        if (random != null)
        {
            int seed = randomSeed == 0 ? System.Environment.TickCount : randomSeed;
            random.Reset(seed);
        }

        Debug.Log($"[SP] HardReset complete. {persistentCount} persistent tracks remain.");
    }

    /// <summary>
    /// Schedule playback for a track
    /// </summary>
    void ScheduleDSPPlayback(SatieTrack track, bool anySoloActive)
    {
        Statement s = track.Statement;

        // Gen-aware: if this is a generated clip, check if it exists yet
        if (s.isGenerated)
        {
            string clipName = SatieUtil.ResolveClip(s.clip, random);
            var existingClip = Resources.Load<AudioClip>(SatieParser.PathFor(clipName));
            if (existingClip == null)
            {
                TriggerAsyncGeneration(track, anySoloActive);
                return; // Don't schedule yet — will be scheduled after generation
            }
            // Clip exists — fall through to normal scheduling
        }

        // Use 'start' if set, otherwise fall back to legacy 'starts_at'
        float startDelay = s.start.isSet ? random.Sample(s.start) : random.Sample(s.starts_at);

        // Add small buffer (0.1s) to ensure event fires in the future
        const double SCHEDULE_BUFFER = 0.1;
        double startTime = dspClock.CurrentTime + startDelay + SCHEDULE_BUFFER;

        if (s.kind == "loop")
        {
            ScheduleDSPLoop(track, startTime, anySoloActive);
        }
        else
        {
            ScheduleDSPOneShot(track, startTime, anySoloActive);
        }

        // Schedule track destruction if 'end' is specified
        if (s.end.isSet)
        {
            float endTime = random.Sample(s.end);
            float fadeTime = s.endFade.isSet ? random.Sample(s.endFade) : 0f;

            // Schedule fade out if specified
            if (fadeTime > 0f)
            {
                double fadeStartTime = dspClock.CurrentTime + endTime - fadeTime + SCHEDULE_BUFFER;
                var fadeEvent = SatieAudioEvent.Callback(
                    dspClock.SecondsToSamples(fadeStartTime),
                    () => {
                        // Fade all sources in this track
                        foreach (var src in track.Sources)
                        {
                            if (src && !src.mute)
                            {
                                dspFade.FadeVolume(src, src.volume, 0f, fadeTime);
                            }
                        }
                    },
                    $"End Fade: {s.clip}"
                );
                scheduler.Schedule(fadeEvent);
            }

            // Schedule track destruction
            double destroyTime = dspClock.CurrentTime + endTime + SCHEDULE_BUFFER;
            var destroyEvent = SatieAudioEvent.Callback(
                dspClock.SecondsToSamples(destroyTime),
                () => {
                    string trackKey = track.Key;
                    trackManager.StopTrack(trackKey);
                    Debug.Log($"[SatieRuntime] Track '{s.clip}' ended at {endTime}s");
                },
                $"End Track: {s.clip}"
            );
            scheduler.Schedule(destroyEvent);
        }
    }

    /// <summary>
    /// Schedule a loop statement
    /// </summary>
    void ScheduleDSPLoop(SatieTrack track, double startTime, bool anySoloActive)
    {
        Statement s = track.Statement;

        // Schedule the initial play event
        var playEvent = SatieAudioEvent.Callback(
            dspClock.SecondsToSamples(startTime),
            () => {
                var src = SpawnSource(s, anySoloActive);
                if (src)
                {
                    track.AddSource(src);

                    // If duration is set, schedule stop event
                    if (s.duration.isSet)
                    {
                        float duration = random.Sample(s.duration);
                        float fadeOut = random.Sample(s.fade_out);
                        double stopTime = dspClock.CurrentTime + duration;

                        ScheduleDSPStopAfter(src, stopTime, fadeOut, track.Key);
                    }
                }
            },
            $"Loop Start: {s.clip}"
        );

        scheduler.Schedule(playEvent);

        Debug.Log($"[DSP] Scheduled loop '{s.clip}' at {startTime:F3}s");
    }

    /// <summary>
    /// Schedule a oneshot statement
    /// </summary>
    void ScheduleDSPOneShot(SatieTrack track, double startTime, bool anySoloActive)
    {
        Statement s = track.Statement;

        if (!s.every.isSet)
        {
            // Play once
            var playEvent = SatieAudioEvent.Callback(
                dspClock.SecondsToSamples(startTime),
                () => {
                    var src = SpawnSource(s, anySoloActive);
                    if (src) track.AddSource(src);
                },
                $"OneShot: {s.clip}"
            );
            scheduler.Schedule(playEvent);

            Debug.Log($"[DSP] Scheduled oneshot '{s.clip}' at {startTime:F3}s");
        }
        else
        {
            // Repeating oneshot - schedule first play and chain subsequent plays
            ScheduleDSPRepeatingOneShot(track, startTime, anySoloActive);
        }
    }

    /// <summary>
    /// Schedule repeating oneshot events
    /// </summary>
    void ScheduleDSPRepeatingOneShot(SatieTrack track, double startTime, bool anySoloActive)
    {
        Statement s = track.Statement;
        AudioSource persistentSource = null;

        // Auto-enable overlap for sounds with delay/reverb (to preserve tails)
        bool hasDelayOrReverb = (s.delayDryWet.isSet || s.delayTime.isSet || s.delayFeedback.isSet ||
                                  s.delayDryWetInterpolation != null || s.delayTimeInterpolation != null ||
                                  s.reverbDryWet.isSet || s.reverbRoomSize.isSet ||
                                  s.reverbDryWetInterpolation != null || s.reverbRoomSizeInterpolation != null);
        bool shouldOverlap = s.overlap || hasDelayOrReverb;

        // Create recursive callback for repeating
        System.Action scheduleNext = null;
        scheduleNext = () =>
        {
            double currentTime = dspClock.CurrentTime;

            if (shouldOverlap)
            {
                // Spawn new source each time
                var src = SpawnSource(s, anySoloActive);
                if (src) track.AddSource(src);
            }
            else
            {
                // Reuse persistent source
                if (persistentSource == null)
                {
                    persistentSource = SpawnSource(s, anySoloActive);
                    if (persistentSource) track.AddSource(persistentSource);
                }
                else
                {
                    // Update clip and parameters
                    string clipName = SatieUtil.ResolveClip(s.clip, random);
                    var newClip = Resources.Load<AudioClip>(SatieParser.PathFor(clipName));
                    if (newClip)
                    {
                        persistentSource.clip = newClip;

                        if (s.pitchInterpolation == null)
                            persistentSource.pitch = random.Sample(s.pitch);

                        float targetVol = random.Sample(s.volume);

                        if (s.volumeInterpolation != null &&
                            s.volumeInterpolation.interpolationType == InterpolationType.Goto)
                        {
                            persistentSource.volume = s.volumeInterpolation.minValue;
                        }
                        else if (s.volumeInterpolation == null && s.fade_in.isSet)
                        {
                            // Use DSP fade
                            float fadeInDur = random.Sample(s.fade_in);
                            dspFade.FadeVolume(persistentSource, 0f, targetVol, fadeInDur);
                        }
                        else if (s.volumeInterpolation == null)
                        {
                            persistentSource.volume = targetVol;
                        }

                        // Random start position
                        if (s.randomStart && newClip != null)
                        {
                            persistentSource.time = random.Range(0f, newClip.length);
                        }
                        else
                        {
                            persistentSource.time = 0f;
                        }
                        persistentSource.Play();

                        float fadeOut = random.Sample(s.fade_out);
                        if (fadeOut > 0f)
                        {
                            double fadeStartTime = dspClock.CurrentTime + (persistentSource.clip.length - fadeOut);
                            var fadeEvent = SatieAudioEvent.Callback(
                                dspClock.SecondsToSamples(fadeStartTime),
                                () => {
                                    if (persistentSource)
                                        dspFade.FadeVolume(persistentSource, persistentSource.volume, 0f, fadeOut);
                                },
                                "Fade Out"
                            );
                            scheduler.Schedule(fadeEvent);
                        }
                    }
                }
            }

            // Schedule next repetition
            float interval = random.Sample(s.every);
            double nextTime = currentTime + interval;

            var nextEvent = SatieAudioEvent.Callback(
                dspClock.SecondsToSamples(nextTime),
                scheduleNext,
                $"Repeat OneShot: {s.clip}"
            );
            scheduler.Schedule(nextEvent);
        };

        // Schedule first play
        var firstEvent = SatieAudioEvent.Callback(
            dspClock.SecondsToSamples(startTime),
            scheduleNext,
            $"Repeating OneShot Start: {s.clip}"
        );
        scheduler.Schedule(firstEvent);

        Debug.Log($"[DSP] Scheduled repeating oneshot '{s.clip}' starting at {startTime:F3}s");
    }

    /// <summary>
    /// Schedule a stop event with fade-out
    /// </summary>
    void ScheduleDSPStopAfter(AudioSource src, double stopTime, float fadeOut, string trackKey)
    {
        if (fadeOut > 0f)
        {
            double fadeStartTime = stopTime - fadeOut;
            var fadeEvent = SatieAudioEvent.Callback(
                dspClock.SecondsToSamples(fadeStartTime),
                () => {
                    if (src && dspFade != null)
                    {
                        dspFade.FadeVolume(src, src.volume, 0f, fadeOut);
                    }
                },
                $"Fade Start: {trackKey}"
            );
            scheduler.Schedule(fadeEvent);
        }

        // Schedule stop
        var stopEvent = SatieAudioEvent.Callback(
            dspClock.SecondsToSamples(stopTime),
            () => {
                if (src) src.Stop();
            },
            $"Stop: {trackKey}"
        );
        scheduler.Schedule(stopEvent);
    }

    /// <summary>
    /// Fire off async audio generation for a gen statement.
    /// Deduplicates by genPrompt so the same prompt doesn't trigger multiple API calls.
    /// </summary>
    async void TriggerAsyncGeneration(SatieTrack track, bool anySoloActive)
    {
        Statement s = track.Statement;
        string prompt = s.genPrompt;
        // Use clip name as dedup key — each variant has a unique clip (e.g., bird_chirping_1, bird_chirping_2)
        string genKey = s.clip;

        // If another track already triggered generation for this clip, poll for completion
        if (pendingGenerations.Contains(genKey))
        {
            WaitForGenerationAndSchedule(track, anySoloActive);
            return;
        }

        pendingGenerations.Add(genKey);
        try
        {
            // Extract target clip name from the clip path (e.g., "generation/bird_chirping_1" → "bird_chirping_1")
            string targetClipName = s.clip.Contains("/")
                ? s.clip.Substring(s.clip.LastIndexOf('/') + 1)
                : s.clip;

            Debug.Log($"[SatieRuntime] Starting generation for '{prompt}' → {targetClipName}");
            bool success = await SatieAudioGen.Instance.GenerateIfNeeded(prompt, targetClipName, s.kind == "loop");

            if (!success)
            {
                Debug.LogError($"[SatieRuntime] Generation failed for '{prompt}' — track will remain silent.");
                return;
            }

            // Verify track still exists (user may have re-synced while we were generating)
            if (!trackManager.HasTrack(track.Key))
            {
                Debug.Log($"[SatieRuntime] Track '{track.Key}' no longer exists after generation — skipping playback.");
                return;
            }

            Debug.Log($"[SatieRuntime] Generation complete for '{prompt}' → {targetClipName} — scheduling playback.");
            ScheduleDSPPlayback(track, anySoloActive);
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[SatieRuntime] Generation error for '{prompt}': {e.Message}");
        }
        finally
        {
            pendingGenerations.Remove(genKey);
        }
    }

    /// <summary>
    /// When a second track has the same clip as an in-flight generation,
    /// poll every 500ms until the first completes, then schedule playback. Max wait 60s.
    /// </summary>
    async void WaitForGenerationAndSchedule(SatieTrack track, bool anySoloActive)
    {
        string genKey = track.Statement.clip;
        Debug.Log($"[SatieRuntime] Waiting for in-flight generation of '{genKey}' to complete...");

        float waited = 0f;
        const float pollInterval = 0.5f;
        const float maxWait = 60f;

        while (pendingGenerations.Contains(genKey) && waited < maxWait)
        {
            await Task.Delay((int)(pollInterval * 1000));
            waited += pollInterval;
        }

        if (waited >= maxWait)
        {
            Debug.LogError($"[SatieRuntime] Timed out waiting for generation of '{genKey}'.");
            return;
        }

        if (!trackManager.HasTrack(track.Key))
        {
            Debug.Log($"[SatieRuntime] Track '{track.Key}' no longer exists after waiting — skipping.");
            return;
        }

        ScheduleDSPPlayback(track, anySoloActive);
    }

    // ===== Public API for Track Control =====

    /// <summary>
    /// Get the track manager for direct access to all tracks
    /// </summary>
    public SatieTrackManager GetTrackManager()
    {
        return trackManager;
    }

    /// <summary>
    /// Stop a specific track by its key
    /// </summary>
    public void StopTrack(string trackKey)
    {
        trackManager?.StopTrack(trackKey);
    }

    /// <summary>
    /// Mute/unmute a specific track
    /// </summary>
    public void SetTrackMute(string trackKey, bool muted)
    {
        trackManager?.SetTrackMute(trackKey, muted);
    }

    /// <summary>
    /// Set volume for a specific track
    /// </summary>
    public void SetTrackVolume(string trackKey, float volume)
    {
        trackManager?.SetTrackVolume(trackKey, volume);
    }

    /// <summary>
    /// Set pitch for a specific track
    /// </summary>
    public void SetTrackPitch(string trackKey, float pitch)
    {
        trackManager?.SetTrackPitch(trackKey, pitch);
    }

    /// <summary>
    /// Get a track by its key for more advanced control
    /// </summary>
    public SatieTrack GetTrack(string trackKey)
    {
        return trackManager?.GetTrack(trackKey);
    }

    /// <summary>
    /// Get all currently active tracks
    /// </summary>
    public IEnumerable<SatieTrack> GetAllTracks()
    {
        return trackManager?.GetAllTracks() ?? Enumerable.Empty<SatieTrack>();
    }

    /// <summary>
    /// Get all persistent tracks
    /// </summary>
    public IEnumerable<SatieTrack> GetPersistentTracks()
    {
        return trackManager?.GetPersistentTracks() ?? Enumerable.Empty<SatieTrack>();
    }

    /// <summary>
    /// Stop all tracks (optionally include persistent ones)
    /// </summary>
    public void StopAllTracks(bool includePersistent = true)
    {
        trackManager?.StopAllTracks(includePersistent);
    }

    /// <summary>
    /// Mute/unmute all tracks
    /// </summary>
    public void MuteAllTracks(bool muted)
    {
        trackManager?.MuteAllTracks(muted);
    }

    /// <summary>
    /// Get count of active tracks
    /// </summary>
    public int GetTrackCount()
    {
        return trackManager?.GetTrackCount() ?? 0;
    }

    /// <summary>
    /// Print debug info for all tracks
    /// </summary>
    public void PrintTrackDebugInfo()
    {
        trackManager?.PrintDebugInfo();
    }

    // ===== Mixer Group API =====

    /// <summary>
    /// Get all mixer groups
    /// </summary>
    public List<SatieMixerGroup> GetMixerGroups()
    {
        return mixerGroups;
    }

    /// <summary>
    /// Add a new mixer group
    /// </summary>
    public SatieMixerGroup AddMixerGroup(string name)
    {
        var group = new SatieMixerGroup(name);
        mixerGroups.Add(group);
        return group;
    }

    /// <summary>
    /// Remove a mixer group
    /// </summary>
    public void RemoveMixerGroup(SatieMixerGroup group)
    {
        mixerGroups.Remove(group);
    }

    /// <summary>
    /// Apply mixer group settings to all tracks
    /// </summary>
    public void ApplyMixerGroups()
    {
        if (trackManager == null) return;

        // Check if any group is soloed
        bool anyGroupSoloed = mixerGroups.Any(g => g.solo);

        // Apply each group's settings to its tracks
        foreach (var group in mixerGroups)
        {
            group.ApplyToTracks(trackManager, anyGroupSoloed);
        }

        // Apply master volume and mute to all tracks
        foreach (var track in trackManager.GetAllTracks())
        {
            if (track.Sources.Count > 0)
            {
                foreach (var src in track.Sources)
                {
                    if (src)
                    {
                        // Apply master volume on top of existing volume
                        src.volume *= masterVolume;
                        // Apply master mute
                        if (masterMute)
                            src.mute = true;
                    }
                }
            }
        }
    }

    /// <summary>
    /// Get master volume
    /// </summary>
    public float GetMasterVolume()
    {
        return masterVolume;
    }

    /// <summary>
    /// Set master volume
    /// </summary>
    public void SetMasterVolume(float volume)
    {
        masterVolume = Mathf.Clamp01(volume);
        ApplyMixerGroups();
    }

    /// <summary>
    /// Get master mute state
    /// </summary>
    public bool GetMasterMute()
    {
        return masterMute;
    }

    /// <summary>
    /// Set master mute state
    /// </summary>
    public void SetMasterMute(bool muted)
    {
        masterMute = muted;
        ApplyMixerGroups();
    }

    // ===== DSP Timing API =====

    /// <summary>
    /// Get the DSP clock for sample-accurate timing
    /// </summary>
    public SatieDSPClock GetDSPClock()
    {
        return dspClock;
    }

    /// <summary>
    /// Get the event scheduler
    /// </summary>
    public SatieScheduler GetScheduler()
    {
        return scheduler;
    }

    /// <summary>
    /// Get the seeded random generator for reproducible renders
    /// </summary>
    public SatieRandom GetRandom()
    {
        return random;
    }

    /// <summary>
    /// Get the DSP fade manager
    /// </summary>
    public SatieDSPFade GetDSPFade()
    {
        return dspFade;
    }

    /// <summary>
    /// Check if DSP timing is initialized
    /// </summary>
    public bool IsDSPTimingEnabled()
    {
        return dspClock != null;
    }

    /// <summary>
    /// Reset the random generator with a new seed
    /// </summary>
    public void ResetRandom(int newSeed)
    {
        if (random != null)
        {
            random.Reset(newSeed);
            Debug.Log($"[SatieRuntime] Random seed reset to {newSeed}");
        }
    }

    /// <summary>
    /// Print DSP timing debug information
    /// </summary>
    public void PrintTimingDebug()
    {
        if (dspClock != null)
        {
            Debug.Log($"[DSP] {dspClock.GetDebugInfo()}");
        }
        if (scheduler != null)
        {
            Debug.Log($"[DSP] {scheduler.GetDebugInfo()}");
            scheduler.PrintTimeline();
        }
    }
}
}
