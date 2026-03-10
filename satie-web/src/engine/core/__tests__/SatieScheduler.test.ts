import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SatieScheduler, AudioEventType } from '../SatieScheduler';
import { SatieDSPClock } from '../SatieDSPClock';

// Mock AudioContext
function mockAudioContext(time: number = 0): AudioContext {
  return {
    currentTime: time,
    sampleRate: 48000,
  } as unknown as AudioContext;
}

describe('SatieScheduler', () => {
  let ctx: AudioContext;
  let clock: SatieDSPClock;
  let scheduler: SatieScheduler;

  beforeEach(() => {
    ctx = mockAudioContext(0);
    clock = new SatieDSPClock(ctx);
    clock.start();
    scheduler = new SatieScheduler(clock);
  });

  it('starts empty', () => {
    expect(scheduler.eventCount).toBe(0);
    expect(scheduler.totalScheduled).toBe(0);
    expect(scheduler.totalProcessed).toBe(0);
  });

  it('schedules an event', () => {
    scheduler.schedule({
      scheduledSample: 0,
      type: AudioEventType.Play,
      trackKey: 'test',
    });
    expect(scheduler.eventCount).toBe(1);
    expect(scheduler.totalScheduled).toBe(1);
  });

  it('processes events at or before current sample', () => {
    const callback = vi.fn();
    scheduler.schedule({
      scheduledSample: 0,
      type: AudioEventType.Callback,
      trackKey: 'test',
      onExecute: callback,
    });

    // Advance time
    (ctx as any).currentTime = 0.001;
    scheduler.process();

    expect(callback).toHaveBeenCalledOnce();
    expect(scheduler.totalProcessed).toBe(1);
    expect(scheduler.eventCount).toBe(0);
  });

  it('does not process future events', () => {
    const callback = vi.fn();
    scheduler.schedule({
      scheduledSample: 96000, // 2 seconds at 48kHz
      type: AudioEventType.Callback,
      trackKey: 'test',
      onExecute: callback,
    });

    (ctx as any).currentTime = 0.5; // only 0.5s in
    scheduler.process();

    expect(callback).not.toHaveBeenCalled();
    expect(scheduler.eventCount).toBe(1);
  });

  it('scheduleAt converts seconds to samples', () => {
    const callback = vi.fn();
    scheduler.scheduleAt(
      {
        scheduledSample: 0,
        type: AudioEventType.Callback,
        trackKey: 'test',
        onExecute: callback,
      },
      1.0, // 1 second = 48000 samples
    );

    // at 0.5s, shouldn't fire
    (ctx as any).currentTime = 0.5;
    scheduler.process();
    expect(callback).not.toHaveBeenCalled();

    // at 1.1s, should fire
    (ctx as any).currentTime = 1.1;
    scheduler.process();
    expect(callback).toHaveBeenCalledOnce();
  });

  it('scheduleAfter offsets from current time', () => {
    const callback = vi.fn();
    (ctx as any).currentTime = 1.0; // current time is 1s

    scheduler.scheduleAfter(
      {
        scheduledSample: 0,
        type: AudioEventType.Callback,
        trackKey: 'test',
        onExecute: callback,
      },
      0.5, // 0.5s from now = 1.5s
    );

    (ctx as any).currentTime = 1.2;
    scheduler.process();
    expect(callback).not.toHaveBeenCalled();

    (ctx as any).currentTime = 1.6;
    scheduler.process();
    expect(callback).toHaveBeenCalledOnce();
  });

  it('cancelTrackEvents removes only that track', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    scheduler.schedule({
      scheduledSample: 100,
      type: AudioEventType.Callback,
      trackKey: 'track_a',
      onExecute: cb1,
    });
    scheduler.schedule({
      scheduledSample: 100,
      type: AudioEventType.Callback,
      trackKey: 'track_b',
      onExecute: cb2,
    });

    scheduler.cancelTrackEvents('track_a');

    (ctx as any).currentTime = 1.0;
    scheduler.process();

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it('cancelAll clears everything', () => {
    for (let i = 0; i < 10; i++) {
      scheduler.schedule({
        scheduledSample: i * 1000,
        type: AudioEventType.Play,
        trackKey: `track_${i}`,
      });
    }
    expect(scheduler.eventCount).toBe(10);

    scheduler.cancelAll();
    expect(scheduler.eventCount).toBe(0);
  });

  it('reset clears state and counters', () => {
    scheduler.schedule({
      scheduledSample: 0,
      type: AudioEventType.Play,
      trackKey: 'test',
    });
    (ctx as any).currentTime = 0.01;
    scheduler.process();

    scheduler.reset();
    expect(scheduler.eventCount).toBe(0);
    expect(scheduler.totalScheduled).toBe(0);
    expect(scheduler.totalProcessed).toBe(0);
  });

  it('does not re-process already processed samples', () => {
    const callback = vi.fn();
    scheduler.schedule({
      scheduledSample: 100,
      type: AudioEventType.Callback,
      trackKey: 'test',
      onExecute: callback,
    });

    (ctx as any).currentTime = 0.01;
    scheduler.process();
    scheduler.process(); // second call at same time

    expect(callback).toHaveBeenCalledOnce();
  });

  it('handles errors in event callbacks gracefully', () => {
    const errorCb = vi.fn(() => { throw new Error('boom'); });
    const okCb = vi.fn();

    scheduler.schedule({
      scheduledSample: 0,
      type: AudioEventType.Callback,
      trackKey: 'err',
      onExecute: errorCb,
    });
    scheduler.schedule({
      scheduledSample: 0,
      type: AudioEventType.Callback,
      trackKey: 'ok',
      onExecute: okCb,
    });

    (ctx as any).currentTime = 0.01;
    // Should not throw
    scheduler.process();
    expect(errorCb).toHaveBeenCalled();
    // Events at same sample time are in same array, both should be attempted
  });
});
