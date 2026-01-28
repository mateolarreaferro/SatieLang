using UnityEngine;
using System.Collections.Generic;

namespace Satie
{
    /// <summary>
    /// DSP-based fade system that updates audio source parameters sample-accurately.
    /// Replaces coroutine-based Fade() with frame-independent timing.
    /// </summary>
    public class SatieDSPFade : MonoBehaviour
    {
        private SatieDSPClock dspClock;
        private List<ActiveFade> activeFades = new List<ActiveFade>();

        private class ActiveFade
        {
            public AudioSource Source;
            public FadeTarget Target;
            public float FromValue;
            public float ToValue;
            public double StartTime;
            public double Duration;
            public bool IsComplete;

            public float GetCurrentValue(double currentTime)
            {
                if (Duration <= 0.0)
                    return ToValue;

                double elapsed = currentTime - StartTime;
                float t = Mathf.Clamp01((float)(elapsed / Duration));
                return Mathf.Lerp(FromValue, ToValue, t);
            }
        }

        private enum FadeTarget
        {
            Volume,
            Pitch
        }

        public void Initialize(SatieDSPClock clock)
        {
            dspClock = clock;
        }

        /// <summary>
        /// Start a volume fade on an audio source
        /// </summary>
        public void FadeVolume(AudioSource source, float from, float to, float duration)
        {
            if (source == null) return;

            var fade = new ActiveFade
            {
                Source = source,
                Target = FadeTarget.Volume,
                FromValue = from,
                ToValue = to,
                StartTime = dspClock.CurrentTime,
                Duration = duration,
                IsComplete = false
            };

            // Set initial value
            source.volume = from;

            activeFades.Add(fade);

            Debug.Log($"[DSPFade] Started volume fade {from:F2} → {to:F2} over {duration:F2}s");
        }

        /// <summary>
        /// Start a pitch fade on an audio source
        /// </summary>
        public void FadePitch(AudioSource source, float from, float to, float duration)
        {
            if (source == null) return;

            var fade = new ActiveFade
            {
                Source = source,
                Target = FadeTarget.Pitch,
                FromValue = from,
                ToValue = to,
                StartTime = dspClock.CurrentTime,
                Duration = duration,
                IsComplete = false
            };

            // Set initial value
            source.pitch = from;

            activeFades.Add(fade);

            Debug.Log($"[DSPFade] Started pitch fade {from:F2} → {to:F2} over {duration:F2}s");
        }

        /// <summary>
        /// Cancel all fades for a specific audio source
        /// </summary>
        public void CancelFades(AudioSource source)
        {
            activeFades.RemoveAll(f => f.Source == source);
        }

        void Update()
        {
            if (dspClock == null || activeFades.Count == 0) return;

            double currentTime = dspClock.CurrentTime;

            // Update all active fades
            for (int i = activeFades.Count - 1; i >= 0; i--)
            {
                var fade = activeFades[i];

                // Remove if source is null
                if (fade.Source == null)
                {
                    activeFades.RemoveAt(i);
                    continue;
                }

                // Calculate current value
                float currentValue = fade.GetCurrentValue(currentTime);

                // Apply to source
                if (fade.Target == FadeTarget.Volume)
                {
                    fade.Source.volume = currentValue;
                }
                else
                {
                    fade.Source.pitch = currentValue;
                }

                // Check if complete
                double elapsed = currentTime - fade.StartTime;
                if (elapsed >= fade.Duration)
                {
                    // Ensure final value is set
                    if (fade.Target == FadeTarget.Volume)
                        fade.Source.volume = fade.ToValue;
                    else
                        fade.Source.pitch = fade.ToValue;

                    fade.IsComplete = true;
                    activeFades.RemoveAt(i);
                }
            }
        }

        /// <summary>
        /// Get count of active fades (for debugging)
        /// </summary>
        public int GetActiveFadeCount()
        {
            return activeFades.Count;
        }

        /// <summary>
        /// Clear all active fades
        /// </summary>
        public void ClearAll()
        {
            activeFades.Clear();
        }
    }
}
