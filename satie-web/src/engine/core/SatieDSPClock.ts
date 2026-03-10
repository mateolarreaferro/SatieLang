/**
 * Sample-accurate timing using Web Audio's AudioContext.currentTime.
 * Ported from SatieDSPClock.cs — replaces AudioSettings.dspTime.
 */
export class SatieDSPClock {
  private ctx: AudioContext;
  private startTime: number = 0;
  private started: boolean = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  get currentTime(): number {
    return this.started ? this.ctx.currentTime - this.startTime : 0;
  }

  get currentSample(): number {
    return Math.floor(this.currentTime * this.sampleRate);
  }

  get absoluteTime(): number {
    return this.ctx.currentTime;
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  start(): void {
    this.startTime = this.ctx.currentTime;
    this.started = true;
  }

  reset(): void {
    this.startTime = this.ctx.currentTime;
  }

  secondsToSamples(seconds: number): number {
    return Math.floor(seconds * this.sampleRate);
  }

  samplesToSeconds(samples: number): number {
    return samples / this.sampleRate;
  }

  getScheduledTime(offsetSeconds: number): number {
    return this.absoluteTime + offsetSeconds;
  }
}
