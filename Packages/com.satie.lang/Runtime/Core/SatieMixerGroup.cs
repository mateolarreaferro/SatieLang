using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Satie
{
    /// <summary>
    /// Represents a group of tracks that can be controlled together, like a DAW mixer channel strip
    /// </summary>
    [Serializable]
    public class SatieMixerGroup
    {
        public string name;
        public Color color = Color.white;
        public bool solo = false;
        public bool mute = false;
        [Range(0f, 1f)] public float volume = 1f;
        public bool collapsed = false;

        // Track matching - tracks are auto-assigned to groups based on these patterns
        public List<string> clipNamePatterns = new List<string>();
        public List<string> kindFilters = new List<string>(); // "loop" or "oneshot"

        public SatieMixerGroup(string name)
        {
            this.name = name;
        }

        /// <summary>
        /// Check if a track belongs to this group
        /// </summary>
        public bool ContainsTrack(SatieTrack track)
        {
            // Check kind filter
            if (kindFilters.Count > 0 && !kindFilters.Contains(track.Statement.kind))
                return false;

            // Check clip name patterns
            if (clipNamePatterns.Count > 0)
            {
                bool matchesAnyPattern = false;
                foreach (var pattern in clipNamePatterns)
                {
                    if (track.Statement.clip.Contains(pattern))
                    {
                        matchesAnyPattern = true;
                        break;
                    }
                }
                if (!matchesAnyPattern)
                    return false;
            }

            return true;
        }

        /// <summary>
        /// Get all tracks in this group
        /// </summary>
        public IEnumerable<SatieTrack> GetTracks(SatieTrackManager trackManager)
        {
            return trackManager.GetAllTracks().Where(t => ContainsTrack(t));
        }

        /// <summary>
        /// Apply group settings to all tracks
        /// </summary>
        public void ApplyToTracks(SatieTrackManager trackManager, bool anySoloActive)
        {
            foreach (var track in GetTracks(trackManager))
            {
                // Mute logic: explicit mute OR implicitly muted when other groups are soloed
                bool shouldMute = mute || (anySoloActive && !solo);
                track.SetMute(shouldMute);

                // Apply volume
                track.SetVolume(volume);
            }
        }
    }
}
