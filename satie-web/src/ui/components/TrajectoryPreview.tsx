import { useRef, useEffect } from 'react';
import { getTrajectory } from '../../engine/spatial/Trajectories';

interface TrajectoryPreviewProps {
  name: string;
  size?: number;
}

/**
 * Mini 3D wireframe preview of a trajectory, rendered to a canvas.
 * Uses simple isometric projection — no Three.js dependency.
 */
export function TrajectoryPreview({ name, size = 32 }: TrajectoryPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const trajectory = getTrajectory(name);
    if (!trajectory) {
      ctx.clearRect(0, 0, size, size);
      return;
    }

    const steps = 200;
    const padding = 3;
    const drawSize = size - padding * 2;

    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(26, 58, 42, 0.4)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();

    // Isometric projection: x' = (x - z) * cos(30), y' = y - (x + z) * sin(30)
    const cos30 = 0.866;
    const sin30 = 0.5;

    let firstX = 0, firstY = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pt = trajectory.evaluate(t);
      // Center around 0.5 and project
      const cx = pt.x - 0.5;
      const cy = pt.y - 0.5;
      const cz = pt.z - 0.5;
      const px = padding + drawSize * 0.5 + (cx - cz) * cos30 * drawSize * 0.5;
      const py = padding + drawSize * 0.5 - cy * drawSize * 0.5 + (cx + cz) * sin30 * drawSize * 0.25;

      if (i === 0) {
        firstX = px;
        firstY = py;
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();

    // Draw start point
    ctx.fillStyle = 'rgba(26, 58, 42, 0.6)';
    ctx.beginPath();
    ctx.arc(firstX, firstY, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }, [name, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size, flexShrink: 0 }}
    />
  );
}
