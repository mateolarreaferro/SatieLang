import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { useParams } from 'react-router-dom';
import { useSatieEngine } from '../hooks/useSatieEngine';
import { SatieEditor } from '../components/SatieEditor';
import { SpatialViewport } from '../components/SpatialViewport';
import { AudioLoader } from '../components/AudioLoader';
import { AIPanel } from '../components/AIPanel';
import { Sidebar, type PanelVisibility } from '../components/Sidebar';
import { Panel } from '../components/Panel';
import { useAuth } from '../../lib/AuthContext';
import { getSketch, updateSketch, createSketch } from '../../lib/sketches';
import { uploadSketchSamples, loadSketchSamples } from '../../lib/sampleStorage';
import { cacheSample } from '../../lib/sampleCache';
import { useSFX } from '../hooks/useSFX';
import type { Statement } from '../../engine/core/Statement';
import { WanderType } from '../../engine/core/Statement';

const DEFAULT_SCRIPT = `# satie\n`;
const AUTOSAVE_DELAY = 2000;

/** Memoized voices panel — only re-renders when statements identity changes */
const VoicesPanel = memo(function VoicesPanel({ statements }: { statements: Statement[] }) {
  return (
    <div style={{
      padding: '4px 14px 8px',
      fontFamily: "'SF Mono', 'Consolas', monospace",
      fontSize: '11px',
      color: '#1a3a2a',
      overflow: 'auto',
      height: '100%',
    }}>
      {statements.length === 0 && (
        <span style={{ opacity: 0.25 }}>no statements</span>
      )}
      {statements.map((stmt, i) => (
        <div key={i} style={{
          padding: '1px 0',
          opacity: stmt.mute ? 0.25 : 0.7,
        }}>
          <span style={{ fontWeight: 600 }}>{stmt.kind}</span>{' '}
          <span>{stmt.clip.split('/').pop()}</span>
          {!stmt.every.isNull && (
            <span style={{ opacity: 0.4 }}> e:{stmt.every.toString()}</span>
          )}
          {stmt.reverbParams && <span style={{ color: '#8b0000' }}> rv</span>}
          {stmt.delayParams && <span style={{ color: '#8b0000' }}> dl</span>}
          {stmt.filterParams && <span style={{ color: '#8b0000' }}> fl</span>}
          {stmt.wanderType !== WanderType.None && (
            <span style={{ opacity: 0.4 }}> [{stmt.wanderType}]</span>
          )}
        </div>
      ))}
    </div>
  );
});

