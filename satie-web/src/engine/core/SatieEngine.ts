/**
 * Satie Web Audio Engine — the main runtime.
 * Uses SatieDSPClock + SatieScheduler for sample-accurate event timing.
 *
 * Performance architecture:
 * - Engine tick runs at RAF (~60fps) but only mutates track state objects in-place
 * - React UI is notified at a throttled rate (UI_NOTIFY_HZ) for non-critical state
 * - Three.js reads track state directly via refs (no React re-render needed)
 * - Discrete events (play/stop/script load) notify immediately
 */
import { SatieDSPClock } from './SatieDSPClock';
import { SatieScheduler, AudioEventType, type SatieAudioEvent } from './SatieScheduler';
import { Statement, WanderType, Vec3 } from './Statement';
import { parse, pathFor } from './SatieParser';
import { getEaseFunction, type EaseFunction } from './EaseFunctions';
import { InterpolationData, InterpolationType } from './InterpolationData';
import { buildDSPChain, destroyDSPChain, type DSPNodes } from '../dsp/DSPChain';
import { generateAudio } from '../audio/AudioGen';

// Pre-computed hex lookup table (0-255 → "00"-"ff")
const HEX_LUT: string[] = new Array(256);
for (let i = 0; i < 256; i++) HEX_LUT[i] = i.toString(16).padStart(2, '0');

function toHex(r: number, g: number, b: number): string {
  return '#' + HEX_LUT[r] + HEX_LUT[g] + HEX_LUT[b];
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

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
  dspChain: DSPNodes | null;
  // Pre-cached per-voice values (avoid recomputing every frame)
  _cachedDurations: Map<InterpolationData, number>;
  _cachedEaseFns: Map<InterpolationData, EaseFunction>;
  _staticColorR: number; // pre-parsed static color channel
  _staticColorG: number;
  _staticColorB: number;
  // Pre-computed wander phase offsets
  _px1: number; _px2: number;
  _py1: number; _py2: number;
  _pz1: number; _pz2: number;
  _wanderSpeed: number; // precomputed wanderHz * 0.01 * 2π
}

export interface EngineState {
  isPlaying: boolean;
  currentTime: number;
  tracks: TrackState[];
  statements: Statement[];
  errors: string | null;
}

/** Lightweight snapshot for React UI — only scalar values that change slowly */
export interface EngineUIState {
  isPlaying: boolean;
  currentTime: number;
  trackCount: number;
  statements: Statement[];
  errors: string | null;
}

type EngineListener = (state: EngineState) => void;
type UIListener = (state: EngineUIState) => void;

/** How often to notify React UI listeners (Hz). 3D reads tracks directly. */
const UI_NOTIFY_HZ = 8;
const UI_NOTIFY_INTERVAL = 1000 / UI_NOTIFY_HZ;

/** Spatial position update rate limit — 30fps is plenty for perception */
const SPATIAL_HZ = 30;
const SPATIAL_INTERVAL = 1000 / SPATIAL_HZ;

export class SatieEngine {
  private ctx: AudioContext;
  private clock: SatieDSPClock;
  private scheduler: SatieScheduler;
  private masterGain: GainNode;

  private tracks: Map<string, TrackState> = new Map();
  /** Shared array updated in-place. Three.js reads this directly via ref. */
  private _tracksArray: TrackState[] = [];
  private _tracksArrayDirty = true;
  private audioBuffers: Map<string, AudioBuffer> = new Map();
  private statements: Statement[] = [];
  private errors: string | null = null;

  private animFrameId: number | null = null;
  private listeners: Set<EngineListener> = new Set();
  private uiListeners: Set<UIListener> = new Set();

  private _isPlaying: boolean = false;
  private _lastUINotify: number = 0;
  private _lastSpatialUpdate: number = 0;

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

