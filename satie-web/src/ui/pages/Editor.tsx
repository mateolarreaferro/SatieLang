import { useState, useCallback, useEffect, useRef } from 'react';
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
import { useSFX } from '../hooks/useSFX';

const DEFAULT_SCRIPT = `# satie\n`;
const AUTOSAVE_DELAY = 2000;

export function Editor() {
  const { sketchId } = useParams<{ sketchId?: string }>();
  const { user } = useAuth();
  const {
    state,
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

  // Load sketch from DB if we have an ID
  useEffect(() => {
    if (!sketchId) return;
    getSketch(sketchId).then((sketch) => {
      if (sketch) {
        setScript(sketch.script);
        setSketchTitle(sketch.title);
        setCurrentSketchId(sketch.id);
      }
    }).catch(console.error);
  }, [sketchId]);

  // Autosave when script changes (only for logged-in users with a saved sketch)
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
    if (!state.isPlaying) play();
  }, [script, loadScript, state.isPlaying, play]);

  const handleLoadBuffer = useCallback(async (name: string, data: ArrayBuffer) => {
    await loadAudioBuffer(name, data);
    setLoadedFiles((prev) => [...new Set([...prev, name])]);
  }, [loadAudioBuffer]);

  const handleLoadFile = useCallback(async (name: string, url: string) => {
    await loadAudioFile(name, url);
    setLoadedFiles((prev) => [...new Set([...prev, name])]);
  }, [loadAudioFile]);

  const handleAIGenerate = useCallback((code: string) => {
    setScript(code);
  }, []);

  // Save current script as a new sketch (for guest → first save, or "Save As")
  const handleSave = useCallback(async () => {
    if (!user) return;
    if (currentSketchId) {
      await updateSketch(currentSketchId, { script, title: sketchTitle });
    } else {
      const sketch = await createSketch(user.id, sketchTitle, script);
      setCurrentSketchId(sketch.id);
      // Update URL without full reload
      window.history.replaceState(null, '', `/editor/${sketch.id}`);
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
        isPlaying={state.isPlaying}
        currentTime={state.currentTime}
        trackCount={state.tracks.length}
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
                  errors={state.errors}
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
            title="Space"
            defaultX={512}
            defaultY={16}
            defaultWidth={500}
            defaultHeight={400}
            minWidth={280}
            minHeight={200}
          >
            <SpatialViewport tracks={state.tracks} bgColor={spaceBgColor} onBgColorChange={setSpaceBgColor} />
          </Panel>
        )}

        {panels.voices && (
          <Panel
            title="Voices"
            defaultX={512}
            defaultY={432}
            defaultWidth={240}
            defaultHeight={124}
            minWidth={160}
            minHeight={72}
          >
            <div style={{
              padding: '4px 14px 8px',
              fontFamily: "'SF Mono', 'Consolas', monospace",
              fontSize: '11px',
              color: '#1a3a2a',
              overflow: 'auto',
              height: '100%',
            }}>
              {state.statements.length === 0 && (
                <span style={{ opacity: 0.25 }}>no statements</span>
              )}
              {state.statements.map((stmt, i) => (
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
                  {stmt.wanderType !== 'none' && (
                    <span style={{ opacity: 0.4 }}> [{stmt.wanderType}]</span>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        )}

        {panels.ai && (
          <Panel
            title="AI"
            defaultX={768}
            defaultY={432}
            defaultWidth={320}
            defaultHeight={300}
            minWidth={240}
            minHeight={160}
            borderColor="#2b2b8a"
          >
            <AIPanel onGenerate={handleAIGenerate} />
          </Panel>
        )}
      </div>
    </div>
  );
}
