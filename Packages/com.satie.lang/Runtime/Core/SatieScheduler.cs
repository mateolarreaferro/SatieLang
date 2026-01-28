using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Satie
{
    /// <summary>
    /// Sample-accurate event scheduler for Satie audio events.
    ///
    /// Maintains a timeline of events sorted by sample time and processes them
    /// deterministically. This replaces coroutine-based timing with a predictable,
    /// reproducible event system.
    /// </summary>
    public class SatieScheduler
    {
        // Timeline of events, sorted by sample time
        // Using SortedDictionary for automatic ordering
        private SortedDictionary<long, List<SatieAudioEvent>> timeline;

        // Reference to the DSP clock
        private SatieDSPClock clock;

        // Last processed sample (to avoid re-processing)
        private long lastProcessedSample;

        // Statistics
        private int totalEventsScheduled;
        private int totalEventsProcessed;

        public int EventCount => timeline.Sum(kvp => kvp.Value.Count);
        public int TotalScheduled => totalEventsScheduled;
        public int TotalProcessed => totalEventsProcessed;

        public SatieScheduler(SatieDSPClock clock)
        {
            this.clock = clock;
            this.timeline = new SortedDictionary<long, List<SatieAudioEvent>>();
            this.lastProcessedSample = 0;
            this.totalEventsScheduled = 0;
            this.totalEventsProcessed = 0;
        }

        /// <summary>
        /// Schedule an event at a specific sample time
        /// </summary>
        public void Schedule(SatieAudioEvent evt)
        {
            if (evt == null)
            {
                Debug.LogWarning("[Scheduler] Attempted to schedule null event");
                return;
            }

            // Get or create the event list for this sample
            if (!timeline.TryGetValue(evt.ScheduledSample, out var eventList))
            {
                eventList = new List<SatieAudioEvent>();
                timeline[evt.ScheduledSample] = eventList;
            }

            eventList.Add(evt);
            totalEventsScheduled++;

            Debug.Log($"[Scheduler] Scheduled {evt.Type} at sample {evt.ScheduledSample} ({clock.SamplesToSeconds(evt.ScheduledSample):F3}s): {evt.DebugLabel}");
        }

        /// <summary>
        /// Schedule an event at a specific time (in seconds)
        /// </summary>
        public void ScheduleAt(SatieAudioEvent evt, double timeSeconds)
        {
            evt.ScheduledSample = clock.SecondsToSamples(timeSeconds);
            Schedule(evt);
        }

        /// <summary>
        /// Schedule an event relative to current time (offset in seconds)
        /// </summary>
        public void ScheduleAfter(SatieAudioEvent evt, double offsetSeconds)
        {
            long offsetSamples = clock.SecondsToSamples(offsetSeconds);
            evt.ScheduledSample = clock.CurrentSample + offsetSamples;
            Schedule(evt);
        }

        /// <summary>
        /// Cancel all events for a specific track
        /// </summary>
        public void CancelTrackEvents(string trackKey)
        {
            int cancelled = 0;
            foreach (var kvp in timeline.ToList())
            {
                var eventsAtTime = kvp.Value;
                int beforeCount = eventsAtTime.Count;
                eventsAtTime.RemoveAll(e => e.TrackKey == trackKey);
                cancelled += (beforeCount - eventsAtTime.Count);

                // Remove empty time slots
                if (eventsAtTime.Count == 0)
                    timeline.Remove(kvp.Key);
            }

            if (cancelled > 0)
                Debug.Log($"[Scheduler] Cancelled {cancelled} events for track '{trackKey}'");
        }

        /// <summary>
        /// Cancel all scheduled events
        /// </summary>
        public void CancelAll()
        {
            int count = EventCount;
            timeline.Clear();
            Debug.Log($"[Scheduler] Cancelled all {count} events");
        }

        /// <summary>
        /// Process all events up to the current sample time.
        /// Should be called every frame (or from OnAudioFilterRead for maximum accuracy).
        /// </summary>
        public void Process()
        {
            long currentSample = clock.CurrentSample;

            // Process all events up to current time
            var dueEvents = timeline.Where(kvp => kvp.Key <= currentSample).ToList();

            foreach (var kvp in dueEvents)
            {
                long sampleTime = kvp.Key;
                var events = kvp.Value;

                // Skip if we already processed this sample
                if (sampleTime <= lastProcessedSample)
                    continue;

                // Execute all events at this sample time
                foreach (var evt in events)
                {
                    try
                    {
                        evt.Execute();
                        totalEventsProcessed++;
                    }
                    catch (System.Exception ex)
                    {
                        Debug.LogError($"[Scheduler] Error executing event: {ex.Message}\n{ex.StackTrace}");
                    }
                }

                // Remove from timeline
                timeline.Remove(sampleTime);
            }

            lastProcessedSample = currentSample;
        }

        /// <summary>
        /// Reset the scheduler (clear all events and reset counters)
        /// </summary>
        public void Reset()
        {
            timeline.Clear();
            lastProcessedSample = 0;
            totalEventsScheduled = 0;
            totalEventsProcessed = 0;
            Debug.Log("[Scheduler] Reset");
        }

        /// <summary>
        /// Get all upcoming events (for debugging)
        /// </summary>
        public List<SatieAudioEvent> GetUpcomingEvents(int maxCount = 10)
        {
            return timeline
                .OrderBy(kvp => kvp.Key)
                .Take(maxCount)
                .SelectMany(kvp => kvp.Value)
                .ToList();
        }

        /// <summary>
        /// Debug info about the scheduler state
        /// </summary>
        public string GetDebugInfo()
        {
            var upcoming = GetUpcomingEvents(3);
            string upcomingStr = upcoming.Count > 0
                ? string.Join(", ", upcoming.Select(e => $"{e.Type}@{clock.SamplesToSeconds(e.ScheduledSample):F2}s"))
                : "none";

            return $"Scheduler: {EventCount} pending, {TotalProcessed}/{TotalScheduled} processed | " +
                   $"Next: [{upcomingStr}]";
        }

        /// <summary>
        /// Print detailed timeline for debugging
        /// </summary>
        public void PrintTimeline()
        {
            Debug.Log($"[Scheduler] === Timeline ({EventCount} events) ===");
            foreach (var kvp in timeline.OrderBy(kvp => kvp.Key).Take(20))
            {
                double timeSeconds = clock.SamplesToSeconds(kvp.Key);
                Debug.Log($"  {timeSeconds:F3}s ({kvp.Key} samples): {kvp.Value.Count} events");
                foreach (var evt in kvp.Value)
                {
                    Debug.Log($"    - {evt}");
                }
            }
            if (EventCount > 20)
                Debug.Log($"  ... and {EventCount - 20} more events");
        }
    }
}
