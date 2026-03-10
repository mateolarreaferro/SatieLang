import { useRef, useCallback } from 'react';

// Tiny synthesized UI sounds — no audio files needed
// All sounds are very subtle, short, and musical

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  if (sharedCtx.state === 'suspended') sharedCtx.resume();
  return sharedCtx;
}

function ping(freq: number, duration: number, volume = 0.06, type: OscillatorType = 'sine') {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

export function useSFX() {
  const enabled = useRef(true);

  const hover = useCallback(() => {
    if (!enabled.current) return;
    ping(880, 0.06, 0.03);
  }, []);

  const click = useCallback(() => {
    if (!enabled.current) return;
    ping(660, 0.08, 0.05);
  }, []);

  const play = useCallback(() => {
    if (!enabled.current) return;
    // Rising two-note chime
    ping(523, 0.12, 0.06); // C5
    setTimeout(() => ping(659, 0.15, 0.06), 80); // E5
  }, []);

  const stop = useCallback(() => {
    if (!enabled.current) return;
    // Falling note
    ping(440, 0.15, 0.05); // A4
  }, []);

  const save = useCallback(() => {
    if (!enabled.current) return;
    ping(784, 0.1, 0.04); // G5
  }, []);

  const toggle = useCallback(() => {
    if (!enabled.current) return;
    ping(1047, 0.05, 0.03); // C6 — very short tick
  }, []);

  const open = useCallback(() => {
    if (!enabled.current) return;
    // Soft ascending arpeggio
    ping(440, 0.12, 0.04);
    setTimeout(() => ping(554, 0.12, 0.04), 50);
    setTimeout(() => ping(659, 0.15, 0.04), 100);
  }, []);

  const close = useCallback(() => {
    if (!enabled.current) return;
    ping(330, 0.12, 0.04); // E4
  }, []);

  const del = useCallback(() => {
    if (!enabled.current) return;
    // Low thud
    ping(150, 0.15, 0.06, 'triangle');
  }, []);

  const splash = useCallback(() => {
    if (!enabled.current) return;
    // Ethereal splash chord — C E G B spread over time
    ping(262, 0.8, 0.04, 'sine');
    setTimeout(() => ping(330, 0.7, 0.03, 'sine'), 200);
    setTimeout(() => ping(392, 0.6, 0.03, 'sine'), 400);
    setTimeout(() => ping(494, 0.5, 0.03, 'sine'), 600);
  }, []);

  return { hover, click, play, stop, save, toggle, open, close, del, splash, enabled };
}
