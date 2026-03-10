import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext';
import { useSFX } from '../hooks/useSFX';

export interface PanelVisibility {
  score: boolean;
  samples: boolean;
  space: boolean;
  voices: boolean;
  ai: boolean;
}

interface SidebarProps {
  isPlaying: boolean;
  currentTime: number;
  trackCount: number;
  onPlay: () => void;
  onStop: () => void;
  onMasterVolume: (vol: number) => void;
  panels: PanelVisibility;
  onTogglePanel: (panel: keyof PanelVisibility) => void;
  sketchTitle?: string;
  onSketchTitleChange?: (title: string) => void;
  onSave?: () => void;
  canSave?: boolean;
  isSaved?: boolean;
}

export function Sidebar({
  isPlaying,
  currentTime,
  trackCount,
  onPlay,
  onStop,
  onMasterVolume,
  panels,
  onTogglePanel,
  sketchTitle,
  onSketchTitleChange,
  onSave,
  canSave,
  isSaved,
}: SidebarProps) {
  const { user, signInWithGitHub, signOut } = useAuth();
  const navigate = useNavigate();
  const sfx = useSFX();
  const [editingTitle, setEditingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) titleInputRef.current.focus();
  }, [editingTitle]);

  const formatTime = (t: number) => {
    const mins = Math.floor(t / 60);
    const secs = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{
      width: 52,
      height: '100vh',
      background: '#faf9f6',
      borderRight: '1.5px solid #1a3a2a',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '16px 0',
      gap: '6px',
      fontFamily: "'Inter', system-ui, sans-serif",
      flexShrink: 0,
      position: 'relative',
      zIndex: 100,
    }}>
      {/* Logo — click to go to dashboard */}
      <div
        onClick={() => navigate('/')}
        style={{
          fontSize: '13px',
          fontWeight: 700,
          color: '#1a3a2a',
          letterSpacing: '0.02em',
          marginBottom: '12px',
          writingMode: 'vertical-rl',
          textOrientation: 'mixed',
          transform: 'rotate(180deg)',
          cursor: 'pointer',
        }}
      >
        satie
      </div>

      {/* Sketch title — editable on double click */}
      {sketchTitle !== undefined && onSketchTitleChange && (
        editingTitle ? (
          <input
            ref={titleInputRef}
            value={sketchTitle}
            onChange={(e) => onSketchTitleChange(e.target.value)}
            onBlur={() => setEditingTitle(false)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditingTitle(false); }}
            style={{
              width: 36,
              fontSize: '8px',
              fontFamily: "'SF Mono', monospace",
              color: '#1a3a2a',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid #1a3a2a',
              outline: 'none',
              textAlign: 'center',
              padding: '0 0 2px',
              marginBottom: '8px',
            }}
          />
        ) : (
          <div
            onDoubleClick={() => setEditingTitle(true)}
            title="Double-click to rename"
            style={{
              fontSize: '8px',
              fontFamily: "'SF Mono', monospace",
              color: '#1a3a2a',
              opacity: 0.35,
              writingMode: 'vertical-rl',
              textOrientation: 'mixed',
              transform: 'rotate(180deg)',
              maxHeight: 80,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              cursor: 'text',
              marginBottom: '8px',
            }}
          >
            {sketchTitle || 'Untitled'}
          </div>
        )
      )}

      {/* Play/Stop */}
      <button
        className="sidebar-btn"
        onClick={() => { isPlaying ? (sfx.stop(), onStop()) : (sfx.play(), onPlay()); }}
        onMouseEnter={sfx.hover}
        title={isPlaying ? 'Stop' : 'Play'}
        style={{
          width: 30,
          height: 30,
          background: 'none',
          border: '1.5px solid ' + (isPlaying ? '#8b0000' : '#1a3a2a'),
          borderRadius: isPlaying ? 6 : 15,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.15s',
        }}
      >
        {isPlaying ? (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="#8b0000"/>
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <polygon points="2.5,1 8.5,5 2.5,9" fill="#1a3a2a"/>
          </svg>
        )}
      </button>

      {/* Time */}
      <div style={{
        fontSize: '8px',
        color: '#1a3a2a',
        opacity: 0.4,
        fontFamily: "'SF Mono', monospace",
        letterSpacing: '0.3px',
      }}>
        {formatTime(currentTime)}
      </div>

      {/* Voices */}
      <div style={{
        fontSize: '8px',
        color: '#1a3a2a',
        opacity: 0.2,
      }}>
        {trackCount}v
      </div>

      {/* Volume */}
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        defaultValue={1}
        onChange={(e) => onMasterVolume(parseFloat(e.target.value))}
        title="Master volume"
        style={{
          width: 32,
          accentColor: '#000',
          opacity: 0.3,
          writingMode: 'vertical-lr',
          direction: 'rtl',
          marginTop: '4px',
        }}
      />

      {/* Save button */}
      {canSave && onSave && (
        <button
          className="sidebar-btn"
          onClick={() => { sfx.save(); onSave(); }}
          onMouseEnter={sfx.hover}
          title={isSaved ? 'Saved' : 'Save sketch'}
          style={{
            width: 28,
            height: 20,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            opacity: isSaved ? 0.2 : 0.5,
            padding: 0,
            marginTop: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'opacity 0.15s',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#1a3a2a" strokeWidth="1.2">
            <path d="M2.5 1.5h7l2.5 2.5v8h-10v-10.5z" strokeLinejoin="round"/>
            <path d="M4.5 1.5v3h5v-3" strokeLinejoin="round"/>
            <rect x="4" y="8" width="6" height="3.5" rx="0.5"/>
          </svg>
        </button>
      )}

      {/* Panel toggles */}
      <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
        {(['score', 'samples', 'space', 'voices', 'ai'] as const).map((key) => {
          const icon = {
            score: (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M4 3 L1 7 L4 11" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M10 3 L13 7 L10 11" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ),
            samples: (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M3 1.5 L3 12.5 L11.5 12.5 L11.5 4.5 L8.5 1.5 Z" strokeLinejoin="round"/>
                <path d="M8.5 1.5 L8.5 4.5 L11.5 4.5" strokeLinejoin="round"/>
              </svg>
            ),
            space: (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M7 1 L13 4.5 L13 9.5 L7 13 L1 9.5 L1 4.5 Z" strokeLinejoin="round"/>
                <path d="M7 1 L7 13" />
                <path d="M1 4.5 L13 9.5" />
                <path d="M13 4.5 L1 9.5" />
              </svg>
            ),
            voices: (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                <line x1="2" y1="3.5" x2="12" y2="3.5" strokeLinecap="round"/>
                <line x1="2" y1="7" x2="12" y2="7" strokeLinecap="round"/>
                <line x1="2" y1="10.5" x2="12" y2="10.5" strokeLinecap="round"/>
              </svg>
            ),
            ai: (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                <path d="M7 1.5 C7 1.5 3 1.5 3 5 C3 7 4.5 7.5 4.5 9.5 L9.5 9.5 C9.5 7.5 11 7 11 5 C11 1.5 7 1.5 7 1.5 Z" strokeLinejoin="round"/>
                <line x1="5" y1="9.5" x2="5" y2="11.5" strokeLinecap="round"/>
                <line x1="9" y1="9.5" x2="9" y2="11.5" strokeLinecap="round"/>
                <path d="M5 11.5 Q7 13 9 11.5" strokeLinecap="round"/>
              </svg>
            ),
          }[key];
          return (
          <button
            key={key}
            className="sidebar-btn"
            onClick={() => { sfx.toggle(); onTogglePanel(key); }}
            onMouseEnter={sfx.hover}
            title={`${panels[key] ? 'Hide' : 'Show'} ${key}`}
            style={{
              width: 28,
              height: 22,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#1a3a2a',
              opacity: panels[key] ? 0.6 : 0.15,
              padding: 0,
              transition: 'opacity 0.15s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {icon}
          </button>
          );
        })}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* User avatar / sign in */}
      {user ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
          <button
            className="avatar-btn"
            onClick={() => { sfx.click(); navigate('/'); }}
            onMouseEnter={sfx.hover}
            title={`${user.email ?? user.user_metadata?.user_name}\nClick for dashboard`}
            style={{
              width: 28,
              height: 28,
              background: '#1a3a2a',
              border: 'none',
              borderRadius: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              color: '#faf9f6',
              fontWeight: 600,
              fontFamily: "'Inter', system-ui, sans-serif",
            }}
          >
            {(user.email?.[0] ?? user.user_metadata?.user_name?.[0] ?? '?').toUpperCase()}
          </button>
          <button
            onClick={() => { sfx.close(); signOut(); }}
            title="Sign out"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '7px',
              fontFamily: "'SF Mono', monospace",
              color: '#1a3a2a',
              opacity: 0.25,
              padding: 0,
            }}
          >
            out
          </button>
        </div>
      ) : (
        <button
          className="sidebar-btn"
          onClick={() => { sfx.click(); signInWithGitHub(); }}
          onMouseEnter={sfx.hover}
          title="Sign in with GitHub"
          style={{
            width: 28,
            height: 28,
            background: 'none',
            border: '1px solid #d0cdc4',
            borderRadius: 14,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '10px',
            color: '#1a3a2a',
            opacity: 0.4,
            marginBottom: '4px',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#1a3a2a" strokeWidth="1.2">
            <circle cx="7" cy="5" r="3"/>
            <path d="M2 13c0-2.8 2.2-5 5-5s5 2.2 5 5" strokeLinecap="round"/>
          </svg>
        </button>
      )}
    </div>
  );
}
