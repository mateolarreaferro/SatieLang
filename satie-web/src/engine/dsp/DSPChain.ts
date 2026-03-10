/**
 * DSP effect chain using native Web Audio API nodes.
 *
 * All processing runs on the browser's audio thread (C++/GPU),
 * so there's zero JS overhead per sample. No AudioWorklets needed.
 *
 * Chain order: source → [filter] → [distortion] → [delay] → [reverb] → [EQ] → output
 */
import type {
  ReverbParams,
  DelayParams,
  FilterParams,
  DistortionParams,
  EQParams,
} from '../core/Statement';

export interface DSPNodes {
  /** The node to connect the source into */
  input: AudioNode;
  /** The node that outputs the processed signal */
  output: AudioNode;
  /** All created nodes — for cleanup */
  nodes: AudioNode[];
  /** Update functions for interpolated DSP params */
  update?: (elapsed: number) => void;
}

// ─── Filter ───────────────────────────────────────────

function createFilter(
  ctx: AudioContext,
  params: FilterParams,
): { filter: BiquadFilterNode; dryWet: GainNode; dry: GainNode; input: GainNode; output: GainNode; nodes: AudioNode[] } {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  const modeMap: Record<string, BiquadFilterType> = {
    lowpass: 'lowpass',
    highpass: 'highpass',
    bandpass: 'bandpass',
    notch: 'notch',
    peak: 'peaking',
  };
  filter.type = modeMap[params.mode] ?? 'lowpass';
  filter.frequency.value = params.cutoff.sample();
  filter.Q.value = params.resonance.sample();

  const w = params.dryWet.sample();
  dry.gain.value = 1 - w;
  wet.gain.value = w;

  // input → dry → output
  // input → filter → wet → output
  input.connect(dry);
  dry.connect(output);
  input.connect(filter);
  filter.connect(wet);
  wet.connect(output);

  return { filter, dryWet: wet, dry, input, output, nodes: [input, output, dry, wet, filter] };
}

// ─── Distortion (WaveShaperNode) ──────────────────────

function makeDistortionCurve(mode: string, drive: number, samples: number = 1024): Float32Array {
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;

  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;

    switch (mode) {
      case 'softclip':
        curve[i] = (Math.PI + drive) * x / (Math.PI + drive * Math.abs(x));
        break;
      case 'hardclip':
        curve[i] = Math.max(-1, Math.min(1, x * drive));
        break;
      case 'tanh':
        curve[i] = Math.tanh(x * drive);
        break;
      case 'cubic':
        curve[i] = x - (drive * x * x * x) / 3;
        break;
      case 'asymmetric':
        curve[i] = x > 0
          ? (1 - Math.exp(-x * drive))
          : -(1 - Math.exp(x * drive)) * 0.8;
        break;
      default: // softclip fallback
        curve[i] = ((3 + drive) * x * 20 * deg) / (Math.PI + drive * Math.abs(x));
        break;
    }
  }
  return curve;
}

function createDistortion(
  ctx: AudioContext,
  params: DistortionParams,
): { shaper: WaveShaperNode; input: GainNode; output: GainNode; nodes: AudioNode[] } {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const shaper = ctx.createWaveShaper();

  const drive = params.drive.sample();
  shaper.curve = makeDistortionCurve(params.mode, drive) as unknown as Float32Array<ArrayBuffer>;
  shaper.oversample = '4x';

  const w = params.dryWet.sample();
  dry.gain.value = 1 - w;
  wet.gain.value = w;

  input.connect(dry);
  dry.connect(output);
  input.connect(shaper);
  shaper.connect(wet);
  wet.connect(output);

  return { shaper, input, output, nodes: [input, output, dry, wet, shaper] };
}

// ─── Delay ────────────────────────────────────────────