  /** Get the shared tracks array. Updated in-place — no allocation per frame. */
  getTracksArray(): TrackState[] {
    if (this._tracksArrayDirty) {
      this._tracksArray = Array.from(this.tracks.values());
      this._tracksArrayDirty = false;
    }
    return this._tracksArray;
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Subscribe to throttled UI-only updates (currentTime, trackCount). */
  subscribeUI(listener: UIListener): () => void {
    this.uiListeners.add(listener);
    return () => this.uiListeners.delete(listener);
  }

  private notify(): void {
    const tracks = this.getTracksArray();
    const state: EngineState = {
      isPlaying: this._isPlaying,
      currentTime: this.clock.currentTime,
      tracks,
      statements: this.statements,
      errors: this.errors,
    };
    for (const listener of this.listeners) listener(state);
    // Also push to UI listeners on discrete events
    this.notifyUI();
  }

  private notifyUI(): void {
    const uiState: EngineUIState = {
      isPlaying: this._isPlaying,
      currentTime: this.clock.currentTime,
      trackCount: this.tracks.size,
      statements: this.statements,
      errors: this.errors,
    };
    for (const listener of this.uiListeners) listener(uiState);
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
      if (track.dspChain) destroyDSPChain(track.dspChain);
      track.gainNode.disconnect();
      track.pannerNode.disconnect();
    }
    this.tracks.clear();
    this._tracksArrayDirty = true;
  }

  // ── Tick loop ──

  private tick = (): void => {
    if (!this._isPlaying) return;

    const now = performance.now();

    // Process any due scheduler events
    this.scheduler.process();

    // Update continuous track state (spatial, interpolation)
    // Spatial updates are rate-limited; interpolation runs every frame for smoothness
    const doSpatial = now - this._lastSpatialUpdate >= SPATIAL_INTERVAL;
    this.updateTracks(doSpatial);
    if (doSpatial) this._lastSpatialUpdate = now;

    // Throttle React UI notifications
    if (now - this._lastUINotify >= UI_NOTIFY_INTERVAL) {
      this._lastUINotify = now;
      this.notifyUI();
    }

    this.animFrameId = requestAnimationFrame(this.tick);
  };

  // ── Voice lifecycle ──

  private createVoice(key: string, stmt: Statement): void {
    if (!this._isPlaying) return;

    const gainNode = this.ctx.createGain();

    const pannerNode = this.ctx.createPanner();
    // Use 'equalpower' — HRTF is 10-50x more expensive per voice
    pannerNode.panningModel = 'HRTF';
    pannerNode.distanceModel = 'inverse';
    pannerNode.refDistance = 1;
    pannerNode.maxDistance = 50;
    pannerNode.rolloffFactor = 1;
    pannerNode.coneInnerAngle = 360;
    pannerNode.coneOuterAngle = 360;
    pannerNode.coneOuterGain = 0;

    // Use positionX/Y/Z AudioParams instead of deprecated setPosition
    pannerNode.positionX.value = 0;
    pannerNode.positionY.value = 0;
    pannerNode.positionZ.value = 0;

    // Build DSP chain from statement params (native Web Audio nodes — zero JS overhead)
    const dspChain = buildDSPChain(this.ctx, {
      filter: stmt.filterParams,
      distortion: stmt.distortionParams,
      delay: stmt.delayParams,
      reverb: stmt.reverbParams,
      eq: stmt.eqParams,
    });

    // Audio routing: source → gain → [DSP chain] → panner → master
    if (dspChain) {
      gainNode.connect(dspChain.input);
      dspChain.output.connect(pannerNode);
    } else {
      gainNode.connect(pannerNode);
    }
    pannerNode.connect(this.masterGain);

    // Pre-parse static color channels once
    const sc = stmt.staticColor ?? '#1a3a2a';
    const scR = parseInt(sc.substring(1, 3), 16);
    const scG = parseInt(sc.substring(3, 5), 16);
    const scB = parseInt(sc.substring(5, 7), 16);

    const seed = Math.random() * 1000;
    const wanderHz = stmt.wanderHz.sample();

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
      color: this.sampleInitialColor(stmt),
      alpha: stmt.staticAlpha,
      dspChain,
      seed,
      wanderHz,
      // Pre-cache interpolation durations and ease functions
      _cachedDurations: new Map(),
      _cachedEaseFns: new Map(),
      _staticColorR: scR,
      _staticColorG: scG,
      _staticColorB: scB,
      // Pre-compute wander phase offsets
      _px1: seed * 1.0,
      _px2: seed * 2.3,
      _py1: seed * 3.7,
      _py2: seed * 0.5,
      _pz1: seed * 1.3,
      _pz2: seed * 4.2,
      _wanderSpeed: wanderHz * 0.01 * 2 * Math.PI,
    };

