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
import { Statement, WanderType, Vec3, isTrajectoryWanderType } from './Statement';
import { getTrajectory } from '../spatial/Trajectories';
import { parse, pathFor } from './SatieParser';
import { getEaseFunction, type EaseFunction } from './EaseFunctions';
import { InterpolationData, InterpolationType } from './InterpolationData';
import { buildDSPChain, destroyDSPChain, makeDistortionCurve, type DSPNodes } from '../dsp/DSPChain';
import { generateAudio, type GenOptions } from '../audio/AudioGen';

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
  _trajectoryPhase: number; // random phase offset for trajectory modes
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
  mutedIndices: ReadonlySet<number>;
  soloedIndices: ReadonlySet<number>;
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

  /** Runtime mixer state (independent of parsed mute/solo) */
  private _mutedIndices: Set<number> = new Set();
  private _soloedIndices: Set<number> = new Set();

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

  /** Sync the AudioListener to the camera/observer position. */
  setListenerPosition(x: number, y: number, z: number): void {
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = x;
      l.positionY.value = y;
      l.positionZ.value = z;
    } else {
      // Fallback for older browsers
      l.setPosition(x, y, z);
    }
  }

  /** Sync the AudioListener orientation (forward + up vectors). */
  setListenerOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    const l = this.ctx.listener;
    if (l.forwardX) {
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
      l.upX.value = ux;
      l.upY.value = uy;
      l.upZ.value = uz;
    } else {
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

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
      mutedIndices: this._mutedIndices,
      soloedIndices: this._soloedIndices,
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

    // Eager pre-generation: kick off all gen audio requests in parallel
    this.preGenerateAll();

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

  // ── Mixer: runtime mute/solo ──

  toggleMute(statementIndex: number): void {
    // Create new Set so React memo detects the reference change
    const next = new Set(this._mutedIndices);
    if (next.has(statementIndex)) {
      next.delete(statementIndex);
    } else {
      next.add(statementIndex);
    }
    this._mutedIndices = next;
    this.applyMixerState();
    this.notifyUI();
  }

  toggleSolo(statementIndex: number): void {
    const next = new Set(this._soloedIndices);
    if (next.has(statementIndex)) {
      next.delete(statementIndex);
    } else {
      next.add(statementIndex);
    }
    this._soloedIndices = next;
    this.applyMixerState();
    this.notifyUI();
  }

  get mutedIndices(): ReadonlySet<number> { return this._mutedIndices; }
  get soloedIndices(): ReadonlySet<number> { return this._soloedIndices; }

  /** Check if a track is audible given current mute/solo state. */
  private isTrackAudible(track: TrackState): boolean {
    const parts = track.key.split('_');
    const stmtIndex = parseInt(parts[parts.length - 2], 10);
    if (this._mutedIndices.has(stmtIndex)) return false;
    if (this._soloedIndices.size > 0 && !this._soloedIndices.has(stmtIndex)) return false;
    return true;
  }

  /** Recalculate which tracks are audible based on mute/solo state. */
  private applyMixerState(): void {
    for (const track of this.tracks.values()) {
      const targetGain = this.isTrackAudible(track) ? track.volume : 0;
      track.gainNode.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.016);
    }
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
    pannerNode.panningModel = 'equalpower';
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
      _trajectoryPhase: Math.random(),
    };

    // Pre-cache durations for all interpolations on this voice
    this.cacheInterpolation(track, stmt.volumeInterpolation);
    this.cacheInterpolation(track, stmt.pitchInterpolation);
    this.cacheInterpolation(track, stmt.colorRedInterpolation);
    this.cacheInterpolation(track, stmt.colorGreenInterpolation);
    this.cacheInterpolation(track, stmt.colorBlueInterpolation);
    this.cacheInterpolation(track, stmt.colorAlphaInterpolation);
    // DSP interpolations
    if (stmt.filterParams) {
      this.cacheInterpolation(track, stmt.filterParams.cutoffInterpolation);
      this.cacheInterpolation(track, stmt.filterParams.resonanceInterpolation);
      this.cacheInterpolation(track, stmt.filterParams.dryWetInterpolation);
    }
    if (stmt.distortionParams) {
      this.cacheInterpolation(track, stmt.distortionParams.driveInterpolation);
      this.cacheInterpolation(track, stmt.distortionParams.dryWetInterpolation);
    }
    if (stmt.delayParams) {
      this.cacheInterpolation(track, stmt.delayParams.timeInterpolation);
      this.cacheInterpolation(track, stmt.delayParams.feedbackInterpolation);
      this.cacheInterpolation(track, stmt.delayParams.dryWetInterpolation);
    }
    if (stmt.reverbParams) {
      this.cacheInterpolation(track, stmt.reverbParams.dryWetInterpolation);
    }
    if (stmt.eqParams) {
      this.cacheInterpolation(track, stmt.eqParams.lowGainInterpolation);
      this.cacheInterpolation(track, stmt.eqParams.midGainInterpolation);
      this.cacheInterpolation(track, stmt.eqParams.highGainInterpolation);
    }

    this.tracks.set(key, track);
    this._tracksArrayDirty = true;

    // Apply mixer mute/solo state to new voice
    if (!this.isTrackAudible(track)) {
      track.gainNode.gain.value = 0;
    }

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

  /** Sample gen options from statement ranges. */
  private sampleGenOptions(stmt: Statement): GenOptions {
    const opts: GenOptions = {};
    if (!stmt.genDuration.isNull) {
      opts.duration = stmt.genDuration.sample();
    } else if (stmt.genLoopable) {
      opts.duration = 10; // loopable default
    }
    if (!stmt.genInfluence.isNull) {
      opts.influence = stmt.genInfluence.sample();
    }
    return opts;
  }

  /** Eagerly pre-generate all gen audio on play(). Doesn't block playback. */
  private preGenerateAll(): void {
    // Track prompts we've seen — when the same prompt appears multiple times
    // (from count > 1), vary the prompt so ElevenLabs produces distinct sounds
    const promptCounts = new Map<string, number>();

    for (let i = 0; i < this.statements.length; i++) {
      const stmt = this.statements[i];
      if (!stmt.isGenerated || !stmt.genPrompt) continue;

      const clipPath = pathFor(stmt.clip);
      // Skip if already loaded
      if (this.audioBuffers.has(clipPath) || this.audioBuffers.has(stmt.clip)) continue;

      // Vary the prompt for duplicate gen requests so each variant sounds different
      const basePrompt = stmt.genPrompt;
      const count = (promptCounts.get(basePrompt) ?? 0) + 1;
      promptCounts.set(basePrompt, count);

      let effectivePrompt = basePrompt;
      if (count > 1) {
        // Add a variation suffix to produce a distinct sound
        const variations = ['with subtle variation', 'slightly different texture', 'alternative take', 'another version', 'different character'];
        effectivePrompt = `${basePrompt}, ${variations[(count - 2) % variations.length]}`;
      }

      const opts = this.sampleGenOptions(stmt);
      console.log(`[SatieEngine] Pre-generating audio: "${effectivePrompt}" → ${clipPath}`);
      generateAudio(this.ctx, effectivePrompt, clipPath, stmt.kind === 'loop', opts)
        .then((audioBuffer) => {
          this.audioBuffers.set(clipPath, audioBuffer);
        })
        .catch((e: any) => {
          console.error(`[SatieEngine] Pre-generation failed: ${e.message}`);
        });
    }
  }

  private async generateAndRetrigger(key: string, stmt: Statement, clipPath: string): Promise<void> {
    try {
      const opts = this.sampleGenOptions(stmt);

      // Detect variant suffix (e.g., _2, _3) and vary the prompt
      let effectivePrompt = stmt.genPrompt!;
      const variantMatch = clipPath.match(/_(\d+)$/);
      if (variantMatch) {
        const variantIdx = parseInt(variantMatch[1]);
        if (variantIdx > 1) {
          const variations = ['with subtle variation', 'slightly different texture', 'alternative take', 'another version', 'different character'];
          effectivePrompt = `${effectivePrompt}, ${variations[(variantIdx - 2) % variations.length]}`;
        }
      }

      console.log(`[SatieEngine] Generating audio: "${effectivePrompt}" → ${clipPath}`);
      const audioBuffer = await generateAudio(
        this.ctx,
        effectivePrompt,
        clipPath,
        stmt.kind === 'loop',
        opts,
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
        track.volume = val;
        // Respect mixer mute/solo state
        const audibleVal = this.isTrackAudible(track) ? val : 0;
        track.gainNode.gain.setTargetAtTime(audibleVal, ctxTime, 0.016);
      }

      // Interpolated pitch
      if (stmt.pitchInterpolation && track.sourceNode) {
        const val = this.evalInterpCached(track, stmt.pitchInterpolation, elapsed);
        track.sourceNode.playbackRate.setTargetAtTime(val, ctxTime, 0.016);
        track.pitch = val;
      }

      // Spatial position — rate-limited
      if (doSpatial && stmt.wanderType !== WanderType.None) {
        if (isTrajectoryWanderType(stmt.wanderType)) {
          this.calculateTrajectoryPositionInPlace(track, stmt, elapsed);
        } else {
          this.calculateWanderPositionInPlace(track, stmt, elapsed);
        }
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

      // DSP parameter interpolation
      if (track.dspChain) {
        this.updateDSPInterpolations(track, stmt, elapsed, ctxTime, doSpatial);
      }
    }
  }

  // ── DSP interpolation (per-frame for AudioParams, rate-limited for expensive ops) ──

  private updateDSPInterpolations(track: TrackState, stmt: Statement, elapsed: number, ctxTime: number, doSpatial: boolean): void {
    const dsp = track.dspChain!;

    // Filter
    if (stmt.filterParams && dsp.filterRef) {
      const fp = stmt.filterParams;
      if (fp.cutoffInterpolation) {
        dsp.filterRef.filter.frequency.setTargetAtTime(
          this.evalInterpCached(track, fp.cutoffInterpolation, elapsed), ctxTime, 0.016);
      }
      if (fp.resonanceInterpolation) {
        dsp.filterRef.filter.Q.setTargetAtTime(
          this.evalInterpCached(track, fp.resonanceInterpolation, elapsed), ctxTime, 0.016);
      }
      if (fp.dryWetInterpolation) {
        const w = clamp01(this.evalInterpCached(track, fp.dryWetInterpolation, elapsed));
        dsp.filterRef.wet.gain.setTargetAtTime(w, ctxTime, 0.016);
        dsp.filterRef.dry.gain.setTargetAtTime(1 - w, ctxTime, 0.016);
      }
    }

    // Distortion — drive regenerates curve at spatial rate (30fps) to avoid excess cost
    if (stmt.distortionParams && dsp.distortionRef) {
      const dp = stmt.distortionParams;
      if (dp.driveInterpolation && doSpatial) {
        const drive = this.evalInterpCached(track, dp.driveInterpolation, elapsed);
        dsp.distortionRef.shaper.curve = makeDistortionCurve(
          dsp.distortionRef.mode, drive) as unknown as Float32Array<ArrayBuffer>;
      }
      if (dp.dryWetInterpolation) {
        const w = clamp01(this.evalInterpCached(track, dp.dryWetInterpolation, elapsed));
        dsp.distortionRef.wet.gain.setTargetAtTime(w, ctxTime, 0.016);
        dsp.distortionRef.dry.gain.setTargetAtTime(1 - w, ctxTime, 0.016);
      }
    }

    // Delay
    if (stmt.delayParams && dsp.delayRef) {
      const dlp = stmt.delayParams;
      if (dlp.timeInterpolation) {
        const t = this.evalInterpCached(track, dlp.timeInterpolation, elapsed);
        for (const d of dsp.delayRef.delays) {
          d.delayTime.setTargetAtTime(t, ctxTime, 0.016);
        }
      }
      if (dlp.feedbackInterpolation) {
        dsp.delayRef.fbGain.gain.setTargetAtTime(
          this.evalInterpCached(track, dlp.feedbackInterpolation, elapsed), ctxTime, 0.016);
      }
      if (dlp.dryWetInterpolation) {
        const w = clamp01(this.evalInterpCached(track, dlp.dryWetInterpolation, elapsed));
        dsp.delayRef.wet.gain.setTargetAtTime(w, ctxTime, 0.016);
        dsp.delayRef.dry.gain.setTargetAtTime(1 - w, ctxTime, 0.016);
      }
    }

    // Reverb — only dryWet (roomSize/damping require IR regeneration, too expensive)
    if (stmt.reverbParams && dsp.reverbRef) {
      if (stmt.reverbParams.dryWetInterpolation) {
        const w = clamp01(this.evalInterpCached(track, stmt.reverbParams.dryWetInterpolation, elapsed));
        dsp.reverbRef.wet.gain.setTargetAtTime(w, ctxTime, 0.016);
        dsp.reverbRef.dry.gain.setTargetAtTime(1 - w, ctxTime, 0.016);
      }
    }

    // EQ
    if (stmt.eqParams && dsp.eqRef) {
      const eq = stmt.eqParams;
      if (eq.lowGainInterpolation) {
        dsp.eqRef.low.gain.setTargetAtTime(
          this.evalInterpCached(track, eq.lowGainInterpolation, elapsed), ctxTime, 0.016);
      }
      if (eq.midGainInterpolation) {
        dsp.eqRef.mid.gain.setTargetAtTime(
          this.evalInterpCached(track, eq.midGainInterpolation, elapsed), ctxTime, 0.016);
      }
      if (eq.highGainInterpolation) {
        dsp.eqRef.high.gain.setTargetAtTime(
          this.evalInterpCached(track, eq.highGainInterpolation, elapsed), ctxTime, 0.016);
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

    let nx = (Math.sin(t + track._px1) + Math.sin(t * 1.3 + track._px2) + Math.sin(t * 0.7 + track._px1 * 0.3)) / 6 + 0.5;
    let ny = (Math.sin(t * 0.8 + track._py1) + Math.sin(t * 1.1 + track._py2) + Math.sin(t * 0.6 + track._py1 * 0.4)) / 6 + 0.5;
    let nz = (Math.sin(t * 1.2 + track._pz1) + Math.sin(t * 0.7 + track._pz2) + Math.sin(t * 0.9 + track._pz1 * 0.6)) / 6 + 0.5;

    // High-frequency noise perturbation — makes paths jittery/organic
    if (stmt.noise > 0) {
      const ht = elapsed * 3.7; // faster than the base wander
      const n = stmt.noise * 0.15;
      nx += (Math.sin(ht * 2.3 + track._px2 * 5) + Math.sin(ht * 3.1 + track._px1 * 7)) * n;
      ny += (Math.sin(ht * 1.9 + track._py2 * 5) + Math.sin(ht * 2.7 + track._py1 * 7)) * n;
      nz += (Math.sin(ht * 2.1 + track._pz2 * 5) + Math.sin(ht * 3.3 + track._pz1 * 7)) * n;
    }

    const minX = stmt.areaMin.x, minY = stmt.areaMin.y, minZ = stmt.areaMin.z;

    track.position.x = minX + (stmt.areaMax.x - minX) * nx;
    track.position.y = stmt.wanderType === WanderType.Walk ? 0 : minY + (stmt.areaMax.y - minY) * ny;
    track.position.z = minZ + (stmt.areaMax.z - minZ) * nz;
  }

  private calculateTrajectoryPositionInPlace(track: TrackState, stmt: Statement, elapsed: number): void {
    const trajectoryName = stmt.wanderType === WanderType.Custom ? stmt.customTrajectoryName : stmt.wanderType;
    const trajectory = trajectoryName ? getTrajectory(trajectoryName) : undefined;
    if (!trajectory) return;

    const speed = track.wanderHz; // wanderHz holds speed for trajectories
    const t = (elapsed * speed + track._trajectoryPhase) % 1;
    const pt = trajectory.evaluate(t);

    const minX = stmt.areaMin.x, minY = stmt.areaMin.y, minZ = stmt.areaMin.z;
    const rangeX = stmt.areaMax.x - minX;
    const rangeY = stmt.areaMax.y - minY;
    const rangeZ = stmt.areaMax.z - minZ;

    if (stmt.noise > 0) {
      // Per-voice sinusoidal noise — each instance diverges due to unique phase offsets
      const n = stmt.noise * 0.5; // scale: noise 1.0 = ±50% perturbation
      const nt = elapsed * 0.7;
      const nx = (Math.sin(nt + track._px1) + Math.sin(nt * 1.7 + track._px2)) * n;
      const ny = (Math.sin(nt * 0.9 + track._py1) + Math.sin(nt * 1.4 + track._py2)) * n;
      const nz = (Math.sin(nt * 1.1 + track._pz1) + Math.sin(nt * 1.6 + track._pz2)) * n;
      track.position.x = minX + rangeX * (pt.x + nx);
      track.position.y = minY + rangeY * (pt.y + ny);
      track.position.z = minZ + rangeZ * (pt.z + nz);
    } else {
      track.position.x = minX + rangeX * pt.x;
      track.position.y = minY + rangeY * pt.y;
      track.position.z = minZ + rangeZ * pt.z;
    }
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
