import { describe, it, expect } from 'vitest';
import { SatieDSPClock } from '../SatieDSPClock';

function mockAudioContext(time: number = 0, sampleRate: number = 48000): AudioContext {
  return {
    currentTime: time,
    sampleRate,
  } as unknown as AudioContext;
}

describe('SatieDSPClock', () => {
  it('currentTime is 0 before start', () => {
    const ctx = mockAudioContext(5.0);
    const clock = new SatieDSPClock(ctx);
    expect(clock.currentTime).toBe(0);
  });

  it('currentTime tracks relative time after start', () => {
    const ctx = mockAudioContext(10.0);
    const clock = new SatieDSPClock(ctx);
    clock.start();

    (ctx as any).currentTime = 12.5;
    expect(clock.currentTime).toBeCloseTo(2.5);
  });

  it('currentSample converts to sample count', () => {
    const ctx = mockAudioContext(0, 48000);
    const clock = new SatieDSPClock(ctx);
    clock.start();

    (ctx as any).currentTime = 1.0;
    expect(clock.currentSample).toBe(48000);
  });

  it('sampleRate returns context sample rate', () => {
    const ctx = mockAudioContext(0, 44100);
    const clock = new SatieDSPClock(ctx);
    expect(clock.sampleRate).toBe(44100);
  });

  it('secondsToSamples converts correctly', () => {
    const ctx = mockAudioContext(0, 48000);
    const clock = new SatieDSPClock(ctx);
    expect(clock.secondsToSamples(1.0)).toBe(48000);
    expect(clock.secondsToSamples(0.5)).toBe(24000);
  });

  it('samplesToSeconds converts correctly', () => {
    const ctx = mockAudioContext(0, 48000);
    const clock = new SatieDSPClock(ctx);
    expect(clock.samplesToSeconds(48000)).toBe(1.0);
    expect(clock.samplesToSeconds(24000)).toBe(0.5);
  });

  it('reset moves start time forward', () => {
    const ctx = mockAudioContext(0);
    const clock = new SatieDSPClock(ctx);
    clock.start();

    (ctx as any).currentTime = 5.0;
    clock.reset();

    (ctx as any).currentTime = 7.0;
    expect(clock.currentTime).toBeCloseTo(2.0);
  });

  it('absoluteTime returns raw AudioContext time', () => {
    const ctx = mockAudioContext(42.0);
    const clock = new SatieDSPClock(ctx);
    expect(clock.absoluteTime).toBe(42.0);
  });

  it('getScheduledTime adds offset to absolute time', () => {
    const ctx = mockAudioContext(10.0);
    const clock = new SatieDSPClock(ctx);
    expect(clock.getScheduledTime(2.5)).toBeCloseTo(12.5);
  });
});
