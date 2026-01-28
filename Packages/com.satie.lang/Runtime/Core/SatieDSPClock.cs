using UnityEngine;

namespace Satie
{
    /// <summary>
    /// Sample-accurate timing core using Unity's DSP clock.
    /// Provides deterministic, frame-independent timing for audio events.
    ///
    /// Unlike Time.time (which is frame-dependent), AudioSettings.dspTime
    /// runs on the audio thread and is sample-accurate.
    /// </summary>
    public class SatieDSPClock
    {
        // The DSP time when this clock was started
        private double dspStartTime;

        // Cached sample rate to avoid repeated API calls
        private int sampleRate;

        // Whether the clock has been started
        private bool isStarted = false;

        /// <summary>
        /// Current DSP time relative to when the clock started (in seconds)
        /// </summary>
        public double CurrentTime => isStarted ? (AudioSettings.dspTime - dspStartTime) : 0.0;

        /// <summary>
        /// Current time in samples (for sample-accurate scheduling)
        /// </summary>
        public long CurrentSample => (long)(CurrentTime * sampleRate);

        /// <summary>
        /// Absolute DSP time from Unity (for scheduling AudioSource.PlayScheduled)
        /// </summary>
        public double AbsoluteDSPTime => AudioSettings.dspTime;

        /// <summary>
        /// Sample rate of the audio output
        /// </summary>
        public int SampleRate => sampleRate;

        /// <summary>
        /// Start the clock. Should be called once during initialization.
        /// </summary>
        public void Start()
        {
            dspStartTime = AudioSettings.dspTime;
            sampleRate = AudioSettings.outputSampleRate;
            isStarted = true;

            Debug.Log($"[DSPClock] Started at DSP time {dspStartTime:F6}s, sample rate: {sampleRate} Hz");
        }

        /// <summary>
        /// Reset the clock to zero
        /// </summary>
        public void Reset()
        {
            dspStartTime = AudioSettings.dspTime;
            Debug.Log($"[DSPClock] Reset at DSP time {dspStartTime:F6}s");
        }

        /// <summary>
        /// Convert seconds to samples
        /// </summary>
        public long SecondsToSamples(double seconds)
        {
            return (long)(seconds * sampleRate);
        }

        /// <summary>
        /// Convert samples to seconds
        /// </summary>
        public double SamplesToSeconds(long samples)
        {
            return (double)samples / sampleRate;
        }

        /// <summary>
        /// Get absolute DSP time for a future event (for PlayScheduled)
        /// </summary>
        public double GetScheduledTime(double offsetSeconds)
        {
            return AbsoluteDSPTime + offsetSeconds;
        }

        /// <summary>
        /// Debug info about current timing state
        /// </summary>
        public string GetDebugInfo()
        {
            return $"DSPClock: {CurrentTime:F3}s ({CurrentSample} samples) | " +
                   $"Absolute: {AbsoluteDSPTime:F3}s | " +
                   $"Frame: {Time.time:F3}s | " +
                   $"Drift: {(CurrentTime - Time.time):F6}s";
        }
    }
}
