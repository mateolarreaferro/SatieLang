import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { getUserSketches, createSketch, deleteSketch, updateSketch } from '../../lib/sketches';
import { loadSettings, saveKey as saveSettingsKey } from '../../lib/userSettings';
import type { Sketch } from '../../lib/supabase';
import { SplashScreen } from '../components/SplashScreen';
import { useSFX } from '../hooks/useSFX';

interface ApiKeys {
  anthropic_key: string;
  elevenlabs_key: string;
  openai_key: string;
}

// Draggable sketch card
function SketchCard({
  sketch,
  defaultX,
  defaultY,
  onOpen,
  onDelete,
  onRename,
  sfx,
}: {
  sketch: Sketch;
  defaultX: number;
  defaultY: number;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  sfx: ReturnType<typeof useSFX>;
}) {
  const [pos, setPos] = useState({ x: defaultX, y: defaultY });
  const [isDragging, setIsDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(sketch.title);
  const dragOffset = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      hasMoved.current = true;
      setPos({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const onDragStart = (e: React.MouseEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'BUTTON') return;
    setIsDragging(true);
    hasMoved.current = false;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  };

  const handleClick = (e: React.MouseEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (hasMoved.current || tag === 'BUTTON' || tag === 'INPUT') return;
    sfx.open();
    onOpen();
  };

  const commitRename = () => {
    setEditing(false);
    const trimmed = title.trim() || 'Untitled';
    setTitle(trimmed);
    if (trimmed !== sketch.title) onRename(trimmed);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div
      className="sketch-card"
      onMouseDown={onDragStart}
      onMouseUp={handleClick}
      onMouseEnter={sfx.hover}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: 280,
        background: '#faf9f6',
        border: '1.5px solid #d0cdc4',
        borderRadius: 20,
        padding: '16px',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        boxShadow: isDragging
          ? '0 8px 32px rgba(0,0,0,0.12)'
          : '0 2px 16px rgba(0,0,0,0.04)',
        transition: isDragging ? 'none' : 'box-shadow 0.2s, border-color 0.2s, transform 0.2s',
        zIndex: isDragging ? 100 : 1,
      }}
    >
      {/* Title — double click to edit */}
      {editing ? (
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setTitle(sketch.title); setEditing(false); } }}
          style={{
            fontSize: '14px',
            fontWeight: 600,
            color: '#0a0a0a',
            fontFamily: "'Inter', system-ui, sans-serif",
            border: 'none',
            borderBottom: '1.5px solid #0a0a0a',
            background: 'transparent',
            outline: 'none',
            width: '100%',
            padding: '0 0 2px',
            marginBottom: '8px',
          }}
        />
      ) : (
        <div
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
          style={{
            fontSize: '14px',
            fontWeight: 600,
            marginBottom: '8px',
            color: '#0a0a0a',
          }}
        >
          {title}
        </div>
      )}

      {/* Preview */}
      <pre style={{
        fontSize: '10px',
        fontFamily: "'SF Mono', 'Consolas', monospace",
        opacity: 0.4,
        whiteSpace: 'pre-wrap',
        overflow: 'hidden',
        maxHeight: 60,
        margin: '0 0 12px',
        color: '#0a0a0a',
      }}>
        {sketch.script.slice(0, 120)}
        {sketch.script.length > 120 ? '...' : ''}
      </pre>

      {/* Meta */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '10px',
        opacity: 0.35,
        color: '#0a0a0a',
      }}>
        <span>{formatDate(sketch.updated_at)}</span>
        {sketch.is_public && (
          <span style={{
            background: '#0a0a0a',
            color: '#faf9f6',
            padding: '1px 6px',
            borderRadius: 4,
            fontSize: '9px',
          }}>
            public
          </span>
        )}
        <button
          className="delete-btn"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); sfx.del(); onDelete(); }}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '10px',
            color: '#8b0000',
            opacity: 0.6,
            marginLeft: 'auto',
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          delete
        </button>
      </div>
    </div>
  );
}

// Position sketches in a clean grid
function layoutPosition(index: number, total: number) {
  const cols = Math.ceil(Math.sqrt(total));
  const col = index % cols;
  const row = Math.floor(index / cols);
  const baseX = 80 + col * 320;
  const baseY = 90 + row * 220;
  const jitterX = ((index * 37) % 40) - 20;
  const jitterY = ((index * 53) % 30) - 15;
  return { x: baseX + jitterX, y: baseY + jitterY };
}

