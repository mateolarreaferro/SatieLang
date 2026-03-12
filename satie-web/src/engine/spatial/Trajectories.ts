/**
 * Named trajectory patterns for Satie spatial movement.
 * Normalized [0,1] output — remapped to areaMin/areaMax by the engine.
 */

export interface Trajectory {
  evaluate(t: number): { x: number; y: number; z: number };
}

/**
 * Analytical trajectory — computes position directly from t, no storage.
 */
class AnalyticalTrajectory implements Trajectory {
  constructor(private fn: (t: number) => { x: number; y: number; z: number }) {}
  evaluate(t: number) { return this.fn(t); }
}

/**
 * LUT trajectory — pre-computes points lazily, lerps at runtime.
 */
class LUTTrajectory implements Trajectory {
  private xs: Float32Array | null = null;
  private ys: Float32Array | null = null;
  private zs: Float32Array | null = null;
  private readonly size: number;
  private readonly generate: () => { xs: Float32Array; ys: Float32Array; zs: Float32Array };

  constructor(size: number, generate: () => { xs: Float32Array; ys: Float32Array; zs: Float32Array }) {
    this.size = size;
    this.generate = generate;
  }

  evaluate(t: number): { x: number; y: number; z: number } {
    if (!this.xs) {
      const data = this.generate();
      this.xs = data.xs;
      this.ys = data.ys;
      this.zs = data.zs;
    }

    // Wrap t to [0,1)
    t = t - Math.floor(t);
    const idx = t * (this.size - 1);
    const i0 = idx | 0;
    const i1 = i0 + 1 < this.size ? i0 + 1 : 0;
    const frac = idx - i0;

    return {
      x: this.xs![i0] + (this.xs![i1] - this.xs![i0]) * frac,
      y: this.ys![i0] + (this.ys![i1] - this.ys![i0]) * frac,
      z: this.zs![i0] + (this.zs![i1] - this.zs![i0]) * frac,
    };
  }
}

// ── Trajectory implementations ──

const TWO_PI = 2 * Math.PI;

const spiral: Trajectory = new AnalyticalTrajectory((t) => {
  const angle = TWO_PI * t;
  return {
    x: (Math.cos(angle) + 1) * 0.5,  // [0,1]
    y: t % 1,                          // [0,1]
    z: (Math.sin(angle) + 1) * 0.5,  // [0,1]
  };
});

const orbit: Trajectory = new AnalyticalTrajectory((t) => {
  const angle = TWO_PI * t;
  return {
    x: (Math.cos(angle) + 1) * 0.5,
    y: 0.5,
    z: (Math.sin(angle) + 1) * 0.5,
  };
});

const LUT_SIZE = 4096;