    // Pre-cache durations for all interpolations on this voice
    this.cacheInterpolation(track, stmt.volumeInterpolation);
    this.cacheInterpolation(track, stmt.pitchInterpolation);
    this.cacheInterpolation(track, stmt.colorRedInterpolation);
    this.cacheInterpolation(track, stmt.colorGreenInterpolation);
    this.cacheInterpolation(track, stmt.colorBlueInterpolation);
    this.cacheInterpolation(track, stmt.colorAlphaInterpolation);

    this.tracks.set(key, track);
    this._tracksArrayDirty = true;

    // Fire first audio trigger
    this.retriggerAudio(key, stmt);

    // Schedule voice end
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

  /** Cache the sampled duration and resolved ease function for an interpolation. */
  private cacheInterpolation(track: TrackState, interp: InterpolationData | null): void {
    if (!interp) return;
    track._cachedDurations.set(interp, interp.durationRange.sample());
    track._cachedEaseFns.set(interp, getEaseFunction(interp.easeName));
  }

  // ── Audio clip triggering ──

  private retriggerAudio(key: string, stmt: Statement): void {
    if (!this._isPlaying) return;

    const track = this.tracks.get(key);
    if (!track) return;

    const clipPath = pathFor(stmt.clip);
    const buffer = this.audioBuffers.get(clipPath) ?? this.audioBuffers.get(stmt.clip);

    if (!buffer) {
      if (stmt.isGenerated && stmt.genPrompt) {
        // Trigger async generation, then retry playback
        this.generateAndRetrigger(key, stmt, clipPath);
        return;
      }
      console.warn(`[SatieEngine] Audio not loaded: ${stmt.clip} (tried: ${clipPath})`);
      return;
    }

    if (track.sourceNode) {
      try { track.sourceNode.stop(); } catch { /* ok */ }
    }

    const sourceNode = this.ctx.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.loop = stmt.kind === 'loop';
    sourceNode.connect(track.gainNode);

    const volume = stmt.volume.sample();
    const pitch = stmt.pitch.sample();
    track.gainNode.gain.value = volume;
    sourceNode.playbackRate.value = pitch;
    track.volume = volume;
    track.pitch = pitch;
    track.sourceNode = sourceNode;

    if (stmt.randomStart) {
      sourceNode.start(0, Math.random() * buffer.duration);
    } else {
      sourceNode.start();
    }

    // Fade in — use AudioParam automation (runs on audio thread, not main thread)
    if (!stmt.fadeIn.isNull) {
      const fadeTime = stmt.fadeIn.sample();
      track.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
      track.gainNode.gain.linearRampToValueAtTime(volume, this.ctx.currentTime + fadeTime);
    }

    // Schedule next retrigger
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

    if (stmt.kind === 'oneshot' && stmt.every.isNull) {
      sourceNode.onended = () => {
        track.isPlaying = false;
        if (track.dspChain) destroyDSPChain(track.dspChain);
        track.gainNode.disconnect();
        track.pannerNode.disconnect();
        this.tracks.delete(key);
        this._tracksArrayDirty = true;
      };
    }
  }

  // ── Async audio generation for gen statements ──

