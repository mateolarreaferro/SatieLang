using System.Collections.Generic;
using UnityEngine;

namespace Satie
{
    /// <summary>
    /// Represents a single voice/track in the Satie audio system.
    /// Encapsulates the AudioSource, coroutine, and metadata for a playing statement.
    /// </summary>
    public class SatieTrack
    {
        // Unique identifier for this track (based on statement position and content)
        public string Key { get; private set; }

        // The statement that created this track
        public Statement Statement { get; private set; }

        // All audio sources associated with this track (can be multiple for overlap mode)
        public List<AudioSource> Sources { get; private set; } = new List<AudioSource>();

        // The coroutine running this track's logic
        public Coroutine Coroutine { get; set; }

        // Whether this track should persist across script reloads
        public bool IsPersistent => Statement.persistent;

        // Whether this track is currently playing
        public bool IsPlaying => Sources.Exists(src => src && src.isPlaying);

        // Creation time (for debugging/analytics)
        public float CreatedAtTime { get; private set; }

        public SatieTrack(string key, Statement statement)
        {
            Key = key;
            Statement = statement;
            CreatedAtTime = Time.time;
        }

        /// <summary>
        /// Add an audio source to this track's source list
        /// </summary>
        public void AddSource(AudioSource source)
        {
            if (source != null)
                Sources.Add(source);
        }

        /// <summary>
        /// Remove an audio source from this track
        /// </summary>
        public void RemoveSource(AudioSource source)
        {
            Sources.Remove(source);
        }

        /// <summary>
        /// Set mute state on all audio sources in this track
        /// </summary>
        public void SetMute(bool muted)
        {
            foreach (var src in Sources)
            {
                if (src)
                    src.mute = muted;
            }
        }

        /// <summary>
        /// Set volume on all audio sources in this track
        /// </summary>
        public void SetVolume(float volume)
        {
            foreach (var src in Sources)
            {
                if (src)
                    src.volume = volume;
            }
        }

        /// <summary>
        /// Set pitch on all audio sources in this track
        /// </summary>
        public void SetPitch(float pitch)
        {
            foreach (var src in Sources)
            {
                if (src)
                    src.pitch = pitch;
            }
        }

        /// <summary>
        /// Stop all audio sources in this track
        /// </summary>
        public void Stop()
        {
            foreach (var src in Sources)
            {
                if (src)
                    src.Stop();
            }
        }

        /// <summary>
        /// Destroy all audio sources and their GameObjects
        /// </summary>
        public void Destroy()
        {
            foreach (var src in Sources)
            {
                if (src && src.gameObject)
                    Object.Destroy(src.gameObject);
            }
            Sources.Clear();
        }

        /// <summary>
        /// Get debug information about this track
        /// </summary>
        public string GetDebugInfo()
        {
            int activeSourceCount = 0;
            int playingSourceCount = 0;
            foreach (var src in Sources)
            {
                if (src != null)
                {
                    activeSourceCount++;
                    if (src.isPlaying)
                        playingSourceCount++;
                }
            }
            float aliveTime = Time.time - CreatedAtTime;

            return $"Track '{Key}': {Statement.kind} '{Statement.clip}' | " +
                   $"Sources: {activeSourceCount} ({playingSourceCount} playing) | " +
                   $"Persistent: {IsPersistent} | " +
                   $"Alive: {aliveTime:F1}s";
        }
    }
}