function createDelay(
  ctx: AudioContext,
  params: DelayParams,
): { input: GainNode; output: GainNode; nodes: AudioNode[] } {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();

  const delayTime = params.time.sample();
  const feedback = params.feedback.sample();
  const w = params.dryWet.sample();

  dry.gain.value = 1 - w;
  wet.gain.value = w;

  if (params.pingPong) {
    // Stereo ping-pong: L→R→L
    const delayL = ctx.createDelay(5);
    const delayR = ctx.createDelay(5);
    const fbGain = ctx.createGain();
    const merger = ctx.createChannelMerger(2);

    delayL.delayTime.value = delayTime;
    delayR.delayTime.value = delayTime;
    fbGain.gain.value = feedback;

    // input → delayL → merger[0]
    //          delayL → delayR → merger[1]
    //                   delayR → fbGain → delayL (feedback loop)
    input.connect(dry);
    dry.connect(output);
    input.connect(delayL);
    delayL.connect(merger, 0, 0);
    delayL.connect(delayR);
    delayR.connect(merger, 0, 1);
    delayR.connect(fbGain);
    fbGain.connect(delayL);
    merger.connect(wet);
    wet.connect(output);

    return { input, output, nodes: [input, output, dry, wet, delayL, delayR, fbGain, merger] };
  } else {
    // Simple mono delay with feedback
    const delay = ctx.createDelay(5);
    const fbGain = ctx.createGain();

    delay.delayTime.value = delayTime;
    fbGain.gain.value = feedback;

    input.connect(dry);
    dry.connect(output);
    input.connect(delay);
    delay.connect(fbGain);
    fbGain.connect(delay); // feedback loop
    delay.connect(wet);
    wet.connect(output);

    return { input, output, nodes: [input, output, dry, wet, delay, fbGain] };
  }
}

// ─── Reverb (ConvolverNode with generated impulse response) ──

function generateImpulseResponse(
  ctx: AudioContext,
  roomSize: number,
  damping: number,
): AudioBuffer {
  // Room size maps to decay time: 0.3s (tiny) to 6s (cathedral)
  const decayTime = 0.3 + roomSize * 5.7;
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * decayTime);
  const buffer = ctx.createBuffer(2, length, sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      // Exponential decay with damping
      const envelope = Math.exp(-t / (decayTime * 0.4));
      // High-frequency damping: roll off noise at higher time offsets
      const dampFactor = 1 - damping * (t / decayTime);
      // White noise modulated by envelope
      data[i] = (Math.random() * 2 - 1) * envelope * Math.max(0, dampFactor);
    }
  }
  return buffer;
}

function createReverb(
  ctx: AudioContext,
  params: ReverbParams,
): { convolver: ConvolverNode; input: GainNode; output: GainNode; nodes: AudioNode[] } {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const convolver = ctx.createConvolver();

  const roomSize = params.roomSize.sample();
  const damping = params.damping.sample();
  const w = params.dryWet.sample();

  convolver.buffer = generateImpulseResponse(ctx, roomSize, damping);
  dry.gain.value = 1 - w;
  wet.gain.value = w;

  input.connect(dry);
  dry.connect(output);
  input.connect(convolver);
  convolver.connect(wet);
  wet.connect(output);

  return { convolver, input, output, nodes: [input, output, dry, wet, convolver] };
}

// ─── EQ (3-band: low shelf + mid peaking + high shelf) ──

function createEQ(
  ctx: AudioContext,
  params: EQParams,
): { low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode; input: GainNode; output: GainNode; nodes: AudioNode[] } {
  const input = ctx.createGain();
  const output = ctx.createGain();

  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 320;
  low.gain.value = params.lowGain.sample();

  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = 1000;
  mid.Q.value = 0.5;
  mid.gain.value = params.midGain.sample();

  const high = ctx.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = 3200;
  high.gain.value = params.highGain.sample();

  // Series: input → low → mid → high → output
  input.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(output);

  return { low, mid, high, input, output, nodes: [input, output, low, mid, high] };
}

// ─── Build full DSP chain ─────────────────────────────

export function buildDSPChain(
  ctx: AudioContext,
  opts: {
    filter?: FilterParams | null;
    distortion?: DistortionParams | null;
    delay?: DelayParams | null;
    reverb?: ReverbParams | null;
    eq?: EQParams | null;
  },
): DSPNodes | null {
  // Collect active effects in processing order
  const effects: { input: AudioNode; output: AudioNode; nodes: AudioNode[] }[] = [];

  if (opts.filter) effects.push(createFilter(ctx, opts.filter));
  if (opts.distortion) effects.push(createDistortion(ctx, opts.distortion));
  if (opts.delay) effects.push(createDelay(ctx, opts.delay));
  if (opts.reverb) effects.push(createReverb(ctx, opts.reverb));
  if (opts.eq) effects.push(createEQ(ctx, opts.eq));

  if (effects.length === 0) return null;

  // Wire effects in series
  for (let i = 0; i < effects.length - 1; i++) {
    effects[i].output.connect(effects[i + 1].input);
  }

  const allNodes = effects.flatMap(e => e.nodes);

  return {
    input: effects[0].input,
    output: effects[effects.length - 1].output,
    nodes: allNodes,
  };
}

/**
 * Disconnect and release all nodes in a DSP chain.
 */
export function destroyDSPChain(chain: DSPNodes): void {
  for (const node of chain.nodes) {
    try { node.disconnect(); } catch { /* already disconnected */ }
  }
}
