/**
 * Represents a single parsed Satie statement (a sound event).
 * Ported from Satie Unity: Statement class in SatieParser.cs
 */
import { RangeOrValue } from './RangeOrValue';
import { InterpolationData } from './InterpolationData';

export enum WanderType {
  None = 'none',
  Walk = 'walk',
  Fly = 'fly',
  Fixed = 'fixed',
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
  fadeIn: RangeOrValue = RangeOrValue.Null;
  fadeOut: RangeOrValue = RangeOrValue.Null;
  randomStart: boolean = false;

  // Spatial
  wanderType: WanderType = WanderType.None;
  areaMin: Vec3 = { x: 0, y: 0, z: 0 };
  areaMax: Vec3 = { x: 0, y: 0, z: 0 };
  wanderHz: RangeOrValue = RangeOrValue.single(0.3);

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
