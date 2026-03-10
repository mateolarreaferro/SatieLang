/**
 * Sample-accurate event scheduler.
 * Ported from SatieScheduler.cs
 *
 * Uses a sorted timeline array for O(1) access to the next due event,
 * instead of iterating the entire Map each frame.
 */
import { SatieDSPClock } from './SatieDSPClock';

export enum AudioEventType {
  Play = 'play',
  Stop = 'stop',
  SetVolume = 'setVolume',
  SetPitch = 'setPitch',
  Callback = 'callback',
}

export interface SatieAudioEvent {
  scheduledSample: number;
  type: AudioEventType;
  trackKey: string;
  floatValue?: number;
  stringValue?: string;
  onExecute?: () => void;
  debugLabel?: string;
}

export class SatieScheduler {
  /** Sorted by scheduledSample ascending. Earliest events at the front. */
  private timeline: SatieAudioEvent[] = [];
  private clock: SatieDSPClock;
  private _totalScheduled: number = 0;
  private _totalProcessed: number = 0;

  constructor(clock: SatieDSPClock) {
    this.clock = clock;
  }

  get eventCount(): number {
    return this.timeline.length;
  }

  get totalScheduled(): number { return this._totalScheduled; }
  get totalProcessed(): number { return this._totalProcessed; }

  schedule(evt: SatieAudioEvent): void {
    this._totalScheduled++;
    // Binary search insert to maintain sorted order
    const sample = evt.scheduledSample;
    const arr = this.timeline;
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid].scheduledSample <= sample) lo = mid + 1;
      else hi = mid;
    }
    arr.splice(lo, 0, evt);
  }

  scheduleAt(evt: SatieAudioEvent, timeSeconds: number): void {
    evt.scheduledSample = this.clock.secondsToSamples(timeSeconds);
    this.schedule(evt);
  }

  scheduleAfter(evt: SatieAudioEvent, offsetSeconds: number): void {
    evt.scheduledSample = this.clock.currentSample + this.clock.secondsToSamples(offsetSeconds);
    this.schedule(evt);
  }

  cancelTrackEvents(trackKey: string): void {
    // Filter in-place to avoid allocation
    let write = 0;
    for (let read = 0; read < this.timeline.length; read++) {
      if (this.timeline[read].trackKey !== trackKey) {
        this.timeline[write++] = this.timeline[read];
      }
    }
    this.timeline.length = write;
  }

  cancelAll(): void {
    this.timeline.length = 0;
  }

  process(): void {
    const currentSample = this.clock.currentSample;
    const arr = this.timeline;

    // Since timeline is sorted, we just consume from the front
    let consumed = 0;
    while (consumed < arr.length && arr[consumed].scheduledSample <= currentSample) {
      const evt = arr[consumed];
      try {
        evt.onExecute?.();
        this._totalProcessed++;
      } catch (e) {
        console.error(`[Scheduler] Error executing event:`, e);
      }
      consumed++;
    }

    // Remove consumed events efficiently
    if (consumed > 0) {
      arr.splice(0, consumed);
    }
  }

  reset(): void {
    this.timeline.length = 0;
    this._totalScheduled = 0;
    this._totalProcessed = 0;
  }
}
