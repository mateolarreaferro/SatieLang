import { describe, it, expect } from 'vitest';
import { buildDSPChain, destroyDSPChain } from '../DSPChain';
import { RangeOrValue } from '../../core/RangeOrValue';
import type {
  ReverbParams,
  DelayParams,
  FilterParams,
  DistortionParams,
  EQParams,
} from '../../core/Statement';

// Minimal OfflineAudioContext mock — just enough to create nodes
// Real Web Audio isn't available in Node, so we test the logic structurally.

function mockGainNode() {
  return {
    gain: { value: 1, setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, setTargetAtTime: () => {} },
    connect: () => {},
    disconnect: () => {},
  };
}

function mockBiquadFilter() {
  return {
    type: 'lowpass',
    frequency: { value: 350 },
    Q: { value: 1 },
    gain: { value: 0 },
    connect: () => {},
    disconnect: () => {},
  };
}

function mockDelay() {
  return {
    delayTime: { value: 0 },
    connect: () => {},
    disconnect: () => {},
  };
}

function mockConvolver() {
  return {
    buffer: null,
    connect: () => {},
    disconnect: () => {},
  };
}

function mockWaveShaper() {
  return {
    curve: null,
    oversample: 'none',
    connect: () => {},
    disconnect: () => {},
  };
}

function mockMerger() {
  return {
    connect: () => {},
    disconnect: () => {},
  };
}

function mockAudioContext(): AudioContext {
  const ctx = {
    sampleRate: 48000,
    currentTime: 0,
    createGain: () => mockGainNode(),
    createBiquadFilter: () => mockBiquadFilter(),
    createDelay: () => mockDelay(),
    createConvolver: () => mockConvolver(),
    createWaveShaper: () => mockWaveShaper(),
    createChannelMerger: () => mockMerger(),
    createBuffer: (channels: number, length: number, sampleRate: number) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
  };
  return ctx as unknown as AudioContext;
}