  private async generateAndRetrigger(key: string, stmt: Statement, clipPath: string): Promise<void> {
    try {
      console.log(`[SatieEngine] Generating audio: "${stmt.genPrompt}" → ${clipPath}`);
      const audioBuffer = await generateAudio(
        this.ctx,
        stmt.genPrompt!,
        clipPath,
        stmt.kind === 'loop',
      );
      this.audioBuffers.set(clipPath, audioBuffer);

      // Retry playback if still playing
      if (this._isPlaying && this.tracks.has(key)) {
        this.retriggerAudio(key, stmt);
      }
    } catch (e: any) {
      console.error(`[SatieEngine] Audio generation failed: ${e.message}`);
    }
  }

  // ── Stop a single track ──

  private stopTrack(key: string, fadeOutTime: number = 0): void {
    const track = this.tracks.get(key);
    if (!track) return;

    this.scheduler.cancelTrackEvents(key);

    const cleanup = () => {
      try { track.sourceNode?.stop(); } catch { /* ok */ }
      if (track.dspChain) destroyDSPChain(track.dspChain);
      track.gainNode.disconnect();
      track.pannerNode.disconnect();
      this.tracks.delete(key);
      this._tracksArrayDirty = true;
    };

    if (fadeOutTime > 0) {
      track.gainNode.gain.linearRampToValueAtTime(0, this.ctx.currentTime + fadeOutTime);
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

  // ── Continuous per-frame updates ──

  private updateTracks(doSpatial: boolean): void {
    const now = this.clock.currentTime;
    const ctxTime = this.ctx.currentTime;

    for (const track of this.tracks.values()) {
      const stmt = track.statement;
      const elapsed = now - track.startedAt;

      // Interpolated volume — use AudioParam automation
      if (stmt.volumeInterpolation) {
        const val = this.evalInterpCached(track, stmt.volumeInterpolation, elapsed);
        // setTargetAtTime smooths value changes on the audio thread
        track.gainNode.gain.setTargetAtTime(val, ctxTime, 0.016);
        track.volume = val;
      }

      // Interpolated pitch
      if (stmt.pitchInterpolation && track.sourceNode) {
        const val = this.evalInterpCached(track, stmt.pitchInterpolation, elapsed);
        track.sourceNode.playbackRate.setTargetAtTime(val, ctxTime, 0.016);
        track.pitch = val;
      }

      // Spatial position — rate-limited
      if (doSpatial && stmt.wanderType !== WanderType.None) {
        this.calculateWanderPositionInPlace(track, stmt, elapsed);
        // Use AudioParam properties directly (non-deprecated, more efficient)
        track.pannerNode.positionX.value = track.position.x;
        track.pannerNode.positionY.value = track.position.y;
        track.pannerNode.positionZ.value = track.position.z;
      }

      // Interpolated color — only compute when interpolation exists
      if (stmt.colorRedInterpolation || stmt.colorGreenInterpolation || stmt.colorBlueInterpolation) {
        const r = stmt.colorRedInterpolation
          ? clamp255(Math.round(this.evalInterpCached(track, stmt.colorRedInterpolation, elapsed) * 255))
          : track._staticColorR;
        const g = stmt.colorGreenInterpolation
          ? clamp255(Math.round(this.evalInterpCached(track, stmt.colorGreenInterpolation, elapsed) * 255))
          : track._staticColorG;
        const b = stmt.colorBlueInterpolation
          ? clamp255(Math.round(this.evalInterpCached(track, stmt.colorBlueInterpolation, elapsed) * 255))
          : track._staticColorB;
        track.color = toHex(r, g, b);
      }

      // Interpolated alpha
      if (stmt.colorAlphaInterpolation) {
        track.alpha = clamp01(this.evalInterpCached(track, stmt.colorAlphaInterpolation, elapsed));
      }
    }
  }

  // ── Interpolation (cached per-track) ──

  /** Evaluate interpolation using cached duration and ease function. */
  private evalInterpCached(track: TrackState, interp: InterpolationData, elapsed: number): number {
    const duration = track._cachedDurations.get(interp) ?? interp.durationRange.sample();
    if (duration <= 0) return interp.minValue;

    const ease = track._cachedEaseFns.get(interp) ?? getEaseFunction(interp.easeName);
    const range = interp.maxValue - interp.minValue;

    switch (interp.interpolationType) {
      case InterpolationType.Goto: {
        const t = elapsed >= duration ? 1 : elapsed / duration;
        return interp.minValue + range * ease(t);
      }
      case InterpolationType.GoBetween: {
        const cycleT = (elapsed % duration) / duration;
        const cycle = (elapsed / duration) | 0; // fast floor
        if (!interp.isForever && cycle >= interp.repeatCount) {
          return interp.maxValue;
        }
        const t = (cycle & 1) ? 1 - cycleT : cycleT;
        return interp.minValue + range * ease(t);
      }
      case InterpolationType.Interpolate: {
        const t = elapsed >= duration ? 1 : elapsed / duration;
        return interp.minValue + range * ease(t);
      }
    }
    return interp.minValue;
  }

  /** Public for backward compat — uses uncached path. */
  evaluateInterpolation(interp: InterpolationData, elapsed: number): number {
    const duration = interp.durationRange.sample();
    if (duration <= 0) return interp.minValue;

    const ease = getEaseFunction(interp.easeName);
    const range = interp.maxValue - interp.minValue;

    switch (interp.interpolationType) {
      case InterpolationType.Goto: {
        const t = Math.min(elapsed / duration, 1);
        return interp.minValue + range * ease(t);
      }
      case InterpolationType.GoBetween: {
        const cycleT = (elapsed % duration) / duration;
        const cycle = Math.floor(elapsed / duration);
        if (!interp.isForever && cycle >= interp.repeatCount) {
          return interp.maxValue;
        }
        const t = (cycle % 2 === 1) ? 1 - cycleT : cycleT;
        return interp.minValue + range * ease(t);
      }
      case InterpolationType.Interpolate: {
        const t = Math.min(elapsed / duration, 1);
        return interp.minValue + range * ease(t);
      }
    }
    return interp.minValue;
  }

  // ── Spatial wander (in-place, no allocation) ──

  private calculateWanderPositionInPlace(track: TrackState, stmt: Statement, elapsed: number): void {
    const t = elapsed * track._wanderSpeed;

    const nx = (Math.sin(t + track._px1) + Math.sin(t * 1.3 + track._px2) + Math.sin(t * 0.7 + track._px1 * 0.3)) / 6 + 0.5;
    const ny = (Math.sin(t * 0.8 + track._py1) + Math.sin(t * 1.1 + track._py2) + Math.sin(t * 0.6 + track._py1 * 0.4)) / 6 + 0.5;
    const nz = (Math.sin(t * 1.2 + track._pz1) + Math.sin(t * 0.7 + track._pz2) + Math.sin(t * 0.9 + track._pz1 * 0.6)) / 6 + 0.5;

    const minX = stmt.areaMin.x, minY = stmt.areaMin.y, minZ = stmt.areaMin.z;

    track.position.x = minX + (stmt.areaMax.x - minX) * nx;
    track.position.y = stmt.wanderType === WanderType.Walk ? 0 : minY + (stmt.areaMax.y - minY) * ny;
    track.position.z = minZ + (stmt.areaMax.z - minZ) * nz;
  }

  private sampleInitialColor(stmt: Statement): string {
    if (stmt.colorRedRange || stmt.colorGreenRange || stmt.colorBlueRange) {
      const r = stmt.colorRedRange ? clamp255(Math.round(stmt.colorRedRange.sample() * 255)) : 0;
      const g = stmt.colorGreenRange ? clamp255(Math.round(stmt.colorGreenRange.sample() * 255)) : 0;
      const b = stmt.colorBlueRange ? clamp255(Math.round(stmt.colorBlueRange.sample() * 255)) : 0;
      return toHex(r, g, b);
    }
    return stmt.staticColor ?? '#1a3a2a';
  }

  destroy(): void {
    this.stop();
    this.ctx.close();
  }
}
