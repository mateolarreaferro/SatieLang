import { useCallback, useState, useRef } from 'react';

interface AudioLoaderProps {
  loadedFiles: string[];
  onLoadFile: (name: string, url: string) => Promise<void>;
  onLoadBuffer: (name: string, data: ArrayBuffer) => Promise<void>;
}

export function AudioLoader({ loadedFiles, onLoadFile, onLoadBuffer }: AudioLoaderProps) {
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList) => {
    setIsLoading(true);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.name.match(/\.(wav|mp3|ogg|flac|m4a|webm)$/i)) continue;
      const arrayBuffer = await file.arrayBuffer();
      const nameWithoutExt = file.name.replace(/\.[^.]+$/, '');
      const clipName = `Audio/${nameWithoutExt}`;
      await onLoadBuffer(clipName, arrayBuffer);
    }
    setIsLoading(false);
  }, [onLoadBuffer]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { handleDrop(e); setDragOver(false); }}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: '11px',
        color: '#1a3a2a',
      }}
    >
      {/* Header with add button */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '0 14px 6px',
        flexShrink: 0,
      }}>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={isLoading}
          style={{
            padding: '2px 8px',
            background: 'none',
            color: '#1a3a2a',
            border: '1px solid #d0cdc4',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: '10px',
            fontFamily: 'inherit',
          }}
        >
          {isLoading ? '...' : '+ add'}
        </button>
        <span style={{ opacity: 0.2, fontSize: '10px' }}>
          {loadedFiles.length > 0 ? `${loadedFiles.length} loaded` : ''}
        </span>
        <input
          ref={inputRef}
          type="file"
          accept=".wav,.mp3,.ogg,.flac,.m4a,.webm"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {/* Scrollable file list */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '0 14px 8px',
      }}>
        {loadedFiles.length === 0 && (
          <div style={{
            opacity: dragOver ? 0.4 : 0.15,
            fontSize: '10px',
            fontStyle: 'italic',
            padding: '12px 0',
            textAlign: 'center',
            transition: 'opacity 0.15s',
          }}>
            drop audio files or folders here
          </div>
        )}
        {loadedFiles.map((name) => (
          <div
            key={name}
            style={{
              padding: '3px 0',
              fontSize: '11px',
              fontFamily: "'SF Mono', 'Consolas', monospace",
              opacity: 0.6,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span style={{ opacity: 0.3, fontSize: '9px' }}>♪</span>
            {name.replace('Audio/', '')}
          </div>
        ))}
      </div>

      {/* Drop overlay */}
      {dragOver && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(26, 58, 42, 0.04)',
          border: '2px dashed rgba(26, 58, 42, 0.15)',
          borderRadius: 18,
          pointerEvents: 'none',
        }} />
      )}
    </div>
  );
}