export function Dashboard() {
  const { user, signInWithGitHub, signInWithGoogle, signOut, loading } = useAuth();
  const navigate = useNavigate();
  const sfx = useSFX();
  const [sketches, setSketches] = useState<Sketch[]>([]);
  const [loadingSketches, setLoadingSketches] = useState(false);
  const [showSplash, setShowSplash] = useState(() => {
    if (sessionStorage.getItem('satie-splash-seen')) return false;
    return true;
  });
  const [showSettings, setShowSettings] = useState(false);
  const [keys, setKeys] = useState<ApiKeys>({ anthropic_key: '', elevenlabs_key: '', openai_key: '' });

  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
    sessionStorage.setItem('satie-splash-seen', '1');
  }, []);

  // Load API keys
  useEffect(() => {
    loadSettings(user?.id ?? null).then(setKeys).catch(console.error);
  }, [user?.id]);

  const handleSaveKey = useCallback((field: keyof ApiKeys, value: string) => {
    setKeys(prev => ({ ...prev, [field]: value }));
    saveSettingsKey(user?.id ?? null, field, value);
  }, [user?.id]);

  const fetchSketches = useCallback(async () => {
    if (!user) return;
    setLoadingSketches(true);
    try {
      const data = await getUserSketches(user.id);
      setSketches(data);
    } catch (err) {
      console.error('Failed to load sketches:', err);
    } finally {
      setLoadingSketches(false);
    }
  }, [user]);

  useEffect(() => {
    fetchSketches();
  }, [fetchSketches]);

  const handleNew = useCallback(async () => {
    if (!user) {
      navigate('/editor');
      return;
    }
    try {
      const sketch = await createSketch(user.id, 'Untitled', '# satie\n');
      navigate(`/editor/${sketch.id}`);
    } catch (err) {
      console.error('Failed to create sketch:', err);
    }
  }, [user, navigate]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteSketch(id);
      setSketches(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      console.error('Failed to delete sketch:', err);
    }
  }, []);

  const handleRename = useCallback(async (id: string, title: string) => {
    try {
      await updateSketch(id, { title });
      setSketches(prev => prev.map(s => s.id === id ? { ...s, title } : s));
    } catch (err) {
      console.error('Failed to rename sketch:', err);
    }
  }, []);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingText}>loading...</div>
      </div>
    );
  }

  const userName = user?.user_metadata?.user_name || user?.email?.split('@')[0] || '';

  return (
    <>
      {showSplash && <SplashScreen onComplete={handleSplashComplete} />}

      <div style={styles.container}>
        {/* Header */}
        <header style={styles.header}>
          <div style={styles.logo}>satie</div>

          <div style={styles.headerRight}>
            {user ? (
              <>
                {/* Settings button */}
                <button
                  onClick={() => { sfx.toggle(); setShowSettings(!showSettings); }}
                  title="Settings"
                  style={{
                    ...styles.iconBtn,
                    opacity: showSettings ? 0.8 : 0.35,
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="#0a0a0a" strokeWidth="1.3">
                    <circle cx="5.5" cy="5.5" r="3"/>
                    <line x1="8" y1="8" x2="14" y2="14" strokeLinecap="round"/>
                    <line x1="11" y1="11.5" x2="13" y2="11.5" strokeLinecap="round"/>
                    <line x1="12" y1="10" x2="14" y2="10" strokeLinecap="round"/>
                  </svg>
                </button>

                {/* User initial */}
                <div style={styles.avatar} title={user.email ?? userName}>
                  {(userName[0] ?? '?').toUpperCase()}
                </div>

                <button className="link-btn" onClick={() => { sfx.close(); signOut(); }} style={styles.linkBtn}>
                  sign out
                </button>
              </>
            ) : (
              <>
                <button className="auth-btn" onClick={() => { sfx.click(); signInWithGitHub(); }} onMouseEnter={sfx.hover} style={styles.authBtn}>
                  Sign in with GitHub
                </button>
                <button className="auth-btn" onClick={() => { sfx.click(); signInWithGoogle(); }} onMouseEnter={sfx.hover} style={styles.authBtn}>
                  Sign in with Google
                </button>
              </>
            )}
          </div>
        </header>

        {/* Settings panel (slides down) */}
        {showSettings && (
          <div style={styles.settingsPanel}>
            <div style={styles.settingsInner}>
              <div style={styles.settingsSection}>
                <div style={styles.settingsLabel}>Anthropic API Key</div>
                <input
                  type="password"
                  placeholder="sk-ant-..."
                  value={keys.anthropic_key}
                  onChange={(e) => handleSaveKey('anthropic_key', e.target.value)}
                  style={styles.settingsInput}
                />
              </div>
              <div style={styles.settingsSection}>
                <div style={styles.settingsLabel}>OpenAI API Key</div>
                <input
                  type="password"
                  placeholder="sk-..."
                  value={keys.openai_key}
                  onChange={(e) => handleSaveKey('openai_key', e.target.value)}
                  style={styles.settingsInput}
                />
              </div>
              <div style={styles.settingsSection}>
                <div style={styles.settingsLabel}>ElevenLabs API Key</div>
                <input
                  type="password"
                  placeholder="sk_..."
                  value={keys.elevenlabs_key}
                  onChange={(e) => handleSaveKey('elevenlabs_key', e.target.value)}
                  style={styles.settingsInput}
                />
              </div>
              <div style={{ fontSize: '10px', opacity: 0.25, marginTop: '4px' }}>
                {user ? 'synced to account' : 'stored locally'}
              </div>
            </div>
          </div>
        )}

        {/* Canvas area — sketches float freely */}
        <div style={styles.canvas}>
          {/* New sketch button — top left of canvas */}
          {user && (
            <button
              className="new-btn"
              onClick={() => { sfx.click(); handleNew(); }}
              onMouseEnter={sfx.hover}
              style={styles.newBtn}
            >
              + New Sketch
            </button>
          )}

          {!user && (
            <div style={styles.welcome}>
              <div style={styles.welcomeTitle}>Welcome to Satie</div>
              <p style={styles.welcomeSubtitle}>
                Sign in to save and revisit your compositions, or start a new sketch as a guest.
              </p>
              <button className="welcome-btn" onClick={() => { sfx.click(); handleNew(); }} onMouseEnter={sfx.hover} style={styles.welcomeBtn}>
                Open Editor
              </button>
            </div>
          )}

          {user && loadingSketches && (
            <div style={styles.loadingText}>loading sketches...</div>
          )}

          {user && !loadingSketches && sketches.length === 0 && (
            <div style={styles.welcome}>
              <div style={styles.welcomeTitle}>No sketches yet</div>
              <p style={styles.welcomeSubtitle}>Create your first composition.</p>
            </div>
          )}

          {user && sketches.map((sketch, i) => {
            const { x, y } = layoutPosition(i, sketches.length);
            return (
              <SketchCard
                key={sketch.id}
                sketch={sketch}
                defaultX={x}
                defaultY={y}
                onOpen={() => navigate(`/editor/${sketch.id}`)}
                onDelete={() => handleDelete(sketch.id)}
                onRename={(title) => handleRename(sketch.id, title)}
                sfx={sfx}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100vw',
    height: '100vh',
    background: '#f4f3ee',
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    color: '#0a0a0a',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 32px',
    borderBottom: '1px solid #d0cdc4',
    flexShrink: 0,
  },
  logo: {
    fontSize: '16px',
    fontWeight: 700,
    letterSpacing: '0.04em',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
  },
  avatar: {
    width: 26,
    height: 26,
    background: '#0a0a0a',
    borderRadius: 13,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    color: '#faf9f6',
    fontWeight: 600,
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'opacity 0.15s',
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '11px',
    color: '#0a0a0a',
    opacity: 0.3,
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  authBtn: {
    padding: '6px 16px',
    background: 'none',
    border: '1.5px solid #0a0a0a',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#0a0a0a',
    fontWeight: 500,
  },
  settingsPanel: {
    borderBottom: '1px solid #d0cdc4',
    background: '#f4f3ee',
    flexShrink: 0,
  },
  settingsInner: {
    display: 'flex',
    alignItems: 'center',
    gap: '24px',
    padding: '14px 32px',
  },
  settingsSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  settingsLabel: {
    fontSize: '10px',
    opacity: 0.4,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap' as const,
  },
  settingsInput: {
    width: 180,
    padding: '5px 10px',
    border: '1px solid #d0cdc4',
    borderRadius: 6,
    fontSize: '11px',
    fontFamily: "'SF Mono', monospace",
    background: 'transparent',
    outline: 'none',
    color: '#0a0a0a',
  },
  newBtn: {
    position: 'absolute' as const,
    top: 28,
    left: 32,
    padding: '7px 18px',
    background: '#0a0a0a',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#faf9f6',
    fontWeight: 500,
    zIndex: 10,
  },
  canvas: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  welcome: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    textAlign: 'center' as const,
  },
  welcomeTitle: {
    fontSize: '18px',
    fontWeight: 600,
    marginBottom: '8px',
  },
  welcomeSubtitle: {
    fontSize: '13px',
    opacity: 0.5,
    marginBottom: '20px',
  },
  welcomeBtn: {
    padding: '8px 24px',
    background: '#0a0a0a',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: "'Inter', system-ui, sans-serif",
    color: '#faf9f6',
    fontWeight: 500,
  },
  loadingText: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: '12px',
    opacity: 0.4,
  },
};