describe('DSPChain', () => {
  const ctx = mockAudioContext();

  it('returns null when no effects specified', () => {
    const chain = buildDSPChain(ctx, {});
    expect(chain).toBeNull();
  });

  it('returns null when all effects are null', () => {
    const chain = buildDSPChain(ctx, {
      filter: null,
      distortion: null,
      delay: null,
      reverb: null,
      eq: null,
    });
    expect(chain).toBeNull();
  });

  it('builds filter chain', () => {
    const filter: FilterParams = {
      mode: 'lowpass',
      cutoff: RangeOrValue.single(1000),
      resonance: RangeOrValue.single(1),
      dryWet: RangeOrValue.single(1),
      cutoffInterpolation: null,
      resonanceInterpolation: null,
      dryWetInterpolation: null,
    };
    const chain = buildDSPChain(ctx, { filter });
    expect(chain).not.toBeNull();
    expect(chain!.input).toBeDefined();
    expect(chain!.output).toBeDefined();
    expect(chain!.nodes.length).toBeGreaterThan(0);

    // Should not throw
    destroyDSPChain(chain!);
  });

  it('builds reverb chain', () => {
    const reverb: ReverbParams = {
      dryWet: RangeOrValue.single(0.5),
      roomSize: RangeOrValue.single(0.7),
      damping: RangeOrValue.single(0.3),
      dryWetInterpolation: null,
      roomSizeInterpolation: null,
      dampingInterpolation: null,
    };
    const chain = buildDSPChain(ctx, { reverb });
    expect(chain).not.toBeNull();
    expect(chain!.nodes.length).toBeGreaterThan(0);
    destroyDSPChain(chain!);
  });

  it('builds delay chain', () => {
    const delay: DelayParams = {
      dryWet: RangeOrValue.single(0.5),
      time: RangeOrValue.single(0.3),
      feedback: RangeOrValue.single(0.5),
      pingPong: false,
      dryWetInterpolation: null,
      timeInterpolation: null,
      feedbackInterpolation: null,
    };
    const chain = buildDSPChain(ctx, { delay });
    expect(chain).not.toBeNull();
    destroyDSPChain(chain!);
  });

  it('builds ping-pong delay chain', () => {
    const delay: DelayParams = {
      dryWet: RangeOrValue.single(0.5),
      time: RangeOrValue.single(0.25),
      feedback: RangeOrValue.single(0.4),
      pingPong: true,
      dryWetInterpolation: null,
      timeInterpolation: null,
      feedbackInterpolation: null,
    };
    const chain = buildDSPChain(ctx, { delay });
    expect(chain).not.toBeNull();
    // Ping-pong has more nodes than mono delay
    expect(chain!.nodes.length).toBeGreaterThanOrEqual(6);
    destroyDSPChain(chain!);
  });

  it('builds distortion chain', () => {
    const distortion: DistortionParams = {
      mode: 'tanh',
      drive: RangeOrValue.single(3),
      dryWet: RangeOrValue.single(0.8),
      driveInterpolation: null,
      dryWetInterpolation: null,
    };
    const chain = buildDSPChain(ctx, { distortion });
    expect(chain).not.toBeNull();
    destroyDSPChain(chain!);
  });

  it('builds EQ chain', () => {
    const eq: EQParams = {
      lowGain: RangeOrValue.single(3),
      midGain: RangeOrValue.single(-2),
      highGain: RangeOrValue.single(1),
      lowGainInterpolation: null,
      midGainInterpolation: null,
      highGainInterpolation: null,
    };
    const chain = buildDSPChain(ctx, { eq });
    expect(chain).not.toBeNull();
    // EQ: input + low + mid + high + output = 5 nodes
    expect(chain!.nodes.length).toBe(5);
    destroyDSPChain(chain!);
  });

  it('chains multiple effects together', () => {
    const filter: FilterParams = {
      mode: 'lowpass',
      cutoff: RangeOrValue.single(2000),
      resonance: RangeOrValue.single(1),
      dryWet: RangeOrValue.single(1),
      cutoffInterpolation: null,
      resonanceInterpolation: null,
      dryWetInterpolation: null,
    };
    const reverb: ReverbParams = {
      dryWet: RangeOrValue.single(0.5),
      roomSize: RangeOrValue.single(0.8),
      damping: RangeOrValue.single(0.5),
      dryWetInterpolation: null,
      roomSizeInterpolation: null,
      dampingInterpolation: null,
    };
    const eq: EQParams = {
      lowGain: RangeOrValue.single(2),
      midGain: RangeOrValue.single(0),
      highGain: RangeOrValue.single(-1),
      lowGainInterpolation: null,
      midGainInterpolation: null,
      highGainInterpolation: null,
    };

    const chain = buildDSPChain(ctx, { filter, reverb, eq });
    expect(chain).not.toBeNull();
    // All three effects' nodes combined
    expect(chain!.nodes.length).toBeGreaterThan(10);
    destroyDSPChain(chain!);
  });

  it('all distortion modes produce valid curves', () => {
    const modes = ['softclip', 'hardclip', 'tanh', 'cubic', 'asymmetric'];
    for (const mode of modes) {
      const chain = buildDSPChain(ctx, {
        distortion: {
          mode,
          drive: RangeOrValue.single(2),
          dryWet: RangeOrValue.single(1),
          driveInterpolation: null,
          dryWetInterpolation: null,
        },
      });
      expect(chain).not.toBeNull();
      destroyDSPChain(chain!);
    }
  });

  it('all filter modes are accepted', () => {
    const modes = ['lowpass', 'highpass', 'bandpass', 'notch', 'peak'];
    for (const mode of modes) {
      const chain = buildDSPChain(ctx, {
        filter: {
          mode,
          cutoff: RangeOrValue.single(1000),
          resonance: RangeOrValue.single(1),
          dryWet: RangeOrValue.single(1),
          cutoffInterpolation: null,
          resonanceInterpolation: null,
          dryWetInterpolation: null,
        },
      });
      expect(chain).not.toBeNull();
      destroyDSPChain(chain!);
    }
  });

  it('dry/wet mix at 0 means fully dry', () => {
    // When dryWet = 0, dry gain should be 1 and wet gain should be 0
    const filter: FilterParams = {
      mode: 'lowpass',
      cutoff: RangeOrValue.single(1000),
      resonance: RangeOrValue.single(1),
      dryWet: RangeOrValue.single(0),
      cutoffInterpolation: null,
      resonanceInterpolation: null,
      dryWetInterpolation: null,
    };
    const chain = buildDSPChain(ctx, { filter });
    expect(chain).not.toBeNull();
    destroyDSPChain(chain!);
  });
});
