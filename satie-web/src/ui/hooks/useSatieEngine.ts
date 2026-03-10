import { useRef, useState, useEffect, useCallback } from 'react';
import { SatieEngine, EngineState } from '../../engine';

export function useSatieEngine() {
  const engineRef = useRef<SatieEngine | null>(null);
  const [state, setState] = useState<EngineState>({
    isPlaying: false,
    currentTime: 0,
    tracks: [],
    statements: [],
    errors: null,
  });

  useEffect(() => {
    const engine = new SatieEngine();
    engineRef.current = engine;
    const unsub = engine.subscribe(setState);
    return () => {
      unsub();
      engine.destroy();
    };
  }, []);

  const loadScript = useCallback((script: string) => {
    engineRef.current?.loadScript(script);
  }, []);

  const play = useCallback(async () => {
    await engineRef.current?.play();
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
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

  return {
    engine: engineRef,
    state,
    loadScript,
    play,
    stop,
    loadAudioFile,
    loadAudioBuffer,
    setMasterVolume,
  };
}
