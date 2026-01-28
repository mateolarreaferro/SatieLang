using UnityEngine;

namespace Satie
{
/// <summary>
/// Test script to compare coroutine-based vs DSP-based playback.
/// Tests Phase 2 implementation - event scheduling replacing WaitForSeconds.
/// </summary>
public class SatieDSPPlaybackTest : MonoBehaviour
{
    [Header("Test Configuration")]
    [Tooltip("Reference to SatieRuntime component")]
    [SerializeField] private SatieRuntime runtime;

    [Tooltip("Auto-detect SatieRuntime if not set")]
    [SerializeField] private bool autoDetect = true;

    [Header("Test Controls")]
    [Tooltip("Press P to toggle DSP playback mode")]
    public KeyCode togglePlaybackKey = KeyCode.P;

    [Tooltip("Press L to print scheduler timeline")]
    public KeyCode printTimelineKey = KeyCode.L;

    [Tooltip("Press I to show playback info")]
    public KeyCode showInfoKey = KeyCode.I;

    private bool lastDSPPlaybackState = false;

    private void Start()
    {
        if (autoDetect && runtime == null)
        {
            runtime = FindObjectOfType<SatieRuntime>();
            if (runtime != null)
            {
                Debug.Log("[DSPPlaybackTest] Auto-detected SatieRuntime");
            }
            else
            {
                Debug.LogError("[DSPPlaybackTest] No SatieRuntime found in scene!");
            }
        }

        if (runtime != null)
        {
            Debug.Log("[DSPPlaybackTest] Phase 2 Test Controls:");
            Debug.Log($"  {togglePlaybackKey} - Toggle DSP playback mode");
            Debug.Log($"  {printTimelineKey} - Print scheduler timeline");
            Debug.Log($"  {showInfoKey} - Show playback info");
            Debug.Log($"  R - Reload script (test hot-reload)");
            Debug.Log($"  Shift+R - Full reset");
        }
    }

    private void Update()
    {
        if (runtime == null) return;

        // Toggle DSP playback mode
        if (Input.GetKeyDown(togglePlaybackKey))
        {
            ToggleDSPPlayback();
        }

        // Print scheduler timeline
        if (Input.GetKeyDown(printTimelineKey))
        {
            PrintTimeline();
        }

        // Show playback info
        if (Input.GetKeyDown(showInfoKey))
        {
            ShowPlaybackInfo();
        }
    }

    private void ToggleDSPPlayback()
    {
        if (!runtime.IsDSPTimingEnabled())
        {
            Debug.LogWarning("[DSPPlaybackTest] DSP timing not enabled! Enable 'Use DSP Timing' first.");
            return;
        }

        // Access via reflection to toggle the private field
        var field = typeof(SatieRuntime).GetField("useDSPPlayback",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);

        if (field != null)
        {
            bool currentValue = (bool)field.GetValue(runtime);
            bool newValue = !currentValue;
            field.SetValue(runtime, newValue);

            Debug.Log($"[DSPPlaybackTest] DSP Playback: {(newValue ? "ENABLED" : "DISABLED")}");
            Debug.Log($"[DSPPlaybackTest] Mode: {(newValue ? "Event-based scheduling" : "Coroutine-based")}");
            Debug.Log($"[DSPPlaybackTest] Press R to reload script and apply change");
        }
    }

    private void PrintTimeline()
    {
        if (!runtime.IsDSPTimingEnabled())
        {
            Debug.LogWarning("[DSPPlaybackTest] DSP timing not enabled!");
            return;
        }

        var scheduler = runtime.GetScheduler();
        if (scheduler != null)
        {
            scheduler.PrintTimeline();
        }
        else
        {
            Debug.LogWarning("[DSPPlaybackTest] Scheduler not available");
        }
    }

    private void ShowPlaybackInfo()
    {
        Debug.Log("[DSPPlaybackTest] === Playback Info ===");

        bool dspTimingEnabled = runtime.IsDSPTimingEnabled();
        Debug.Log($"DSP Timing: {(dspTimingEnabled ? "ENABLED" : "DISABLED")}");

        if (dspTimingEnabled)
        {
            var clock = runtime.GetDSPClock();
            var scheduler = runtime.GetScheduler();

            Debug.Log($"Current DSP Time: {clock.CurrentTime:F3}s");
            Debug.Log($"Current Sample: {clock.CurrentSample}");
            Debug.Log($"Pending Events: {scheduler.EventCount}");
            Debug.Log($"Events Processed: {scheduler.TotalProcessed}/{scheduler.TotalScheduled}");

            // Check playback mode via reflection
            var field = typeof(SatieRuntime).GetField("useDSPPlayback",
                System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            if (field != null)
            {
                bool useDSPPlayback = (bool)field.GetValue(runtime);
                Debug.Log($"Playback Mode: {(useDSPPlayback ? "DSP-based (Phase 2)" : "Coroutine-based (Original)")}");
            }
        }

        var trackManager = runtime.GetTrackManager();
        if (trackManager != null)
        {
            Debug.Log($"Active Tracks: {trackManager.GetTrackCount()}");
            Debug.Log($"Persistent Tracks: {trackManager.GetPersistentTrackCount()}");
        }
    }

    private void OnGUI()
    {
        if (runtime == null || !runtime.IsDSPTimingEnabled()) return;

        GUILayout.BeginArea(new Rect(10, 220, 500, 200));
        GUILayout.Box("DSP Playback Test (Phase 2)");

        var clock = runtime.GetDSPClock();
        var scheduler = runtime.GetScheduler();
        var trackManager = runtime.GetTrackManager();

        GUILayout.Label($"DSP Time: {clock.CurrentTime:F3}s");
        GUILayout.Label($"Pending Events: {scheduler.EventCount}");
        GUILayout.Label($"Active Tracks: {trackManager.GetTrackCount()}");

        // Get playback mode via reflection
        var field = typeof(SatieRuntime).GetField("useDSPPlayback",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        if (field != null)
        {
            bool useDSPPlayback = (bool)field.GetValue(runtime);
            string modeColor = useDSPPlayback ? "green" : "yellow";
            string mode = useDSPPlayback ? "DSP-based (Phase 2)" : "Coroutine-based";
            GUILayout.Label($"Mode: <color={modeColor}>{mode}</color>");
        }

        GUILayout.Space(10);
        GUILayout.Label($"Press {togglePlaybackKey} to toggle mode");
        GUILayout.Label($"Press {printTimelineKey} to print timeline");
        GUILayout.Label($"Press {showInfoKey} for detailed info");
        GUILayout.Label($"Press R to reload (test mode change)");

        GUILayout.EndArea();
    }
}
}
