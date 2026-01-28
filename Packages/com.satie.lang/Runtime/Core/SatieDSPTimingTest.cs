using UnityEngine;

namespace Satie
{
/// <summary>
/// Test script to verify DSP timing infrastructure.
/// Attach this to a GameObject with SatieRuntime to test the new timing system.
/// </summary>
public class SatieDSPTimingTest : MonoBehaviour
{
    [Header("Test Configuration")]
    [Tooltip("Reference to SatieRuntime component")]
    [SerializeField] private SatieRuntime runtime;

    [Tooltip("Auto-detect SatieRuntime if not set")]
    [SerializeField] private bool autoDetect = true;

    [Header("Test Controls")]
    [Tooltip("Press T to run timing accuracy test")]
    public KeyCode testTimingKey = KeyCode.T;

    [Tooltip("Press S to schedule test events")]
    public KeyCode scheduleEventsKey = KeyCode.S;

    [Tooltip("Press D to show debug info")]
    public KeyCode debugInfoKey = KeyCode.D;

    [Tooltip("Press X to test seeded randomness")]
    public KeyCode randomTestKey = KeyCode.X;

    private void Start()
    {
        if (autoDetect && runtime == null)
        {
            runtime = FindObjectOfType<SatieRuntime>();
            if (runtime != null)
            {
                Debug.Log("[DSPTest] Auto-detected SatieRuntime");
            }
            else
            {
                Debug.LogError("[DSPTest] No SatieRuntime found in scene!");
            }
        }

        if (runtime != null)
        {
            Debug.Log("[DSPTest] Test controls:");
            Debug.Log($"  {testTimingKey} - Run timing accuracy test");
            Debug.Log($"  {scheduleEventsKey} - Schedule test events");
            Debug.Log($"  {debugInfoKey} - Show debug info");
            Debug.Log($"  {randomTestKey} - Test seeded randomness");
        }
    }

    private void Update()
    {
        if (runtime == null) return;

        if (Input.GetKeyDown(testTimingKey))
        {
            RunTimingAccuracyTest();
        }

        if (Input.GetKeyDown(scheduleEventsKey))
        {
            ScheduleTestEvents();
        }

        if (Input.GetKeyDown(debugInfoKey))
        {
            ShowDebugInfo();
        }

        if (Input.GetKeyDown(randomTestKey))
        {
            TestSeededRandomness();
        }
    }

    /// <summary>
    /// Test timing accuracy by comparing DSP time vs frame time over multiple frames
    /// </summary>
    private void RunTimingAccuracyTest()
    {
        if (!runtime.IsDSPTimingEnabled())
        {
            Debug.LogWarning("[DSPTest] DSP timing is not enabled! Enable 'Use DSP Timing' in SatieRuntime inspector.");
            return;
        }

        StartCoroutine(TimingAccuracyTestCoroutine());
    }

    private System.Collections.IEnumerator TimingAccuracyTestCoroutine()
    {
        Debug.Log("[DSPTest] === Timing Accuracy Test (10 seconds) ===");

        var clock = runtime.GetDSPClock();
        float startFrameTime = Time.time;
        double startDSPTime = clock.CurrentTime;

        float lastFrameTime = startFrameTime;
        double lastDSPTime = startDSPTime;

        for (int i = 0; i < 600; i++) // 10 seconds at 60fps
        {
            yield return null;

            float currentFrameTime = Time.time;
            double currentDSPTime = clock.CurrentTime;

            float frameDelta = currentFrameTime - lastFrameTime;
            double dspDelta = currentDSPTime - lastDSPTime;
            double drift = dspDelta - frameDelta;

            if (i % 60 == 0) // Log every second
            {
                Debug.Log($"[DSPTest] Frame {i}: " +
                         $"Frame Δ={frameDelta * 1000:F2}ms, " +
                         $"DSP Δ={dspDelta * 1000:F2}ms, " +
                         $"Drift={drift * 1000:F3}ms");
            }

            lastFrameTime = currentFrameTime;
            lastDSPTime = currentDSPTime;
        }

        float totalFrameTime = Time.time - startFrameTime;
        double totalDSPTime = clock.CurrentTime - startDSPTime;
        double totalDrift = totalDSPTime - totalFrameTime;

        Debug.Log($"[DSPTest] === Test Complete ===");
        Debug.Log($"[DSPTest] Total Frame Time: {totalFrameTime:F3}s");
        Debug.Log($"[DSPTest] Total DSP Time: {totalDSPTime:F3}s");
        Debug.Log($"[DSPTest] Total Drift: {totalDrift * 1000:F2}ms ({(totalDrift / totalDSPTime * 100):F3}%)");
    }

