/**
 * Satie Web Audio Engine — the main runtime.
 * Uses SatieDSPClock + SatieScheduler for sample-accurate event timing.
 * Voice lifecycle (spatial, gain) is separate from audio clip triggering.
 */
import { SatieDSPClock } from './SatieDSPClock';
import { SatieScheduler, AudioEventType, type SatieAudioEvent } from './SatieScheduler';
import { Statement, WanderType, Vec3 } from './Statement';
import { parse, pathFor } from './SatieParser';
import { getEaseFunction } from './EaseFunctions';
import { InterpolationData, InterpolationType } from './InterpolationData';

export interface TrackState {
  key: string;
  statement: Statement;
  sourceNode: AudioBufferSourceNode | null;
  gainNode: GainNode;
  pannerNode: PannerNode;
  position: Vec3;
  isPlaying: boolean;
  startedAt: number;
  volume: number;
  pitch: number;
  color: string;   // resolved hex color
  alpha: number;    // resolved alpha 0-1
  seed: number;     // unique per-voice seed for spatial noise
  wanderHz: number; // sampled once at creation
}

export interface EngineState {
  isPlaying: boolean;
  currentTime: number;
  tracks: TrackState[];
  statements: Statement[];
  errors: string | null;
}

type EngineListener = (state: EngineState) => void;

export class SatieEngine {
  private ctx: AudioContext;
  private clock: SatieDSPClock;
  private scheduler: SatieScheduler;
  private masterGain: GainNode;

  private tracks: Map<string, TrackState> = new Map();
  private audioBuffers: Map<string, AudioBuffer> = new Map();
  private statements: Statement[] = [];
  private errors: string | null = null;

  private animFrameId: number | null = null;
  private listeners: Set<EngineListener> = new Set();

  private _isPlaying: boolean = false;

  constructor() {
    this.ctx = new AudioContext();
    this.clock = new SatieDSPClock(this.ctx);
    this.scheduler = new SatieScheduler(this.clock);
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
  }