export function Editor() {
  const { sketchId } = useParams<{ sketchId?: string }>();
  const { user } = useAuth();
  const {
    uiState,
    tracksRef,
    loadScript,
    play,
    stop,
    loadAudioBuffer,
    loadAudioFile,
    setMasterVolume,
  } = useSatieEngine();

  const sfx = useSFX();
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [sketchTitle, setSketchTitle] = useState('Untitled');
  const [currentSketchId, setCurrentSketchId] = useState<string | undefined>(sketchId);
  const [loadedFiles, setLoadedFiles] = useState<string[]>([]);
  const [spaceBgColor, setSpaceBgColor] = useState('#f4f3ee');
  const [panels, setPanels] = useState<PanelVisibility>({
    score: true,
    samples: true,
    space: true,
    voices: true,
    ai: true,
  });

  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Raw ArrayBuffers for samples loaded this session — used for uploading on save. */
  const sampleBuffers = useRef<Map<string, ArrayBuffer>>(new Map());

  // Load sketch from DB if we have an ID, then load its samples
  useEffect(() => {
    if (!sketchId) return;
    getSketch(sketchId).then(async (sketch) => {
      if (sketch) {
        setScript(sketch.script);
        setSketchTitle(sketch.title);
        setCurrentSketchId(sketch.id);

        // Load samples from Supabase Storage (with IndexedDB cache)
        try {
          const loaded = await loadSketchSamples(sketch.id, async (name, data) => {
            await loadAudioBuffer(name, data);
            sampleBuffers.current.set(name, data);
          });
          if (loaded.length > 0) {
            setLoadedFiles(prev => [...new Set([...prev, ...loaded])]);
          }
        } catch (e) {
          console.error('[Editor] Failed to load sketch samples:', e);
        }
      }
    }).catch(console.error);
  }, [sketchId, loadAudioBuffer]);

  // Autosave
  useEffect(() => {
    if (!user || !currentSketchId) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      updateSketch(currentSketchId, { script }).catch(console.error);
    }, AUTOSAVE_DELAY);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [script, user, currentSketchId]);

  const togglePanel = useCallback((key: keyof PanelVisibility) => {
    setPanels(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleRun = useCallback(() => {
    loadScript(script);
    if (!uiState.isPlaying) play();
  }, [script, loadScript, uiState.isPlaying, play]);

  const handleLoadBuffer = useCallback(async (name: string, data: ArrayBuffer) => {
    await loadAudioBuffer(name, data);
    sampleBuffers.current.set(name, data);
    // Cache locally in IndexedDB for fast reload
    cacheSample(name, data).catch(() => {});
    setLoadedFiles((prev) => [...new Set([...prev, name])]);
  }, [loadAudioBuffer]);

  const handleLoadFile = useCallback(async (name: string, url: string) => {
    await loadAudioFile(name, url);
    setLoadedFiles((prev) => [...new Set([...prev, name])]);
  }, [loadAudioFile]);

  const handleAIGenerate = useCallback((code: string) => {
    setScript(code);
    // Auto-run: load the new script and play immediately
    loadScript(code);
    if (!uiState.isPlaying) play();
  }, [loadScript, uiState.isPlaying, play]);

  const handleSave = useCallback(async () => {
    if (!user) return;
    let sketchIdForSamples = currentSketchId;

    if (currentSketchId) {
      await updateSketch(currentSketchId, { script, title: sketchTitle });
    } else {
      const sketch = await createSketch(user.id, sketchTitle, script);
      setCurrentSketchId(sketch.id);
      sketchIdForSamples = sketch.id;
      window.history.replaceState(null, '', `/editor/${sketch.id}`);
    }

    // Upload any locally-loaded samples to Supabase Storage
    if (sketchIdForSamples && sampleBuffers.current.size > 0) {
      try {
        await uploadSketchSamples(user.id, sketchIdForSamples, sampleBuffers.current);
      } catch (e) {
        console.error('[Editor] Failed to upload samples:', e);
      }
    }
  }, [user, currentSketchId, script, sketchTitle]);

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: '#f4f3ee',
      overflow: 'hidden',
      display: 'flex',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    }}>
      <Sidebar
        isPlaying={uiState.isPlaying}
        currentTime={uiState.currentTime}
        trackCount={uiState.trackCount}
        onPlay={play}
        onStop={stop}
        onMasterVolume={setMasterVolume}
        panels={panels}
        onTogglePanel={togglePanel}
        sketchTitle={sketchTitle}
        onSketchTitleChange={setSketchTitle}
        onSave={user ? handleSave : undefined}
        canSave={!!user}
        isSaved={!!currentSketchId}
      />

      <div style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {panels.score && (
          <Panel
            panelId="score"
            title="Score"
            defaultX={16}
            defaultY={16}
            defaultWidth={480}
            defaultHeight={540}
            minWidth={280}
            minHeight={200}
          >
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <SatieEditor
                  value={script}
                  onChange={setScript}
                  onRun={handleRun}
                  errors={uiState.errors}
                />
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 12px',
                borderTop: '1px solid #e8e0d8',
                gap: '8px',
              }}>
                <button
                  className="run-btn"
                  onClick={() => { sfx.play(); handleRun(); }}
                  onMouseEnter={sfx.hover}
                  style={{
                    padding: '3px 12px',
                    background: 'none',
                    border: '1.5px solid #1a3a2a',
                    borderRadius: 8,
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontFamily: "'Inter', system-ui, sans-serif",
                    color: '#1a3a2a',
                    fontWeight: 500,
                  }}
                >
                  Run
                </button>
                <span style={{
                  fontSize: '9px',
                  opacity: 0.2,
                  fontFamily: "'SF Mono', monospace",
                }}>
                  Cmd+Enter
                </span>
              </div>
            </div>
          </Panel>
        )}

        {panels.samples && (
          <Panel
            panelId="samples"
            title="Samples"
            defaultX={16}
            defaultY={572}
            defaultWidth={480}
            defaultHeight={180}
            minWidth={200}
            minHeight={100}
          >
            <AudioLoader
              loadedFiles={loadedFiles}
              onLoadFile={handleLoadFile}
              onLoadBuffer={handleLoadBuffer}
            />
          </Panel>
        )}

        {panels.space && (
          <Panel
            panelId="space"
            title="Space"
            defaultX={512}
            defaultY={16}
            defaultWidth={500}
            defaultHeight={400}
            minWidth={280}
            minHeight={200}
          >
            <SpatialViewport tracksRef={tracksRef} bgColor={spaceBgColor} onBgColorChange={setSpaceBgColor} />
          </Panel>
        )}

        {panels.voices && (
          <Panel
            panelId="voices"
            title="Voices"
            defaultX={512}
            defaultY={432}
            defaultWidth={240}
            defaultHeight={124}
            minWidth={160}
            minHeight={72}
          >
            <VoicesPanel statements={uiState.statements} />
          </Panel>
        )}

        {panels.ai && (
          <Panel
            panelId="ai"
            title="AI"
            defaultX={768}
            defaultY={432}
            defaultWidth={320}
            defaultHeight={300}
            minWidth={240}
            minHeight={160}
            borderColor="#2b2b8a"
          >
            <AIPanel onGenerate={handleAIGenerate} currentScript={script} loadedSamples={loadedFiles} />
          </Panel>
        )}
      </div>
    </div>
  );
}
