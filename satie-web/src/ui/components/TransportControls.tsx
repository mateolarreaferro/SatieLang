interface TransportControlsProps {
  isPlaying: boolean;
  currentTime: number;
  trackCount: number;
  onPlay: () => void;
  onStop: () => void;
  onMasterVolume: (vol: number) => void;
}

export function TransportControls({
  isPlaying,
  currentTime,
  trackCount,
  onPlay,
  onStop,
  onMasterVolume,
}: TransportControlsProps) {
  const formatTime = (t: number) => {
    const mins = Math.floor(t / 60);
    const secs = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '0 14px',
      height: '100%',
      fontFamily: "'SF Mono', 'Consolas', monospace",
      fontSize: '11px',
      color: '#1a3a2a',
    }}>
      <button
        onClick={isPlaying ? onStop : onPlay}
        style={{
          width: 22,
          height: 22,
          background: 'none',
          border: '1.5px solid #1a3a2a',
          borderRadius: isPlaying ? 4 : 11,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'border-radius 0.15s',
          flexShrink: 0,
        }}
      >
        {isPlaying ? (
          <svg width="8" height="8" viewBox="0 0 8 8">
            <rect x="1" y="1" width="6" height="6" rx="1" fill="#8b0000"/>
          </svg>
        ) : (
          <svg width="8" height="8" viewBox="0 0 8 8">
            <polygon points="2,0.5 7.5,4 2,7.5" fill="#1a3a2a"/>
          </svg>
        )}
      </button>

      <span style={{ letterSpacing: '0.5px', opacity: 0.7 }}>
        {formatTime(currentTime)}
      </span>

      <span style={{ opacity: 0.25, fontSize: '10px' }}>
        {trackCount}v
      </span>

      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        defaultValue={1}
        onChange={(e) => onMasterVolume(parseFloat(e.target.value))}
        style={{ width: 48, accentColor: '#000', opacity: 0.35, marginLeft: 'auto' }}
      />
    </div>
  );
}
