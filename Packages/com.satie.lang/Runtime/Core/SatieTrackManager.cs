using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Satie
{
    /// <summary>
    /// Manages all active audio tracks in the Satie system.
    /// Provides centralized control over voice lifecycle, querying, and manipulation.
    /// </summary>
    public class SatieTrackManager
    {
        // All currently active tracks, indexed by their unique key
        private readonly Dictionary<string, SatieTrack> activeTracks = new Dictionary<string, SatieTrack>();

        // MonoBehaviour reference for coroutine management
        private readonly MonoBehaviour coroutineHost;

        // Events for track lifecycle (useful for debugging/UI)
        public event Action<SatieTrack> OnTrackStarted;
        public event Action<SatieTrack> OnTrackStopped;

        public SatieTrackManager(MonoBehaviour host)
        {
            coroutineHost = host;
        }

        /// <summary>
        /// Create and register a new track
        /// </summary>
        public SatieTrack CreateTrack(string key, Statement statement)
        {
            // If track already exists, return it (shouldn't happen, but safety check)
            if (activeTracks.TryGetValue(key, out var existing))
            {
                Debug.LogWarning($"[TrackManager] Track '{key}' already exists!");
                return existing;
            }

            var track = new SatieTrack(key, statement);
            activeTracks[key] = track;

            OnTrackStarted?.Invoke(track);

            Debug.Log($"[TrackManager] Created track: {track.GetDebugInfo()}");
            return track;
        }

        /// <summary>
        /// Get a track by its key
        /// </summary>
        public SatieTrack GetTrack(string key)
        {
            activeTracks.TryGetValue(key, out var track);
            return track;
        }

        /// <summary>
        /// Check if a track exists
        /// </summary>
        public bool HasTrack(string key)
        {
            return activeTracks.ContainsKey(key);
        }

        /// <summary>
        /// Get all active tracks
        /// </summary>
        public IEnumerable<SatieTrack> GetAllTracks()
        {
            return activeTracks.Values;
        }

        /// <summary>
        /// Get all persistent tracks
        /// </summary>
        public IEnumerable<SatieTrack> GetPersistentTracks()
        {
            return activeTracks.Values.Where(t => t.IsPersistent);
        }

        /// <summary>
        /// Get all non-persistent tracks
        /// </summary>
        public IEnumerable<SatieTrack> GetNonPersistentTracks()
        {
            return activeTracks.Values.Where(t => !t.IsPersistent);
        }

        /// <summary>
        /// Stop and remove a specific track
        /// </summary>
        public void StopTrack(string key, bool destroy = true)
        {
            if (!activeTracks.TryGetValue(key, out var track))
            {
                Debug.LogWarning($"[TrackManager] Cannot stop track '{key}' - not found");
                return;
            }

            // Stop the coroutine if it exists
            if (track.Coroutine != null)
                coroutineHost.StopCoroutine(track.Coroutine);

            // Stop and optionally destroy audio sources
            track.Stop();
            if (destroy)
                track.Destroy();

            // Remove from active tracks
            activeTracks.Remove(key);

            OnTrackStopped?.Invoke(track);

            Debug.Log($"[TrackManager] Stopped track: {key}");
        }

        /// <summary>
        /// Update the mute state of a track
        /// </summary>
        public void SetTrackMute(string key, bool muted)
        {
            var track = GetTrack(key);
            if (track != null)
            {
                track.SetMute(muted);
            }
            else
            {
                Debug.LogWarning($"[TrackManager] Cannot mute track '{key}' - not found");
            }
        }

        /// <summary>
        /// Update the volume of a track
        /// </summary>
        public void SetTrackVolume(string key, float volume)
        {
            var track = GetTrack(key);
            if (track != null)
            {
                track.SetVolume(volume);
            }
            else
            {
                Debug.LogWarning($"[TrackManager] Cannot set volume for track '{key}' - not found");
            }
        }

        /// <summary>
        /// Update the pitch of a track
        /// </summary>
        public void SetTrackPitch(string key, float pitch)
        {
            var track = GetTrack(key);
            if (track != null)
            {
                track.SetPitch(pitch);
            }
            else
            {
                Debug.LogWarning($"[TrackManager] Cannot set pitch for track '{key}' - not found");
            }
        }

        /// <summary>
        /// Stop all tracks (optionally preserve persistent ones)
        /// </summary>
        public void StopAllTracks(bool includePersistent = true)
        {
            var tracksToStop = includePersistent
                ? activeTracks.Keys.ToList()
                : activeTracks.Where(kvp => !kvp.Value.IsPersistent).Select(kvp => kvp.Key).ToList();

            foreach (var key in tracksToStop)
            {
                StopTrack(key);
            }

            Debug.Log($"[TrackManager] Stopped {tracksToStop.Count} tracks (includePersistent={includePersistent})");
        }

        /// <summary>
        /// Mute/unmute all tracks
        /// </summary>
        public void MuteAllTracks(bool muted)
        {
            foreach (var track in activeTracks.Values)
            {
                track.SetMute(muted);
            }
        }

        /// <summary>
        /// Get count of active tracks
        /// </summary>
        public int GetTrackCount()
        {
            return activeTracks.Count;
        }

        /// <summary>
        /// Get count of persistent tracks
        /// </summary>
        public int GetPersistentTrackCount()
        {
            return activeTracks.Values.Count(t => t.IsPersistent);
        }

        /// <summary>
        /// Print debug info for all tracks
        /// </summary>
        public void PrintDebugInfo()
        {
            Debug.Log($"[TrackManager] === Active Tracks ({activeTracks.Count}) ===");
            foreach (var track in activeTracks.Values)
            {
                Debug.Log($"  {track.GetDebugInfo()}");
            }
        }

        /// <summary>
        /// Clean up any dead tracks (sources that were destroyed externally)
        /// </summary>
        public void CleanupDeadTracks()
        {
            var deadKeys = new List<string>();

            foreach (var kvp in activeTracks)
            {
                var track = kvp.Value;
                // Remove null sources
                track.Sources.RemoveAll(src => src == null);

                // If track has no sources left, mark for removal
                if (track.Sources.Count == 0 && !track.IsPlaying)
                {
                    deadKeys.Add(kvp.Key);
                }
            }

            foreach (var key in deadKeys)
            {
                Debug.Log($"[TrackManager] Cleaning up dead track: {key}");
                activeTracks.Remove(key);
            }

            if (deadKeys.Count > 0)
            {
                Debug.Log($"[TrackManager] Cleaned up {deadKeys.Count} dead tracks");
            }
        }
    }
}
