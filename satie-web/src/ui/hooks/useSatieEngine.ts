import { useRef, useState, useEffect, useCallback } from 'react';
import { SatieEngine, type EngineUIState, type TrackState } from '../../engine';

/**
 * Main hook for the Satie engine.
 *
 * Performance design:
 * - `uiState` updates at ~8fps (throttled) — use for time display, track count, errors
 * - `tracksRef` points to the engine's live tracks array — use in Three.js useFrame()
 * - Discrete events (play/stop/loadScript) trigger immediate UI updates
 */
export function useSatieEngine() {
  const engineRef = useRef<SatieEngine | null>(null);
  const tracksRef = useRef<TrackState[]>([]);

  const emptySet = useRef<ReadonlySet<number>>(new Set()).current;
  const [uiState, setUIState] = useState<EngineUIState>({
    isPlaying: false,
    currentTime: 0,
    trackCount: 0,
    statements: [],
    errors: null,
    mutedIndices: emptySet,
    soloedIndices: emptySet,
  });

  useEffect(() => {
    const engine = new SatieEngine();
    engineRef.current = engine;

    // Subscribe to throttled UI updates only
    const unsub = engine.subscribeUI((state) => {
      // Update tracks ref (no React re-render)
      tracksRef.current = engine.getTracksArray();
      setUIState(state);
    });

    return () => {
      unsub();
      engine.destroy();
    };
  }, []);

  const loadScript = useCallback((script: string) => {
    engineRef.current?.loadScript(script);
    if (engineRef.current) {
      tracksRef.current = engineRef.current.getTracksArray();
    }
  }, []);

  const play = useCallback(async () => {
    await engineRef.current?.play();
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    if (engineRef.current) {
      tracksRef.current = engineRef.current.getTracksArray();
    }
  }, []);

  const loadAudioFile = useCallback(async (name: string, url: string) => {
    await engineRef.current?.loadAudioFile(name, url);
  }, []);

  const loadAudioBuffer = useCallback(async (name: string, data: ArrayBuffer) => {
    await engineRef.current?.loadAudioBuffer(name, data);
  }, []);

  const setMasterVolume = useCallback((vol: number) => {
    engineRef.current?.setMasterVolume(vol);
  }, []);

  const toggleMute = useCallback((index: number) => {
    engineRef.current?.toggleMute(index);
  }, []);

  const toggleSolo = useCallback((index: number) => {
    engineRef.current?.toggleSolo(index);
  }, []);

  const setListenerPosition = useCallback((x: number, y: number, z: number) => {
    engineRef.current?.setListenerPosition(x, y, z);
  }, []);

  const setListenerOrientation = useCallback((fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => {
    engineRef.current?.setListenerOrientation(fx, fy, fz, ux, uy, uz);
  }, []);

  return {
    engine: engineRef,
    uiState,
    tracksRef,
    loadScript,
    play,
    stop,
    loadAudioFile,
    loadAudioBuffer,
    setMasterVolume,
    toggleMute,
    toggleSolo,
    setListenerPosition,
    setListenerOrientation,
  };
}
