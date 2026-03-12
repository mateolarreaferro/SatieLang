import { useState, useCallback, useEffect } from 'react';
import { TrajectoryPreview } from './TrajectoryPreview';
import {
  listTrajectoryNames,
  isBuiltinTrajectory,
  unregisterTrajectory,
  registerTrajectoryFromLUT,
} from '../../engine/spatial/Trajectories';
import {
  listCachedTrajectories,
  removeCachedTrajectory,
  type StoredTrajectory,
} from '../../lib/trajectoryCache';

export interface TrajectoryEntry {
  name: string;
  source: 'builtin' | 'generated' | 'custom';
  description?: string;
}

interface TrajectoriesTabProps {
  onGenerateTrajectory?: (name: string, prompt: string) => void;
  generatingTrajectory?: string | null;
}

export function TrajectoriesTab({ onGenerateTrajectory, generatingTrajectory }: TrajectoriesTabProps) {
  const [trajectories, setTrajectories] = useState<TrajectoryEntry[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  // Load trajectory list
  const refreshList = useCallback(async () => {
    const registryNames = listTrajectoryNames();
    const cached = await listCachedTrajectories();
    const cachedMap = new Map<string, StoredTrajectory>(cached.map(t => [t.name, t]));

    // Restore any cached trajectories not yet in the runtime registry
    for (const stored of cached) {
      if (!registryNames.includes(stored.name)) {
        registerTrajectoryFromLUT(stored.name, stored.points, stored.pointCount);
      }
    }

    const updatedNames = listTrajectoryNames();
    const entries: TrajectoryEntry[] = updatedNames.map(name => ({
      name,
      source: isBuiltinTrajectory(name) ? 'builtin' as const : (cachedMap.get(name)?.source ?? 'custom' as const),
      description: cachedMap.get(name)?.description,
    }));

    setTrajectories(entries);
  }, []);

  useEffect(() => { refreshList(); }, [refreshList]);

  // Re-check when a generation completes (generatingTrajectory goes from string → null)
  useEffect(() => {
    if (!generatingTrajectory) refreshList();
  }, [generatingTrajectory, refreshList]);

  const handleDelete = useCallback(async (name: string) => {
    if (isBuiltinTrajectory(name)) return;
    unregisterTrajectory(name);
    await removeCachedTrajectory(name);
    refreshList();
  }, [refreshList]);

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const builtins = trajectories.filter(t => t.source === 'builtin');
  const generated = trajectories.filter(t => t.source === 'generated');
  const custom = trajectories.filter(t => t.source === 'custom');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Trajectory list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Section
          title="built-in"
          items={builtins}
          collapsed={!!collapsedSections['builtin']}
          onToggle={() => toggleSection('builtin')}
        />
        {generated.length > 0 && (
          <Section
            title="generated"
            items={generated}
            collapsed={!!collapsedSections['generated']}
            onToggle={() => toggleSection('generated')}
            onDelete={handleDelete}
          />
        )}
        {custom.length > 0 && (
          <Section
            title="custom"
            items={custom}
            collapsed={!!collapsedSections['custom']}
            onToggle={() => toggleSection('custom')}
            onDelete={handleDelete}
          />
        )}

        {generatingTrajectory && (
          <div style={{
            padding: '6px 0',
            fontSize: '10px',
            fontFamily: "'SF Mono', monospace",
            opacity: 0.4,
            fontStyle: 'italic',
          }}>
            generating "{generatingTrajectory}"...
          </div>
        )}
      </div>

      {/* Hint */}
      <div style={{
        padding: '4px 0 2px',
        fontSize: '9px',
        opacity: 0.15,
        fontStyle: 'italic',
        flexShrink: 0,
      }}>
        use "move gen &lt;description&gt;" in code
      </div>
    </div>
  );
}

function Section({
  title,
  items,
  collapsed,
  onToggle,
  onDelete,
}: {
  title: string;
  items: TrajectoryEntry[];
  collapsed: boolean;
  onToggle: () => void;
  onDelete?: (name: string) => void;
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
      {!collapsed && items.map((t) => (
        <div
          key={t.name}
          style={{
            padding: '2px 0 2px 8px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <TrajectoryPreview name={t.name} size={24} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '11px',
              fontFamily: "'SF Mono', 'Consolas', monospace",
              opacity: 0.6,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {t.name}
            </div>
            {t.description && (
              <div style={{
                fontSize: '9px',
                opacity: 0.25,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {t.description}
              </div>
            )}
          </div>
          {onDelete && (
            <button
              onClick={() => onDelete(t.name)}
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
                flexShrink: 0,
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