  get audioContext(): AudioContext { return this.ctx; }
  get isPlaying(): boolean { return this._isPlaying; }
  get currentTime(): number { return this.clock.currentTime; }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const state: EngineState = {
      isPlaying: this._isPlaying,
      currentTime: this.clock.currentTime,
      tracks: Array.from(this.tracks.values()),
      statements: this.statements,
      errors: this.errors,
    };
    for (const listener of this.listeners) listener(state);
  }

  // ── Audio loading ──

  async loadAudioFile(name: string, url: string): Promise<void> {
    if (this.audioBuffers.has(name)) return;
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.audioBuffers.set(name, audioBuffer);
    } catch (e) {
      console.error(`[SatieEngine] Failed to load audio: ${name}`, e);
    }
  }

  async loadAudioBuffer(name: string, data: ArrayBuffer): Promise<void> {
    const audioBuffer = await this.ctx.decodeAudioData(data);
    this.audioBuffers.set(name, audioBuffer);
  }

  getLoadedAudioNames(): string[] {
    return Array.from(this.audioBuffers.keys());
  }

  // ── Script / transport ──

  loadScript(script: string): void {
    try {
      this.statements = parse(script);
      this.errors = null;
    } catch (e: any) {
      this.errors = e.message;
      this.statements = [];
    }

    // If playing, restart with new statements
    if (this._isPlaying) {
      this.teardownAll();
      this.scheduleAll();
    }

    this.notify();
  }

  async play(): Promise<void> {
    if (this._isPlaying) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this._isPlaying = true;
    this.clock.start();
    this.scheduler.reset();

    this.scheduleAll();
    this.tick();
    this.notify();
  }

  stop(): void {
    this._isPlaying = false;

    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    this.teardownAll();
    this.notify();
  }

  setMasterVolume(vol: number): void {
    this.masterGain.gain.setValueAtTime(vol, this.ctx.currentTime);
  }

  // ── Internal: schedule all statements ──

  private scheduleAll(): void {
    this.clock.start();
    this.scheduler.reset();

    for (let i = 0; i < this.statements.length; i++) {
      const stmt = this.statements[i];
      if (stmt.mute) continue;

      for (let c = 0; c < stmt.count; c++) {
        const key = `${stmt.clip}_${i}_${c}`;
        const startSeconds = stmt.start.sample();

        // Schedule voice creation
        this.scheduler.schedule({
          scheduledSample: this.clock.secondsToSamples(startSeconds),
          type: AudioEventType.Callback,
          trackKey: key,
          debugLabel: `create:${stmt.clip}`,
          onExecute: () => this.createVoice(key, stmt),
        });
      }
    }
  }

  private teardownAll(): void {
    this.scheduler.reset();

    for (const track of this.tracks.values()) {
      try { track.sourceNode?.stop(); } catch { /* ok */ }
      track.gainNode.disconnect();
      track.pannerNode.disconnect();
    }
    this.tracks.clear();
  }

  // ── Tick loop ──

  private tick = (): void => {
    if (!this._isPlaying) return;

    // Process any due scheduler events
    this.scheduler.process();

    // Update continuous track state (spatial, interpolation)
    this.updateTracks();
    this.notify();

    this.animFrameId = requestAnimationFrame(this.tick);
  };

  // ── Voice lifecycle (created once per statement) ──

  private createVoice(key: string, stmt: Statement): void {
    if (!this._isPlaying) return;

    const gainNode = this.ctx.createGain();

    const pannerNode = this.ctx.createPanner();
    pannerNode.panningModel = 'HRTF';
    pannerNode.distanceModel = 'inverse';
    pannerNode.refDistance = 1;
    pannerNode.maxDistance = 50;
    pannerNode.rolloffFactor = 1;
    pannerNode.coneInnerAngle = 360;
    pannerNode.coneOuterAngle = 360;
    pannerNode.coneOuterGain = 0;
    pannerNode.setPosition(0, 0, 0);

    // source → gain → panner → master
    gainNode.connect(pannerNode);
    pannerNode.connect(this.masterGain);

    const track: TrackState = {
      key,
      statement: stmt,
      sourceNode: null,
      gainNode,
      pannerNode,
      position: { x: 0, y: 0, z: 0 },
      isPlaying: true,
      startedAt: this.clock.currentTime,
      volume: stmt.volume.sample(),
      pitch: stmt.pitch.sample(),
      color: stmt.staticColor ?? '#1a3a2a',
      alpha: stmt.staticAlpha,
      seed: Math.random() * 1000,
      wanderHz: stmt.wanderHz.sample(),
    };

    this.tracks.set(key, track);

    // Fire first audio trigger
    this.retriggerAudio(key, stmt);

    // Schedule voice end (duration / end)
    if (!stmt.duration.isNull) {
      const dur = stmt.duration.sample();
      const fadeOut = !stmt.fadeOut.isNull ? stmt.fadeOut.sample() : 0;
      this.scheduler.schedule({
        scheduledSample: this.clock.currentSample + this.clock.secondsToSamples(dur),
        type: AudioEventType.Callback,
        trackKey: key,
        debugLabel: `end:${stmt.clip}`,
        onExecute: () => this.stopTrack(key, fadeOut),
      });
    } else if (!stmt.end.isNull) {
      const endTime = stmt.end.sample();
      const endFade = !stmt.endFade.isNull ? stmt.endFade.sample() : 0;
      this.scheduler.schedule({
        scheduledSample: this.clock.secondsToSamples(endTime),
        type: AudioEventType.Callback,
        trackKey: key,
        debugLabel: `end:${stmt.clip}`,
        onExecute: () => this.stopTrack(key, endFade),
      });
    }
  }

  // ── Audio clip triggering (fires repeatedly for oneshot+every) ──

  private retriggerAudio(key: string, stmt: Statement): void {
    if (!this._isPlaying) return;

    const track = this.tracks.get(key);
    if (!track) return;

    const clipPath = pathFor(stmt.clip);
    const buffer = this.audioBuffers.get(clipPath) ?? this.audioBuffers.get(stmt.clip);

    if (!buffer) {
      console.warn(`[SatieEngine] Audio not loaded: ${stmt.clip} (tried: ${clipPath})`);
      return;
    }

    // Stop previous source
    if (track.sourceNode) {
      try { track.sourceNode.stop(); } catch { /* ok */ }
    }

    const sourceNode = this.ctx.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.loop = stmt.kind === 'loop';
    sourceNode.connect(track.gainNode);

    // Sample fresh volume/pitch each trigger
    const volume = stmt.volume.sample();
    const pitch = stmt.pitch.sample();
    track.gainNode.gain.setValueAtTime(volume, this.ctx.currentTime);
    sourceNode.playbackRate.setValueAtTime(pitch, this.ctx.currentTime);
    track.volume = volume;
    track.pitch = pitch;
    track.sourceNode = sourceNode;

    if (stmt.randomStart) {
      sourceNode.start(0, Math.random() * buffer.duration);
    } else {
      sourceNode.start();
    }

    // Fade in
    if (!stmt.fadeIn.isNull) {
      const fadeTime = stmt.fadeIn.sample();
      track.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
      track.gainNode.gain.linearRampToValueAtTime(volume, this.ctx.currentTime + fadeTime);
    }

    // Schedule next retrigger via scheduler (oneshot with every)
    if (stmt.kind === 'oneshot' && !stmt.every.isNull) {
      const everySeconds = stmt.every.sample();
      this.scheduler.schedule({
        scheduledSample: this.clock.currentSample + this.clock.secondsToSamples(everySeconds),
        type: AudioEventType.Callback,
        trackKey: key,
        debugLabel: `retrigger:${stmt.clip}`,
        onExecute: () => this.retriggerAudio(key, stmt),
      });
    }

    // Clean up one-off oneshots when they finish naturally
    if (stmt.kind === 'oneshot' && stmt.every.isNull) {
      sourceNode.onended = () => {
        track.isPlaying = false;
        track.gainNode.disconnect();
        track.pannerNode.disconnect();
        this.tracks.delete(key);
      };
    }
  }

  // ── Stop a single track ──

  private stopTrack(key: string, fadeOutTime: number = 0): void {
    const track = this.tracks.get(key);
    if (!track) return;

    // Cancel any pending retrigger events for this track
    this.scheduler.cancelTrackEvents(key);

    const cleanup = () => {
      try { track.sourceNode?.stop(); } catch { /* ok */ }
      track.gainNode.disconnect();
      track.pannerNode.disconnect();
      this.tracks.delete(key);
    };

    if (fadeOutTime > 0) {
      track.gainNode.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fadeOutTime);
      // Use a scheduler event for the cleanup delay too
      this.scheduler.schedule({
        scheduledSample: this.clock.currentSample + this.clock.secondsToSamples(fadeOutTime),
        type: AudioEventType.Callback,
        trackKey: key + '_cleanup',
        debugLabel: `cleanup:${key}`,
        onExecute: cleanup,
      });
    } else {
      cleanup();
    }
  }

  // ── Continuous per-frame updates (spatial, interpolation) ──

  private updateTracks(): void {
    const now = this.clock.currentTime;

    for (const track of this.tracks.values()) {
      const stmt = track.statement;
      const elapsed = now - track.startedAt;

      // Interpolated volume
      if (stmt.volumeInterpolation) {
        const val = this.evaluateInterpolation(stmt.volumeInterpolation, elapsed);
        track.gainNode.gain.setValueAtTime(val, this.ctx.currentTime);
        track.volume = val;
      }

      // Interpolated pitch
      if (stmt.pitchInterpolation && track.sourceNode) {
        const val = this.evaluateInterpolation(stmt.pitchInterpolation, elapsed);
        track.sourceNode.playbackRate.setValueAtTime(val, this.ctx.currentTime);
        track.pitch = val;
      }

      // Spatial position
      if (stmt.wanderType !== WanderType.None) {
        track.position = this.calculateWanderPosition(stmt, elapsed, track.seed, track.wanderHz);
        track.pannerNode.setPosition(track.position.x, track.position.y, track.position.z);
      }

      // Interpolated color
      if (stmt.colorRedInterpolation || stmt.colorGreenInterpolation || stmt.colorBlueInterpolation) {
        const r = stmt.colorRedInterpolation
          ? Math.round(this.evaluateInterpolation(stmt.colorRedInterpolation, elapsed) * 255)
          : parseInt((stmt.staticColor ?? '#1a3a2a').substring(1, 3), 16);
        const g = stmt.colorGreenInterpolation
          ? Math.round(this.evaluateInterpolation(stmt.colorGreenInterpolation, elapsed) * 255)
          : parseInt((stmt.staticColor ?? '#1a3a2a').substring(3, 5), 16);
        const b = stmt.colorBlueInterpolation
          ? Math.round(this.evaluateInterpolation(stmt.colorBlueInterpolation, elapsed) * 255)
          : parseInt((stmt.staticColor ?? '#1a3a2a').substring(5, 7), 16);
        track.color = `#${Math.max(0, Math.min(255, r)).toString(16).padStart(2, '0')}${Math.max(0, Math.min(255, g)).toString(16).padStart(2, '0')}${Math.max(0, Math.min(255, b)).toString(16).padStart(2, '0')}`;
      }

      // Interpolated alpha
      if (stmt.colorAlphaInterpolation) {
        track.alpha = Math.max(0, Math.min(1, this.evaluateInterpolation(stmt.colorAlphaInterpolation, elapsed)));
      }
    }
  }

  // ── Interpolation ──

  evaluateInterpolation(interp: InterpolationData, elapsed: number): number {
    const duration = interp.durationRange.sample();
    if (duration <= 0) return interp.minValue;

    const ease = getEaseFunction(interp.easeName);

    switch (interp.interpolationType) {
      case InterpolationType.Goto: {
        const t = Math.min(elapsed / duration, 1);
        return interp.minValue + (interp.maxValue - interp.minValue) * ease(t);
      }
      case InterpolationType.GoBetween: {
        const cycleT = (elapsed % duration) / duration;
        const cycle = Math.floor(elapsed / duration);
        if (!interp.isForever && cycle >= interp.repeatCount) {
          return interp.maxValue;
        }
        const isReversing = cycle % 2 === 1;
        const t = isReversing ? 1 - cycleT : cycleT;
        return interp.minValue + (interp.maxValue - interp.minValue) * ease(t);
      }
      case InterpolationType.Interpolate: {
        const t = Math.min(elapsed / duration, 1);
        return interp.minValue + (interp.maxValue - interp.minValue) * ease(t);
      }
    }
    return interp.minValue;
  }

  // ── Spatial wander ──

  private calculateWanderPosition(stmt: Statement, elapsed: number, seed: number, wanderHz: number): Vec3 {
    // Each voice has a unique seed (random at creation) and wanderHz (sampled once).
    // Use multiple sin waves at different frequencies/phases for organic movement.
    const speed = wanderHz * 0.01;
    const t = elapsed * speed * 2 * Math.PI;

    // 6 different phase offsets derived from the seed for independent per-axis motion
    const px1 = seed * 1.0;
    const px2 = seed * 2.3;
    const py1 = seed * 3.7;
    const py2 = seed * 0.5;
    const pz1 = seed * 1.3;
    const pz2 = seed * 4.2;

    // Layered sin waves → value in roughly -0.5..0.5, then shift to 0..1
    const nx = (Math.sin(t + px1) + Math.sin(t * 1.3 + px2) + Math.sin(t * 0.7 + px1 * 0.3)) / 6 + 0.5;
    const ny = (Math.sin(t * 0.8 + py1) + Math.sin(t * 1.1 + py2) + Math.sin(t * 0.6 + py1 * 0.4)) / 6 + 0.5;
    const nz = (Math.sin(t * 1.2 + pz1) + Math.sin(t * 0.7 + pz2) + Math.sin(t * 0.9 + pz1 * 0.6)) / 6 + 0.5;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const pos: Vec3 = {
      x: lerp(stmt.areaMin.x, stmt.areaMax.x, nx),
      y: lerp(stmt.areaMin.y, stmt.areaMax.y, ny),
      z: lerp(stmt.areaMin.z, stmt.areaMax.z, nz),
    };

    if (stmt.wanderType === WanderType.Walk) pos.y = 0;
    return pos;
  }

  destroy(): void {
    this.stop();
    this.ctx.close();
  }
}
