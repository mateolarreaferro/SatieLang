import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react';

interface PanelProps {
  title?: string;
  children: ReactNode;
  defaultWidth?: number;
  defaultHeight?: number;
  defaultX?: number;
  defaultY?: number;
  minWidth?: number;
  minHeight?: number;
  resizable?: boolean;
  borderColor?: string;
  compact?: boolean;
}

export function Panel({
  title,
  children,
  defaultWidth = 400,
  defaultHeight = 300,
  defaultX = 20,
  defaultY = 20,
  minWidth = 200,
  minHeight = 150,
  resizable = true,
  borderColor = '#1a3a2a',
  compact = false,
}: PanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: defaultX, y: defaultY });
  const [size, setSize] = useState({ w: defaultWidth, h: defaultHeight });
  const [isDragging, setIsDragging] = useState(false);
  const [resizeEdge, setResizeEdge] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const startRect = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const onDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-edge]')) return;
    setIsDragging(true);
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [pos]);

  const onEdgeStart = useCallback((edge: string) => (e: React.MouseEvent) => {
    setResizeEdge(edge);
    dragOffset.current = { x: e.clientX, y: e.clientY };
    startRect.current = { x: pos.x, y: pos.y, w: size.w, h: size.h };
    e.preventDefault();
    e.stopPropagation();
  }, [pos, size]);

  useEffect(() => {
    if (!isDragging && !resizeEdge) return;

    const onMove = (e: MouseEvent) => {
      if (isDragging) {
        setPos({
          x: e.clientX - dragOffset.current.x,
          y: e.clientY - dragOffset.current.y,
        });
      }
      if (resizeEdge) {
        const dx = e.clientX - dragOffset.current.x;
        const dy = e.clientY - dragOffset.current.y;
        const r = startRect.current;

        let newX = r.x, newY = r.y, newW = r.w, newH = r.h;

        if (resizeEdge.includes('e')) newW = Math.max(minWidth, r.w + dx);
        if (resizeEdge.includes('s')) newH = Math.max(minHeight, r.h + dy);
        if (resizeEdge.includes('w')) {
          const dw = Math.min(dx, r.w - minWidth);
          newX = r.x + dw;
          newW = r.w - dw;
        }
        if (resizeEdge.includes('n')) {
          const dh = Math.min(dy, r.h - minHeight);
          newY = r.y + dh;
          newH = r.h - dh;
        }

        setPos({ x: newX, y: newY });
        setSize({ w: newW, h: newH });
      }
    };

    const onUp = () => { setIsDragging(false); setResizeEdge(null); };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, resizeEdge, minWidth, minHeight]);

  const EDGE = 8;
  const RADIUS = 20;

  const edgeStyle = (cursor: string, extra: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute',
    zIndex: 10,
    cursor,
    ...extra,
  });

  return (
    <div
      ref={panelRef}
      className="satie-panel"
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        background: '#faf9f6',
        borderRadius: RADIUS,
        border: `1.5px solid ${borderColor}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 2px 20px rgba(0,0,0,0.04)',
      }}
    >
      {/* Title bar */}
      <div
        className="panel-titlebar"
        onMouseDown={onDragStart}
        style={{
          padding: compact ? '6px 14px 3px' : '10px 16px 6px',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        {title && (
          <span style={{
            fontSize: compact ? '10px' : '13px',
            fontWeight: 500,
            color: '#1a3a2a',
            letterSpacing: '0.02em',
            fontFamily: "'Inter', system-ui, sans-serif",
            opacity: compact ? 0.4 : 1,
          }}>
            {title}
          </span>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {children}
      </div>

      {/* Resize edges — inset to follow the rounded border */}
      {resizable && (<>
        {/* Right */}
        <div data-edge="e" onMouseDown={onEdgeStart('e')}
          style={edgeStyle('ew-resize', {
            top: RADIUS, right: 0, bottom: RADIUS, width: EDGE,
          })} />
        {/* Bottom */}
        <div data-edge="s" onMouseDown={onEdgeStart('s')}
          style={edgeStyle('ns-resize', {
            left: RADIUS, right: RADIUS, bottom: 0, height: EDGE,
          })} />
        {/* Left */}
        <div data-edge="w" onMouseDown={onEdgeStart('w')}
          style={edgeStyle('ew-resize', {
            top: RADIUS, left: 0, bottom: RADIUS, width: EDGE,
          })} />
        {/* Top (below title) */}
        <div data-edge="n" onMouseDown={onEdgeStart('n')}
          style={edgeStyle('ns-resize', {
            left: RADIUS, right: RADIUS, top: 0, height: EDGE,
          })} />
        {/* Corners — rounded arcs */}
        <div data-edge="se" onMouseDown={onEdgeStart('se')}
          style={edgeStyle('nwse-resize', {
            right: 0, bottom: 0, width: RADIUS, height: RADIUS,
            borderRadius: `0 0 ${RADIUS}px 0`,
          })} />
        <div data-edge="sw" onMouseDown={onEdgeStart('sw')}
          style={edgeStyle('nesw-resize', {
            left: 0, bottom: 0, width: RADIUS, height: RADIUS,
            borderRadius: `0 0 0 ${RADIUS}px`,
          })} />
        <div data-edge="ne" onMouseDown={onEdgeStart('ne')}
          style={edgeStyle('nesw-resize', {
            right: 0, top: 0, width: RADIUS, height: RADIUS,
            borderRadius: `0 ${RADIUS}px 0 0`,
          })} />
        <div data-edge="nw" onMouseDown={onEdgeStart('nw')}
          style={edgeStyle('nwse-resize', {
            left: 0, top: 0, width: RADIUS, height: RADIUS,
            borderRadius: `${RADIUS}px 0 0 0`,
          })} />
      </>)}
    </div>
  );
}
