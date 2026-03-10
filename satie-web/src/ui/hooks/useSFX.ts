import { useRef, useCallback } from 'react';

// Minimal UI sounds — only on key actions. Most interactions are silent.

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  if (sharedCtx.state === 'suspended') sharedCtx.resume();
  return sharedCtx;
}

/** Low, soft noise thud */
function thud(volume = 0.04) {
  const ctx = getCtx();
  const len = Math.ceil(ctx.sampleRate * 0.04);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 600;
  filter.Q.value = 0.3;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start();
  source.stop(ctx.currentTime + 0.04);
}

/** Softer, slightly brighter tap */
function tap(volume = 0.03) {
  const ctx = getCtx();
  const len = Math.ceil(ctx.sampleRate * 0.025);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1200;
  filter.Q.value = 0.5;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.025);

  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start();
  source.stop(ctx.currentTime + 0.025);
}

export function useSFX() {
  const enabled = useRef(true);

  // Silent — most interactions don't need sound
  const hover = useCallback(() => {}, []);
  const click = useCallback(() => {}, []);
  const save = useCallback(() => {}, []);
  const toggle = useCallback(() => {
    if (!enabled.current) return;
    tap(0.03);
  }, []);
  const open = useCallback(() => {}, []);
  const close = useCallback(() => {}, []);

  // Only play/stop/delete get sound — the key moments
  const play = useCallback(() => {
    if (!enabled.current) return;
    tap(0.04);
  }, []);

  const stop = useCallback(() => {
    if (!enabled.current) return;
    thud(0.035);
  }, []);

  const del = useCallback(() => {
    if (!enabled.current) return;
    thud(0.05);
  }, []);

  const splash = useCallback(() => {}, []);

  return { hover, click, play, stop, save, toggle, open, close, del, splash, enabled };
}
