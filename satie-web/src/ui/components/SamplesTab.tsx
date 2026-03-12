import { useCallback, useState, useRef } from 'react';
import { RecordWidget } from './RecordWidget';

export interface SampleEntry {
  name: string;
  category: 'imported' | 'generated' | 'recorded';
}

interface SamplesTabProps {
  samples: SampleEntry[];
  onLoadBuffer: (name: string, data: ArrayBuffer, category?: SampleEntry['category']) => Promise<void>;
  onDelete?: (name: string) => void;
  onPreview?: (name: string) => void;
}

function CategorySection({
  title,
  items,
  onDelete,
  onPreview,
  collapsed,
  onToggle,
}: {
  title: string;
  items: SampleEntry[];
  onDelete?: (name: string) => void;
  onPreview?: (name: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 4 }}>
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          cursor: 'pointer',
          padding: '2px 0',
          userSelect: 'none',
        }}
      >
        <span style={{
          fontSize: '8px',
          opacity: 0.3,
          transition: 'transform 0.15s',
          transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          display: 'inline-block',
        }}>
          v
        </span>
        <span style={{
          fontSize: '9px',
          fontWeight: 600,
          opacity: 0.4,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          {title}
        </span>
        <span style={{ fontSize: '9px', opacity: 0.2 }}>{items.length}</span>
      </div>
      {!collapsed && items.map((s) => (
        <div
          key={s.name}
          style={{
            padding: '2px 0 2px 12px',
            fontSize: '11px',
            fontFamily: "'SF Mono', 'Consolas', monospace",
            opacity: 0.6,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span style={{ opacity: 0.3, fontSize: '9px' }}>
            {s.category === 'recorded' ? 'o' : s.category === 'generated' ? '*' : '\u266A'}
          </span>
          <span style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {s.name.replace('Audio/', '')}
          </span>
          {onPreview && (
            <button
              onClick={() => onPreview(s.name)}
              title="Preview"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '9px',
                opacity: 0.3,
                padding: '0 2px',
                color: '#1a3a2a',
                fontFamily: "'SF Mono', monospace",
              }}
            >
              &gt;
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(s.name)}
              title="Remove"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '9px',
                opacity: 0.3,
                padding: '0 2px',
                color: '#8b0000',
                fontFamily: "'SF Mono', monospace",
              }}
            >
              x
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function SamplesTab({ samples, onLoadBuffer, onDelete, onPreview }: SamplesTabProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const imported = samples.filter(s => s.category === 'imported');
  const generated = samples.filter(s => s.category === 'generated');
  const recorded = samples.filter(s => s.category === 'recorded');

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

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { handleDrop(e); setDragOver(false); }}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '0 0 4px',
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
          {isLoading ? '...' : '+ import'}
        </button>
        <span style={{ opacity: 0.2, fontSize: '10px' }}>
          {samples.length > 0 ? `${samples.length} total` : ''}
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

      {/* Record widget */}
      <RecordWidget onSave={(name, data) => onLoadBuffer(name, data, 'recorded')} />

      {/* Sample list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {samples.length === 0 && (
          <div style={{
            opacity: dragOver ? 0.4 : 0.15,
            fontSize: '10px',
            fontStyle: 'italic',
            padding: '8px 0',
            textAlign: 'center',
            transition: 'opacity 0.15s',
          }}>
            drop audio files here
          </div>
        )}
        <CategorySection
          title="imported"
          items={imported}
          onDelete={onDelete}
          onPreview={onPreview}
          collapsed={!!collapsedSections['imported']}
          onToggle={() => toggleSection('imported')}
        />
        <CategorySection
          title="generated"
          items={generated}
          onDelete={onDelete}
          onPreview={onPreview}
          collapsed={!!collapsedSections['generated']}
          onToggle={() => toggleSection('generated')}
        />
        <CategorySection
          title="recorded"
          items={recorded}
          onDelete={onDelete}
          onPreview={onPreview}
          collapsed={!!collapsedSections['recorded']}
          onToggle={() => toggleSection('recorded')}
        />
      </div>

      {/* Drop overlay */}
      {dragOver && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(26, 58, 42, 0.04)',
          border: '2px dashed rgba(26, 58, 42, 0.15)',
          borderRadius: 12,
          pointerEvents: 'none',
        }} />
      )}
    </div>
  );
}
