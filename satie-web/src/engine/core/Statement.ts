/**
 * Represents a single parsed Satie statement (a sound event).
 * Ported from Satie Unity: Statement class in SatieParser.cs
 */
import { RangeOrValue } from './RangeOrValue';
import { InterpolationData } from './InterpolationData';

export interface GenDefinition {
  name: string;
  prompt: string;
  duration: RangeOrValue;
  influence: RangeOrValue;
  loopable: boolean;
}

export interface TrajectoryGenDefinition {
  name: string;
  prompt: string;
  duration: number;       // cycle length in seconds (default 30)
  resolution: number;     // LUT point count (default 8192)
  smoothing: number;      // 0-1 post-process smoothing factor (default 0)
  seed: number;           // random seed for reproducibility (default 0 = random)
  ground: boolean;        // constrain to Y=0 plane
  variation: number;      // speed/velocity variation 0-1 (default 0.5)
}

export enum WanderType {
  None = 'none',
  Walk = 'walk',
  Fly = 'fly',
  Fixed = 'fixed',
  Spiral = 'spiral',
  Orbit = 'orbit',
  Lorenz = 'lorenz',
  Custom = 'custom',
}

const BUILTIN_TRAJECTORY_TYPES = new Set([WanderType.Spiral, WanderType.Orbit, WanderType.Lorenz]);

export function isTrajectoryWanderType(wt: WanderType): boolean {
  return BUILTIN_TRAJECTORY_TYPES.has(wt) || wt === WanderType.Custom;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ReverbParams {
  dryWet: RangeOrValue;
  roomSize: RangeOrValue;
  damping: RangeOrValue;
  dryWetInterpolation: InterpolationData | null;
  roomSizeInterpolation: InterpolationData | null;
  dampingInterpolation: InterpolationData | null;
}

export interface DelayParams {
  dryWet: RangeOrValue;
  time: RangeOrValue;
  feedback: RangeOrValue;
  pingPong: boolean;
  dryWetInterpolation: InterpolationData | null;
  timeInterpolation: InterpolationData | null;
  feedbackInterpolation: InterpolationData | null;
}

export interface FilterParams {
  mode: string;
  cutoff: RangeOrValue;
  resonance: RangeOrValue;
  dryWet: RangeOrValue;
  cutoffInterpolation: InterpolationData | null;
  resonanceInterpolation: InterpolationData | null;
  dryWetInterpolation: InterpolationData | null;
}

export interface DistortionParams {
  mode: string;
  drive: RangeOrValue;
  dryWet: RangeOrValue;
  driveInterpolation: InterpolationData | null;
  dryWetInterpolation: InterpolationData | null;
}

export interface EQParams {
  lowGain: RangeOrValue;
  midGain: RangeOrValue;
  highGain: RangeOrValue;
  lowGainInterpolation: InterpolationData | null;
  midGainInterpolation: InterpolationData | null;
  highGainInterpolation: InterpolationData | null;
}

export class Statement {
  kind: string = 'loop';
  clip: string = '';
  count: number = 1;
  start: RangeOrValue = RangeOrValue.Zero;
  end: RangeOrValue = RangeOrValue.Null;
  endFade: RangeOrValue = RangeOrValue.Null;
  duration: RangeOrValue = RangeOrValue.Null;
  every: RangeOrValue = RangeOrValue.Null;
  volume: RangeOrValue = RangeOrValue.One;
  pitch: RangeOrValue = RangeOrValue.One;
  overlap: boolean = false;
  persistent: boolean = false;
  mute: boolean = false;
  solo: boolean = false;
  isGenerated: boolean = false;
  genPrompt: string | null = null;
  genDuration: RangeOrValue = RangeOrValue.Null;
  genInfluence: RangeOrValue = RangeOrValue.Null;
  genLoopable: boolean = false;
  fadeIn: RangeOrValue = RangeOrValue.Null;
  fadeOut: RangeOrValue = RangeOrValue.Null;
  randomStart: boolean = false;

  // Spatial
  wanderType: WanderType = WanderType.None;
  areaMin: Vec3 = { x: 0, y: 0, z: 0 };
  areaMax: Vec3 = { x: 0, y: 0, z: 0 };
  wanderHz: RangeOrValue = RangeOrValue.single(0.3);

  customTrajectoryName: string | null = null;  // for WanderType.Custom
  isGenTrajectory: boolean = false;  // true if trajectory needs generation
  genTrajectoryPrompt: string | null = null;  // description for trajectory gen
  genTrajectoryDuration: number = 30;         // cycle length in seconds
  genTrajectoryResolution: number = 8192;     // LUT point count
  genTrajectorySmoothing: number = 0;         // post-process smoothing 0-1
  genTrajectorySeed: number = 0;              // random seed (0 = random)
  genTrajectoryGround: boolean = false;       // constrain to ground plane
  genTrajectoryVariation: number = 0.5;       // speed variation 0-1

  noise: number = 0;  // trajectory noise amplitude 0-1

  visual: string[] = [];

  // Interpolation data for dynamic properties
  volumeInterpolation: InterpolationData | null = null;
  pitchInterpolation: InterpolationData | null = null;
  moveXMinInterpolation: InterpolationData | null = null;
  moveXMaxInterpolation: InterpolationData | null = null;
  moveYMinInterpolation: InterpolationData | null = null;
  moveYMaxInterpolation: InterpolationData | null = null;
  moveZMinInterpolation: InterpolationData | null = null;
  moveZMaxInterpolation: InterpolationData | null = null;
  moveSpeedInterpolation: InterpolationData | null = null;

  // Color
  staticColor: string | null = null;
  staticAlpha: number = 1;
  colorRedRange: RangeOrValue | null = null;
  colorGreenRange: RangeOrValue | null = null;
  colorBlueRange: RangeOrValue | null = null;
  colorRedInterpolation: InterpolationData | null = null;
  colorGreenInterpolation: InterpolationData | null = null;
  colorBlueInterpolation: InterpolationData | null = null;
  colorAlphaInterpolation: InterpolationData | null = null;

  // DSP
  reverbParams: ReverbParams | null = null;
  delayParams: DelayParams | null = null;
  filterParams: FilterParams | null = null;
  distortionParams: DistortionParams | null = null;
  eqParams: EQParams | null = null;

  clone(): Statement {
    const s = new Statement();
    Object.assign(s, this);
    s.visual = [...this.visual];
    s.areaMin = { ...this.areaMin };
    s.areaMax = { ...this.areaMax };
    return s;
  }
}
