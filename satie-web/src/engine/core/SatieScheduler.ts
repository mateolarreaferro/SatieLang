/**
 * Sample-accurate event scheduler.
 * Ported from SatieScheduler.cs
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
  private timeline: Map<number, SatieAudioEvent[]> = new Map();
  private clock: SatieDSPClock;
  private lastProcessedSample: number = -1;
  private _totalScheduled: number = 0;
  private _totalProcessed: number = 0;

  constructor(clock: SatieDSPClock) {
    this.clock = clock;
  }

  get eventCount(): number {
    let count = 0;
    for (const events of this.timeline.values()) count += events.length;
    return count;
  }

  get totalScheduled(): number { return this._totalScheduled; }
  get totalProcessed(): number { return this._totalProcessed; }

  schedule(evt: SatieAudioEvent): void {
    const list = this.timeline.get(evt.scheduledSample);
    if (list) {
      list.push(evt);
    } else {
      this.timeline.set(evt.scheduledSample, [evt]);
    }
    this._totalScheduled++;
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
    for (const [sample, events] of this.timeline) {
      const filtered = events.filter(e => e.trackKey !== trackKey);
      if (filtered.length === 0) this.timeline.delete(sample);
      else this.timeline.set(sample, filtered);
    }
  }

  cancelAll(): void {
    this.timeline.clear();
  }

  process(): void {
    const currentSample = this.clock.currentSample;

    for (const [sampleTime, events] of this.timeline) {
      if (sampleTime > currentSample) continue;
      if (sampleTime <= this.lastProcessedSample) continue;

      for (const evt of events) {
        try {
          evt.onExecute?.();
          this._totalProcessed++;
        } catch (e) {
          console.error(`[Scheduler] Error executing event:`, e);
        }
      }
      this.timeline.delete(sampleTime);
    }

    this.lastProcessedSample = currentSample;
  }

  reset(): void {
    this.timeline.clear();
    this.lastProcessedSample = -1;
    this._totalScheduled = 0;
    this._totalProcessed = 0;
  }
}