function generateLorenzLUT(): { xs: Float32Array; ys: Float32Array; zs: Float32Array } {
  const sigma = 10, rho = 28, beta = 8 / 3;
  const dt = 0.005;
  const steps = LUT_SIZE;

  const xs = new Float32Array(steps);
  const ys = new Float32Array(steps);
  const zs = new Float32Array(steps);

  // Initial conditions
  let x = 1, y = 1, z = 1;

  // Warm up (skip transient)
  for (let i = 0; i < 1000; i++) {
    // RK4
    const k1x = sigma * (y - x);
    const k1y = x * (rho - z) - y;
    const k1z = x * y - beta * z;

    const x1 = x + 0.5 * dt * k1x, y1 = y + 0.5 * dt * k1y, z1 = z + 0.5 * dt * k1z;
    const k2x = sigma * (y1 - x1);
    const k2y = x1 * (rho - z1) - y1;
    const k2z = x1 * y1 - beta * z1;

    const x2 = x + 0.5 * dt * k2x, y2 = y + 0.5 * dt * k2y, z2 = z + 0.5 * dt * k2z;
    const k3x = sigma * (y2 - x2);
    const k3y = x2 * (rho - z2) - y2;
    const k3z = x2 * y2 - beta * z2;

    const x3 = x + dt * k3x, y3 = y + dt * k3y, z3 = z + dt * k3z;
    const k4x = sigma * (y3 - x3);
    const k4y = x3 * (rho - z3) - y3;
    const k4z = x3 * y3 - beta * z3;

    x += dt * (k1x + 2 * k2x + 2 * k3x + k4x) / 6;
    y += dt * (k1y + 2 * k2y + 2 * k3y + k4y) / 6;
    z += dt * (k1z + 2 * k2z + 2 * k3z + k4z) / 6;
  }

  // Collect points
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i < steps; i++) {
    const k1x = sigma * (y - x);
    const k1y = x * (rho - z) - y;
    const k1z = x * y - beta * z;

    const x1 = x + 0.5 * dt * k1x, y1 = y + 0.5 * dt * k1y, z1 = z + 0.5 * dt * k1z;
    const k2x = sigma * (y1 - x1);
    const k2y = x1 * (rho - z1) - y1;
    const k2z = x1 * y1 - beta * z1;

    const x2 = x + 0.5 * dt * k2x, y2 = y + 0.5 * dt * k2y, z2 = z + 0.5 * dt * k2z;
    const k3x = sigma * (y2 - x2);
    const k3y = x2 * (rho - z2) - y2;
    const k3z = x2 * y2 - beta * z2;

    const x3 = x + dt * k3x, y3 = y + dt * k3y, z3 = z + dt * k3z;
    const k4x = sigma * (y3 - x3);
    const k4y = x3 * (rho - z3) - y3;
    const k4z = x3 * y3 - beta * z3;

    x += dt * (k1x + 2 * k2x + 2 * k3x + k4x) / 6;
    y += dt * (k1y + 2 * k2y + 2 * k3y + k4y) / 6;
    z += dt * (k1z + 2 * k2z + 2 * k3z + k4z) / 6;

    xs[i] = x; ys[i] = y; zs[i] = z;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  // Normalize to [0,1]
  const rxRange = maxX - minX || 1;
  const ryRange = maxY - minY || 1;
  const rzRange = maxZ - minZ || 1;
  for (let i = 0; i < steps; i++) {
    xs[i] = (xs[i] - minX) / rxRange;
    ys[i] = (ys[i] - minY) / ryRange;
    zs[i] = (zs[i] - minZ) / rzRange;
  }

  return { xs, ys, zs };
}

const lorenz: Trajectory = new LUTTrajectory(LUT_SIZE, generateLorenzLUT);

// ── Registry ──

const BUILTIN_NAMES = new Set(['spiral', 'orbit', 'lorenz']);

const TRAJECTORY_REGISTRY: Map<string, Trajectory> = new Map([
  ['spiral', spiral],
  ['orbit', orbit],
  ['lorenz', lorenz],
]);

export function getTrajectory(name: string): Trajectory | undefined {
  return TRAJECTORY_REGISTRY.get(name);
}

export function isTrajectoryName(name: string): boolean {
  return TRAJECTORY_REGISTRY.has(name);
}

export function isBuiltinTrajectory(name: string): boolean {
  return BUILTIN_NAMES.has(name);
}

/** Register a custom trajectory from a pre-computed LUT (interleaved xyz Float32Array). */
export function registerTrajectoryFromLUT(name: string, points: Float32Array, pointCount: number): void {
  // Deinterleave into separate xyz arrays for LUTTrajectory
  const xs = new Float32Array(pointCount);
  const ys = new Float32Array(pointCount);
  const zs = new Float32Array(pointCount);
  for (let i = 0; i < pointCount; i++) {
    xs[i] = points[i * 3];
    ys[i] = points[i * 3 + 1];
    zs[i] = points[i * 3 + 2];
  }
  const traj = new LUTTrajectory(pointCount, () => ({ xs, ys, zs }));
  // Force evaluation so the LUT is immediately available
  traj.evaluate(0);
  TRAJECTORY_REGISTRY.set(name, traj);
}

/** Remove a custom trajectory (cannot remove builtins). */
export function unregisterTrajectory(name: string): boolean {
  if (BUILTIN_NAMES.has(name)) return false;
  return TRAJECTORY_REGISTRY.delete(name);
}

/** List all registered trajectory names. */
export function listTrajectoryNames(): string[] {
  return Array.from(TRAJECTORY_REGISTRY.keys());
}

export { LUTTrajectory };