    /// <summary>
    /// Schedule test events at specific times
    /// </summary>
    private void ScheduleTestEvents()
    {
        if (!runtime.IsDSPTimingEnabled())
        {
            Debug.LogWarning("[DSPTest] DSP timing is not enabled!");
            return;
        }

        var scheduler = runtime.GetScheduler();
        var clock = runtime.GetDSPClock();

        Debug.Log("[DSPTest] Scheduling 5 test events at 1-second intervals...");

        for (int i = 1; i <= 5; i++)
        {
            int eventNum = i;
            var evt = SatieAudioEvent.Callback(
                clock.SecondsToSamples(i),
                () => Debug.Log($"[DSPTest] Event {eventNum} fired at {clock.CurrentTime:F3}s"),
                $"Test Event {i}"
            );
            scheduler.Schedule(evt);
        }

        Debug.Log($"[DSPTest] {scheduler.EventCount} events scheduled");
    }

    /// <summary>
    /// Show current debug info
    /// </summary>
    private void ShowDebugInfo()
    {
        if (!runtime.IsDSPTimingEnabled())
        {
            Debug.LogWarning("[DSPTest] DSP timing is not enabled!");
            return;
        }

        Debug.Log("[DSPTest] === Current State ===");
        runtime.PrintTimingDebug();
    }

    /// <summary>
    /// Test that seeded randomness is reproducible
    /// </summary>
    private void TestSeededRandomness()
    {
        if (!runtime.IsDSPTimingEnabled())
        {
            Debug.LogWarning("[DSPTest] DSP timing is not enabled!");
            return;
        }

        var random = runtime.GetRandom();
        int testSeed = 12345;

        Debug.Log($"[DSPTest] === Seeded Random Test (seed={testSeed}) ===");

        // First sequence
        random.Reset(testSeed);
        float[] seq1 = new float[10];
        for (int i = 0; i < seq1.Length; i++)
        {
            seq1[i] = random.Range(0f, 100f);
        }

        // Second sequence (should be identical)
        random.Reset(testSeed);
        float[] seq2 = new float[10];
        for (int i = 0; i < seq2.Length; i++)
        {
            seq2[i] = random.Range(0f, 100f);
        }

        // Compare
        bool identical = true;
        for (int i = 0; i < seq1.Length; i++)
        {
            if (Mathf.Abs(seq1[i] - seq2[i]) > 0.0001f)
            {
                identical = false;
                break;
            }
        }

        Debug.Log($"[DSPTest] Sequence 1: [{string.Join(", ", seq1)}]");
        Debug.Log($"[DSPTest] Sequence 2: [{string.Join(", ", seq2)}]");
        Debug.Log($"[DSPTest] Sequences identical: {identical} {(identical ? "✓" : "✗")}");

        if (!identical)
        {
            Debug.LogError("[DSPTest] FAIL: Sequences should be identical with same seed!");
        }
    }

    /// <summary>
    /// Continuously log timing info in GUI
    /// </summary>
    private void OnGUI()
    {
        if (runtime == null || !runtime.IsDSPTimingEnabled()) return;

        var clock = runtime.GetDSPClock();
        var scheduler = runtime.GetScheduler();

        GUILayout.BeginArea(new Rect(10, 10, 500, 200));
        GUILayout.Box("DSP Timing Monitor");

        GUILayout.Label($"DSP Time: {clock.CurrentTime:F3}s ({clock.CurrentSample} samples)");
        GUILayout.Label($"Frame Time: {Time.time:F3}s");
        GUILayout.Label($"Drift: {(clock.CurrentTime - Time.time) * 1000:F3}ms");
        GUILayout.Label($"Sample Rate: {clock.SampleRate} Hz");
        GUILayout.Label($"Scheduled Events: {scheduler.EventCount}");
        GUILayout.Label($"Events Processed: {scheduler.TotalProcessed}/{scheduler.TotalScheduled}");

        GUILayout.Space(10);
        GUILayout.Label($"Press {testTimingKey} for timing test");
        GUILayout.Label($"Press {scheduleEventsKey} to schedule events");
        GUILayout.Label($"Press {debugInfoKey} for debug info");
        GUILayout.Label($"Press {randomTestKey} for random test");

        GUILayout.EndArea();
    }
}
}
