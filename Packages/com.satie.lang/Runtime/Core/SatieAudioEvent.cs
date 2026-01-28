using UnityEngine;

namespace Satie
{
    /// <summary>
    /// Type of audio event to schedule
    /// </summary>
    public enum AudioEventType
    {
        Play,           // Start playing an audio source
        Stop,           // Stop an audio source
        SetVolume,      // Change volume
        SetPitch,       // Change pitch
        SetParameter,   // Generic parameter change
        Callback        // Execute a callback function
    }

    /// <summary>
    /// Represents a single audio event to be scheduled on the timeline.
    /// Events are processed sample-accurately in chronological order.
    /// </summary>
    public class SatieAudioEvent
    {
        // When this event should fire (in samples from timeline start)
        public long ScheduledSample { get; set; }

        // Type of event
        public AudioEventType Type { get; set; }

        // The track this event is associated with (if any)
        public string TrackKey { get; set; }

        // The AudioSource this event targets (if applicable)
        public AudioSource TargetSource { get; set; }

        // Event-specific data
        public float FloatValue { get; set; }      // For volume, pitch, etc.
        public string StringValue { get; set; }    // For clip names, etc.
        public object ObjectValue { get; set; }    // For complex data

        // Optional callback to execute when event fires
        public System.Action OnExecute { get; set; }

        // Debug info
        public string DebugLabel { get; set; }

        /// <summary>
        /// Create a Play event
        /// </summary>
        public static SatieAudioEvent Play(long atSample, string trackKey, AudioSource source, string debugLabel = "")
        {
            return new SatieAudioEvent
            {
                ScheduledSample = atSample,
                Type = AudioEventType.Play,
                TrackKey = trackKey,
                TargetSource = source,
                DebugLabel = debugLabel
            };
        }

        /// <summary>
        /// Create a Stop event
        /// </summary>
        public static SatieAudioEvent Stop(long atSample, string trackKey, AudioSource source, string debugLabel = "")
        {
            return new SatieAudioEvent
            {
                ScheduledSample = atSample,
                Type = AudioEventType.Stop,
                TrackKey = trackKey,
                TargetSource = source,
                DebugLabel = debugLabel
            };
        }

        /// <summary>
        /// Create a SetVolume event
        /// </summary>
        public static SatieAudioEvent SetVolume(long atSample, AudioSource source, float volume, string debugLabel = "")
        {
            return new SatieAudioEvent
            {
                ScheduledSample = atSample,
                Type = AudioEventType.SetVolume,
                TargetSource = source,
                FloatValue = volume,
                DebugLabel = debugLabel
            };
        }

        /// <summary>
        /// Create a SetPitch event
        /// </summary>
        public static SatieAudioEvent SetPitch(long atSample, AudioSource source, float pitch, string debugLabel = "")
        {
            return new SatieAudioEvent
            {
                ScheduledSample = atSample,
                Type = AudioEventType.SetPitch,
                TargetSource = source,
                FloatValue = pitch,
                DebugLabel = debugLabel
            };
        }

        /// <summary>
        /// Create a Callback event
        /// </summary>
        public static SatieAudioEvent Callback(long atSample, System.Action callback, string debugLabel = "")
        {
            return new SatieAudioEvent
            {
                ScheduledSample = atSample,
                Type = AudioEventType.Callback,
                OnExecute = callback,
                DebugLabel = debugLabel
            };
        }

        /// <summary>
        /// Execute this event
        /// </summary>
        public void Execute()
        {
            switch (Type)
            {
                case AudioEventType.Play:
                    if (TargetSource != null && !TargetSource.isPlaying)
                    {
                        TargetSource.Play();
                        Debug.Log($"[Event] Play: {DebugLabel} at sample {ScheduledSample}");
                    }
                    break;

                case AudioEventType.Stop:
                    if (TargetSource != null && TargetSource.isPlaying)
                    {
                        TargetSource.Stop();
                        Debug.Log($"[Event] Stop: {DebugLabel} at sample {ScheduledSample}");
                    }
                    break;

                case AudioEventType.SetVolume:
                    if (TargetSource != null)
                    {
                        TargetSource.volume = FloatValue;
                    }
                    break;

                case AudioEventType.SetPitch:
                    if (TargetSource != null)
                    {
                        TargetSource.pitch = FloatValue;
                    }
                    break;

                case AudioEventType.Callback:
                    OnExecute?.Invoke();
                    break;
            }
        }

        /// <summary>
        /// Get debug info about this event
        /// </summary>
        public override string ToString()
        {
            string timeStr = $"{ScheduledSample} samples";
            return $"[{Type}] @ {timeStr}: {DebugLabel}";
        }
    }
}
