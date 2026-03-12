/**
 * Satie Language Parser — full port from SatieParser.cs
 * Parses .satie scripts into Statement objects.
 */
import { RangeOrValue } from './RangeOrValue';
import { InterpolationData, InterpolationType } from './InterpolationData';
import {
  Statement,
  GenDefinition,
  TrajectoryGenDefinition,
  WanderType,
  ReverbParams,
  DelayParams,
  FilterParams,
  DistortionParams,
  EQParams,
} from './Statement';
import { isTrajectoryName, isBuiltinTrajectory } from '../spatial/Trajectories';

export class SatieSyntaxError extends Error {
  propertyName: string | null;
  invalidValue: string | null;
  sourceLine: string | null;
  lineNumber: number;

  constructor(
    message: string,
    propertyName?: string | null,
    invalidValue?: string | null,
    sourceLine?: string | null,
    lineNumber?: number,
  ) {
    super(message);
    this.name = 'SatieSyntaxError';
    this.propertyName = propertyName ?? null;
    this.invalidValue = invalidValue ?? null;
    this.sourceLine = sourceLine ?? null;
    this.lineNumber = lineNumber ?? -1;
  }
}

// Regex patterns (compiled once)
const GenRx = /^(?<prefix>(?:\d+\s*\*\s*)?)(?<kind>loop|oneshot)\s+gen\s+(?<prompt>.+?)(?=\s+every\s+|\s*#|$)/i;

const StmtRx = /^(?:(?<count>\d+)\s*\*\s*)?(?<kind>loop|oneshot)\s+(?<clip>[^\s#]+)\s*(?:every\s+(?:(?<e1>-?\d+\.?\d*)to(?<e2>-?\d+\.?\d*)|(?<e>-?\d+\.?\d*)))?\s*(?:#.*)?\r?\n(?<block>(?:[ \t]+.*\r?\n?)*)/im;

const StmtStartRx = /^(?:\d+\s*\*\s*)?(?:loop|oneshot)\b/i;

const PropRx = /^[ \t]*(?<key>\w+)(?:[ \t]+(?<val>[^\r\n#]+))?/gm;

interface GroupCtx {
  props: Map<string, string>;
  children: Statement[];
  indent: number;
}

function countIndent(line: string): number {
  let n = 0;
  while (n < line.length && (line[n] === ' ' || line[n] === '\t')) n++;
  return n;
}

function stripBlockComments(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let inBlockComment = false;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.toLowerCase().startsWith('comment')) { inBlockComment = true; continue; }
    if (trimmed.toLowerCase().startsWith('endcomment')) { inBlockComment = false; continue; }
    if (inBlockComment) continue;
    result.push(line);
  }
  return result.join('\n');
}

function hasInterpolation(v: string): boolean {
  return v.includes('interpolate') || v.includes('goto') || v.includes('gobetween');
}

function parseRange(str: string): [number, number] {
  str = str.trim();
  if (str.includes('to')) {
    const parts = str.split('to');
    return [parseFloat(parts[0]), parseFloat(parts[1])];
  }
  const val = parseFloat(str);
  return [val, val];
}

export function sanitizeForClipName(prompt: string): string {
  let sanitized = prompt.replace(/[<>:"/\\|?*]/g, '_').replace(/ /g, '_').toLowerCase();
  if (sanitized.length > 30) sanitized = sanitized.substring(0, 30);
  return sanitized;
}

export function pathFor(clip: string): string {
  if (!clip || !clip.trim()) return '';
  let c = clip.replace(/\\/g, '/').replace(/^\//, '');
  const dot = c.lastIndexOf('.');
  if (dot >= 0) c = c.substring(0, dot);
  if (!c.startsWith('Audio/')) c = `Audio/${c}`;
  return c;
}

// Preprocess gen keyword
function preprocessGen(line: string): { line: string; prompt: string | null; isGen: boolean } {
  const m = line.match(GenRx);
  if (!m?.groups) return { line, prompt: null, isGen: false };

  const prefix = m.groups.prefix;
  const kind = m.groups.kind;
  const prompt = m.groups.prompt.trim();
  const clipName = 'generation/' + sanitizeForClipName(prompt);
  const remainder = line.substring(m[0].length);
  const rewritten = `${prefix}${kind} ${clipName}${remainder}`;

  return { line: rewritten, prompt, isGen: true };
}

// Parse a single statement block
function parseSingle(block: string): Statement {
  const m = block.match(StmtRx);
  if (!m?.groups) throw new SatieSyntaxError('Failed to match statement pattern', null, block);

  const s = new Statement();
  s.kind = m.groups.kind.toLowerCase();
  s.clip = m.groups.clip.trim();
  s.count = m.groups.count ? parseInt(m.groups.count, 10) : 1;

  if (m.groups.e1) {
    s.every = RangeOrValue.range(parseFloat(m.groups.e1), parseFloat(m.groups.e2));
  } else if (m.groups.e) {
    s.every = RangeOrValue.single(parseFloat(m.groups.e));
  }

  const propsBlock = stripBlockComments(m.groups.block || '');
  const STANDALONE_FLAGS = new Set(['overlap', 'persistent', 'mute', 'solo', 'randomstart', 'random_start', 'loopable']);

  let propMatch: RegExpExecArray | null;
  const propRx = /^[ \t]*(?<key>\w+)(?:[ \t]+(?<val>[^\r\n]+))?/gm;
  while ((propMatch = propRx.exec(propsBlock)) !== null) {
    const k = propMatch.groups!.key.toLowerCase();
    const isFlag = STANDALONE_FLAGS.has(k);
    let v = (!isFlag && propMatch.groups!.val) ? propMatch.groups!.val.trim() : '';
    // Strip trailing inline comments, but preserve # in hex colors
    v = v.replace(/\s+#(?![0-9A-Fa-f]{6}\b).*$/, '');

    switch (k) {
      case 'volume':
        if (hasInterpolation(v)) s.volumeInterpolation = InterpolationData.parse(v);
        else s.volume = RangeOrValue.parse(v);
        break;
      case 'pitch':
        if (hasInterpolation(v)) s.pitchInterpolation = InterpolationData.parse(v);
        else s.pitch = RangeOrValue.parse(v);
        break;
      case 'starts_at': // Legacy alias
      case 'start': s.start = RangeOrValue.parse(v); break;
      case 'end': parseEnd(s, v); break;
      case 'duration': s.duration = RangeOrValue.parse(v); break;
      case 'fade_in': s.fadeIn = RangeOrValue.parse(v); break;
      case 'fade_out': s.fadeOut = RangeOrValue.parse(v); break;
      case 'every': s.every = RangeOrValue.parse(v); break;
      case 'overlap': s.overlap = true; break;
      case 'persistent': s.persistent = true; break;
      case 'mute': s.mute = true; break;
      case 'solo': s.solo = true; break;
      case 'random_start':
      case 'randomstart': s.randomStart = true; break;
      case 'visual': parseVisual(s, v); break;
      case 'move': parseMove(s, v); break;
      case 'color': parseColor(s, v); break;
      case 'alpha': {
        if (hasInterpolation(v)) s.colorAlphaInterpolation = InterpolationData.parse(v);
        else { const a = parseFloat(v); if (!isNaN(a)) s.staticAlpha = Math.max(0, Math.min(1, a)); }
        break;
      }
      case 'reverb': parseReverb(s, v); break;
      case 'delay': parseDelay(s, v); break;
      case 'filter': parseFilter(s, v); break;
      case 'distortion': parseDistortion(s, v); break;
      case 'eq': parseEQ(s, v); break;
      case 'influence': {
        const inf = RangeOrValue.parse(v);
        if (!inf.isNull) {
          const clampVal = (n: number) => Math.max(0, Math.min(1, n));
          s.genInfluence = inf.isRange
            ? RangeOrValue.range(clampVal(inf.min), clampVal(inf.max))
            : RangeOrValue.single(clampVal(inf.min));
        }
        break;
      }
      case 'loopable': s.genLoopable = true; break;
    }
  }
  return s;
}

function parseEnd(s: Statement, v: string): void {
  const timeMatch = v.match(/^(.+?)(?=\s+fade\s+|$)/i);
  if (timeMatch) s.end = RangeOrValue.parse(timeMatch[1].trim());
  const fadeMatch = v.match(/\bfade\s+(.+?)$/i);
  if (fadeMatch) s.endFade = RangeOrValue.parse(fadeMatch[1].trim());
}

function parseVisual(s: Statement, v: string): void {
  if (!v.trim()) return;
  // Support both "visual trail sphere" and legacy "visual trail and sphere"
  const cleaned = v.replace(/\band\b/gi, ' ');
  const tokens = cleaned.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const lower = tokens[i].toLowerCase();
    if (!lower) continue;
    // Handle `object "PrefabName"` → push `object:PrefabName`
    if (lower === 'object' && i + 1 < tokens.length) {
      const name = tokens[i + 1].replace(/"/g, '');
      s.visual.push(`object:${name}`);
      i++; // skip next token
      continue;
    }
    s.visual.push(lower);
  }
}

function parseMove(s: Statement, v: string): void {
  v = v.trim();

  // Legacy comma-separated syntax
  if (v.includes(',')) {
    const parts = v.split(',');
    const mode = parts[0].trim().toLowerCase();
    if (mode === 'walk' && parts.length >= 4) {
      const [xmin, xmax] = parseRange(parts[1]);
      const [zmin, zmax] = parseRange(parts[2]);
      s.wanderType = WanderType.Walk;
      s.areaMin = { x: xmin, y: 0, z: zmin };
      s.areaMax = { x: xmax, y: 0, z: zmax };
      s.wanderHz = RangeOrValue.parse(parts[3]);
      return;
    }
    if (mode === 'fly' && parts.length >= 5) {
      const [xmin, xmax] = parseRange(parts[1]);
      const [ymin, ymax] = parseRange(parts[2]);
      const [zmin, zmax] = parseRange(parts[3]);
      s.wanderType = WanderType.Fly;
      s.areaMin = { x: xmin, y: ymin, z: zmin };
      s.areaMax = { x: xmax, y: ymax, z: zmax };
      s.wanderHz = RangeOrValue.parse(parts[4]);
      return;
    }
    if (mode === 'pos' && parts.length >= 4) {
      const [xmin, xmax] = parseRange(parts[1]);
      const [ymin, ymax] = parseRange(parts[2]);
      const [zmin, zmax] = parseRange(parts[3]);
      s.wanderType = WanderType.Fixed;
      s.areaMin = { x: xmin, y: ymin, z: zmin };
      s.areaMax = { x: xmax, y: ymax, z: zmax };
      return;
    }
  }

  // Gen trajectory — "move gen <description> [speed X] [noise X] [x Xto X] [y ...] [z ...]"
  const genMatch = v.match(/^gen\s+(.+)$/i);
  if (genMatch) {
    let rest = genMatch[1].trim();

    // Extract noise
    const gNoiseMatch = rest.match(/\bnoise\s+([\d.]+)/i);
    if (gNoiseMatch) {
      s.noise = Math.max(0, Math.min(1, parseFloat(gNoiseMatch[1]) || 0));
      rest = rest.substring(0, gNoiseMatch.index!).trim() + ' ' + rest.substring(gNoiseMatch.index! + gNoiseMatch[0].length).trim();
    }

    // Extract speed
    const gSpeedMatch = rest.match(/(?:at\s+)?speed\s+(.+?)(?=\s+(?:x|y|z|noise)\s+|$)/i);
    if (gSpeedMatch) {
      const speedValue = gSpeedMatch[1].trim();
      const speedInterp = InterpolationData.parse(speedValue);
      if (speedInterp) {
        s.moveSpeedInterpolation = speedInterp;
        s.wanderHz = RangeOrValue.single(speedInterp.minValue);
      } else {
        s.wanderHz = RangeOrValue.parse(speedValue);
      }
      rest = rest.substring(0, gSpeedMatch.index!).trim() + ' ' + rest.substring(gSpeedMatch.index! + gSpeedMatch[0].length).trim();
    }

    // Extract axis bounds
    let gxMin = -5, gxMax = 5, gyMin = -5, gyMax = 5, gzMin = -5, gzMax = 5;
    const gxMatch = rest.match(/\bx\s+(-?[\d.]+)to(-?[\d.]+)/i);
    if (gxMatch) { gxMin = parseFloat(gxMatch[1]); gxMax = parseFloat(gxMatch[2]); rest = rest.substring(0, gxMatch.index!).trim() + ' ' + rest.substring(gxMatch.index! + gxMatch[0].length).trim(); }
    const gyMatch = rest.match(/\by\s+(-?[\d.]+)to(-?[\d.]+)/i);
    if (gyMatch) { gyMin = parseFloat(gyMatch[1]); gyMax = parseFloat(gyMatch[2]); rest = rest.substring(0, gyMatch.index!).trim() + ' ' + rest.substring(gyMatch.index! + gyMatch[0].length).trim(); }
    const gzMatch = rest.match(/\bz\s+(-?[\d.]+)to(-?[\d.]+)/i);
    if (gzMatch) { gzMin = parseFloat(gzMatch[1]); gzMax = parseFloat(gzMatch[2]); rest = rest.substring(0, gzMatch.index!).trim() + ' ' + rest.substring(gzMatch.index! + gzMatch[0].length).trim(); }

    // What remains is the description prompt
    const description = rest.trim();
    const slug = description.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    s.wanderType = WanderType.Custom;
    s.customTrajectoryName = slug;
    s.isGenTrajectory = true;
    s.genTrajectoryPrompt = description;
    s.areaMin = { x: gxMin, y: gyMin, z: gzMin };
    s.areaMax = { x: gxMax, y: gyMax, z: gzMax };
    return;
  }

  // Trajectory types — named movement patterns (builtins + custom registry)
  const trajectoryMatch = v.match(/^(spiral|orbit|lorenz)\b\s*/i);
  if (trajectoryMatch) {
    const trajName = trajectoryMatch[1].toLowerCase();
    v = v.substring(trajectoryMatch[0].length);

    // Extract noise if present (e.g. "noise 0.5")
    const noiseMatch = v.match(/\bnoise\s+([\d.]+)/i);
    if (noiseMatch) {
      s.noise = Math.max(0, Math.min(1, parseFloat(noiseMatch[1]) || 0));
      v = v.substring(0, noiseMatch.index!).trim() + ' ' + v.substring(noiseMatch.index! + noiseMatch[0].length).trim();
    }

    // Extract speed if present
    const trajSpeedMatch = v.match(/(?:at\s+)?speed\s+(.+?)(?=\s+(?:x|y|z|noise)\s+|$)/i);
    if (trajSpeedMatch) {
      const speedValue = trajSpeedMatch[1].trim();
      const speedInterp = InterpolationData.parse(speedValue);
      if (speedInterp) {
        s.moveSpeedInterpolation = speedInterp;
        s.wanderHz = RangeOrValue.single(speedInterp.minValue);
      } else {
        s.wanderHz = RangeOrValue.parse(speedValue);
      }
      v = v.substring(0, trajSpeedMatch.index!).trim() + v.substring(trajSpeedMatch.index! + trajSpeedMatch[0].length).trim();
    }

    // Map to WanderType
    switch (trajName) {
      case 'spiral': s.wanderType = WanderType.Spiral; break;
      case 'orbit': s.wanderType = WanderType.Orbit; break;
      case 'lorenz': s.wanderType = WanderType.Lorenz; break;
    }

    // Parse optional axis bounds (default -5to5 for all axes)
    let txMin = -5, txMax = 5, tyMin = -5, tyMax = 5, tzMin = -5, tzMax = 5;
    const txMatch = v.match(/x\s+(-?[\d.]+)to(-?[\d.]+)/i);
    if (txMatch) { txMin = parseFloat(txMatch[1]); txMax = parseFloat(txMatch[2]); }
    const tyMatch = v.match(/y\s+(-?[\d.]+)to(-?[\d.]+)/i);
    if (tyMatch) { tyMin = parseFloat(tyMatch[1]); tyMax = parseFloat(tyMatch[2]); }
    const tzMatch = v.match(/z\s+(-?[\d.]+)to(-?[\d.]+)/i);
    if (tzMatch) { tzMin = parseFloat(tzMatch[1]); tzMax = parseFloat(tzMatch[2]); }

    s.areaMin = { x: txMin, y: tyMin, z: tzMin };
    s.areaMax = { x: txMax, y: tyMax, z: tzMax };
    return;
  }

  // Custom trajectory by name — check the registry for non-builtin trajectories
  const firstWord = v.split(/\s+/)[0].toLowerCase();
  if (!['walk', 'fly', 'pos', 'gen'].includes(firstWord) && isTrajectoryName(firstWord) && !isBuiltinTrajectory(firstWord)) {
    s.wanderType = WanderType.Custom;
    s.customTrajectoryName = firstWord;
    const rest = v.substring(firstWord.length).trim();

    // Parse noise/speed/axis bounds just like builtins
    let rv = rest;
    const cNoiseMatch = rv.match(/\bnoise\s+([\d.]+)/i);
    if (cNoiseMatch) {
      s.noise = Math.max(0, Math.min(1, parseFloat(cNoiseMatch[1]) || 0));
      rv = rv.substring(0, cNoiseMatch.index!).trim() + ' ' + rv.substring(cNoiseMatch.index! + cNoiseMatch[0].length).trim();
    }
    const cSpeedMatch = rv.match(/(?:at\s+)?speed\s+(.+?)(?=\s+(?:x|y|z|noise)\s+|$)/i);
    if (cSpeedMatch) {
      const speedValue = cSpeedMatch[1].trim();
      const speedInterp = InterpolationData.parse(speedValue);
      if (speedInterp) {
        s.moveSpeedInterpolation = speedInterp;
        s.wanderHz = RangeOrValue.single(speedInterp.minValue);
      } else {
        s.wanderHz = RangeOrValue.parse(speedValue);
      }
      rv = rv.substring(0, cSpeedMatch.index!).trim() + rv.substring(cSpeedMatch.index! + cSpeedMatch[0].length).trim();
    }

    let cxMin = -5, cxMax = 5, cyMin = -5, cyMax = 5, czMin = -5, czMax = 5;
    const cxMatch = rv.match(/x\s+(-?[\d.]+)to(-?[\d.]+)/i);
    if (cxMatch) { cxMin = parseFloat(cxMatch[1]); cxMax = parseFloat(cxMatch[2]); }
    const cyMatch = rv.match(/y\s+(-?[\d.]+)to(-?[\d.]+)/i);
    if (cyMatch) { cyMin = parseFloat(cyMatch[1]); cyMax = parseFloat(cyMatch[2]); }
    const czMatch = rv.match(/z\s+(-?[\d.]+)to(-?[\d.]+)/i);
    if (czMatch) { czMin = parseFloat(czMatch[1]); czMax = parseFloat(czMatch[2]); }

    s.areaMin = { x: cxMin, y: cyMin, z: czMin };
    s.areaMax = { x: cxMax, y: cyMax, z: czMax };
    return;
  }

  // New flexible syntax — detect and strip leading walk/fly keyword before axis parsing
  let detectedType: 'walk' | 'fly' | null = null;
  const typeMatch = v.match(/^(walk|fly)\b\s*/i);
  if (typeMatch) {
    detectedType = typeMatch[1].toLowerCase() as 'walk' | 'fly';
    v = v.substring(typeMatch[0].length);
  }

  // Extract noise if present (works for walk/fly/axis moves)
  const wfNoiseMatch = v.match(/\bnoise\s+([\d.]+)/i);
  if (wfNoiseMatch) {
    s.noise = Math.max(0, Math.min(1, parseFloat(wfNoiseMatch[1]) || 0));
    v = v.substring(0, wfNoiseMatch.index!).trim() + ' ' + v.substring(wfNoiseMatch.index! + wfNoiseMatch[0].length).trim();
    v = v.trim();
  }

  let xMin = -5, xMax = 5, yMin = -5, yMax = 5, zMin = -5, zMax = 5;
  let speed = 1;
  let moveType = WanderType.None;
  let hasX = false, hasY = false, hasZ = false;

  // Extract speed
  let speedParsed = false;
  const speedMatch = v.match(/(?:at\s+)?speed\s+(.+?)(?=\s+(?:x|y|z)\s+|$)/i);
  if (speedMatch) {
    const speedValue = speedMatch[1].trim();
    const speedInterp = InterpolationData.parse(speedValue);
    if (speedInterp) {
      s.moveSpeedInterpolation = speedInterp;
      s.wanderHz = RangeOrValue.single(speedInterp.minValue);
    } else {
      s.wanderHz = RangeOrValue.parse(speedValue);
    }
    speed = s.wanderHz.min;
    speedParsed = true;
    v = v.substring(0, speedMatch.index!).trim();
  }

  // Check for bare "walk" or "fly" (no axes remaining after stripping)
  if (!v.trim() || v.toLowerCase() === 'walk' || v.toLowerCase() === 'fly') {
    const isFly = detectedType === 'fly' || v.toLowerCase() === 'fly';
    if (isFly) {
      s.wanderType = WanderType.Fly;
      s.areaMin = { x: -5, y: -5, z: -5 };
      s.areaMax = { x: 5, y: 5, z: 5 };
    } else {
      s.wanderType = WanderType.Walk;
      s.areaMin = { x: -5, y: 0, z: -5 };
      s.areaMax = { x: 5, y: 0, z: 5 };
    }
    if (!speedParsed) s.wanderHz = RangeOrValue.single(speed);
    return;
  }

  // Remove "and" between axes
  v = v.replace(/\s+and\s+(?=(?:x|y|z)\s+)/gi, ' ');

  // Parse each axis
  const parseAxis = (
    axis: string,
    otherAxes: string,
  ): {
    min: number;
    max: number;
    minInterp: InterpolationData | null;
    maxInterp: InterpolationData | null;
    found: boolean;
  } => {
    const axisRx = new RegExp(`${axis}\\s+(.+?)(?=\\s+(?:${otherAxes}|speed)\\s+|$)`, 'i');
    const match = v.match(axisRx);
    if (!match) return { min: -5, max: 5, minInterp: null, maxInterp: null, found: false };

    const axisValue = match[1].trim();
    let minVal = -5, maxVal = 5;
    let minInterp: InterpolationData | null = null;
    let maxInterp: InterpolationData | null = null;

    const rangeMatch = axisValue.match(/^(.+?)\s*to\s*(.+?)$/);
    if (rangeMatch && !axisValue.startsWith('goto') && !axisValue.startsWith('gobetween')) {
      const leftPart = rangeMatch[1].trim();
      const rightPart = rangeMatch[2].trim();

      const leftInterp = InterpolationData.parse(leftPart);
      const rightInterp = InterpolationData.parse(rightPart);

      minVal = leftInterp ? leftInterp.minValue : parseFloat(leftPart);
      maxVal = rightInterp ? rightInterp.minValue : parseFloat(rightPart);
      minInterp = leftInterp;
      maxInterp = rightInterp;
    } else {
      const interp = InterpolationData.parse(axisValue);
      if (interp) {
        minInterp = interp;
        maxInterp = interp;
        minVal = interp.minValue;
        maxVal = interp.maxValue;
      } else {
        [minVal, maxVal] = parseRange(axisValue);
      }
    }

    return { min: minVal, max: maxVal, minInterp, maxInterp, found: true };
  };

  const xResult = parseAxis('x', 'y|z');
  if (xResult.found) {
    hasX = true;
    xMin = xResult.min; xMax = xResult.max;
    s.moveXMinInterpolation = xResult.minInterp;
    s.moveXMaxInterpolation = xResult.maxInterp;
  }

  const yResult = parseAxis('y', 'x|z');
  if (yResult.found) {
    hasY = true;
    yMin = yResult.min; yMax = yResult.max;
    s.moveYMinInterpolation = yResult.minInterp;
    s.moveYMaxInterpolation = yResult.maxInterp;
  }

  const zResult = parseAxis('z', 'x|y');
  if (zResult.found) {
    hasZ = true;
    zMin = zResult.min; zMax = zResult.max;
    s.moveZMinInterpolation = zResult.minInterp;
    s.moveZMaxInterpolation = zResult.maxInterp;
  }

  // Determine movement type
  if (hasX && hasY && hasZ) {
    moveType = WanderType.Fly;
  } else if (hasX && hasZ && !hasY) {
    moveType = WanderType.Walk;
    yMin = 0; yMax = 0;
  } else if ((hasX && hasY) || (hasY && hasZ)) {
    moveType = WanderType.Fly;
    if (!hasX) { xMin = -5; xMax = 5; }
    if (!hasY) { yMin = -5; yMax = 5; }
    if (!hasZ) { zMin = -5; zMax = 5; }
  } else if (hasX || hasZ) {
    moveType = WanderType.Walk;
    yMin = 0; yMax = 0;
    if (!hasX) { xMin = 0; xMax = 0; }
    if (!hasZ) { zMin = 0; zMax = 0; }
  } else if (hasY) {
    moveType = WanderType.Fly;
    xMin = xMax = 0;
    zMin = zMax = 0;
  }

  if (moveType !== WanderType.None) {
    s.wanderType = moveType;
    s.areaMin = { x: xMin, y: yMin, z: zMin };
    s.areaMax = { x: xMax, y: yMax, z: zMax };
    if (!speedParsed) s.wanderHz = RangeOrValue.single(speed);
  } else if (detectedType === null && /^\w+/.test(v.trim())) {
    // Unrecognized name — treat as a pending custom trajectory (may match a gen block)
    const pendingName = v.trim().split(/\s+/)[0].toLowerCase();
    s.wanderType = WanderType.Custom;
    s.customTrajectoryName = pendingName;
    s.areaMin = { x: -5, y: -5, z: -5 };
    s.areaMax = { x: 5, y: 5, z: 5 };
  } else {
    throw new SatieSyntaxError(
      "Invalid move syntax. Use 'move fly', 'move walk', or specify axes like 'move x -5to5 z -10to10'",
      'move',
      v,
    );
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  return { r, g, b };
}

function parseColor(s: Statement, v: string): void {
  v = v.trim();
  if (!v) return;

  // Named channel syntax: red 255 green gobetween(...) alpha 0.5
  if (v.includes('red ') || v.includes('green ') || v.includes('blue ') || v.includes('alpha ')) {
    const normalized = v.replace(/ and /g, ' ');
    const parseChannel = (channel: string, otherChannels: string) => {
      const rx = new RegExp(`${channel}\\s+(.+?)(?=\\s+(?:${otherChannels})\\s+|$)`, 'i');
      const match = normalized.match(rx);
      if (match) parseColorChannel(s, channel, match[1].trim());
    };
    parseChannel('red', 'green|blue|alpha');
    parseChannel('green', 'red|blue|alpha');
    parseChannel('blue', 'red|green|alpha');
    parseChannel('alpha', 'red|green|blue');
    return;
  }

  // Hex gobetween: gobetween(#000000to#FFFFFF as ease in dur)
  const hexGbMatch = v.match(
    /gobetween\s*\(\s*#([0-9A-Fa-f]{6})to#([0-9A-Fa-f]{6})\s*(?:as\s+(?<ease>\w+))?\s+in\s+(?<dur>-?[\d.]+(?:to-?[\d.]+)?)\s*\)/,
  );
  if (hexGbMatch) {
    const startC = hexToRgb(hexGbMatch[1]);
    const endC = hexToRgb(hexGbMatch[2]);
    const ease = hexGbMatch.groups?.ease ?? 'linear';
    const dur = RangeOrValue.parse(hexGbMatch.groups!.dur);
    for (const [channel, startVal, endVal] of [
      ['R', startC.r, endC.r],
      ['G', startC.g, endC.g],
      ['B', startC.b, endC.b],
    ] as const) {
      const prop = `color${channel}Interpolation` as keyof Statement;
      (s as any)[prop] = new InterpolationData(
        RangeOrValue.single(startVal), RangeOrValue.single(endVal),
        ease, dur, 1, true, InterpolationType.GoBetween,
      );
    }
    return;
  }

  // Single-channel grayscale gobetween: gobetween(0,255 in 5)
  const grayGbMatch = v.match(
    /gobetween\s*\(\s*(?<min>-?[\d.]+)\s*,\s*(?<max>-?[\d.]+)\s+in\s+(?<dur>-?[\d.]+(?:to-?[\d.]+)?)\s*\)/,
  );
  if (grayGbMatch) {
    const min = parseFloat(grayGbMatch.groups!.min) / 255;
    const max = parseFloat(grayGbMatch.groups!.max) / 255;
    const dur = RangeOrValue.parse(grayGbMatch.groups!.dur);
    for (const channel of ['Red', 'Green', 'Blue'] as const) {
      const prop = `color${channel}Interpolation` as keyof Statement;
      (s as any)[prop] = new InterpolationData(
        RangeOrValue.single(min), RangeOrValue.single(max),
        'linear', dur, 1, true, InterpolationType.GoBetween,
      );
    }
    return;
  }

  // Hex static: #F54927
  if (v.startsWith('#') && v.length === 7) {
    s.staticColor = v;
    return;
  }

  // RGB: 255,100,50
  const rgbMatch = v.match(/^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/);
  if (rgbMatch) {
    const r = Math.round(parseFloat(rgbMatch[1]));
    const g = Math.round(parseFloat(rgbMatch[2]));
    const b = Math.round(parseFloat(rgbMatch[3]));
    s.staticColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    return;
  }

  // Named colors
  const namedColors: Record<string, string> = {
    white: '#ffffff', black: '#000000', red: '#ff0000', green: '#00ff00',
    blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff',
    gray: '#808080', grey: '#808080',
  };
  if (namedColors[v.toLowerCase()]) {
    s.staticColor = namedColors[v.toLowerCase()];
  }
}

function parseColorChannel(s: Statement, channelName: string, value: string): void {
  const isAlpha = channelName.toLowerCase() === 'alpha';

  // Alpha: don't normalize 0-255 → 0-1, it's already 0-1
  if (isAlpha) {
    if (hasInterpolation(value)) {
      s.colorAlphaInterpolation = InterpolationData.parse(value);
    } else {
      const v = parseFloat(value);
      if (!isNaN(v)) s.staticAlpha = Math.max(0, Math.min(1, v));
    }
    return;
  }

  if (hasInterpolation(value)) {
    let interp = InterpolationData.parse(value);
    if (interp) {
      // Normalize 0-255 to 0-1
      const minCheck = interp.minRange.isRange ? Math.max(interp.minRange.min, interp.minRange.max) : interp.minRange.min;
      const maxCheck = interp.maxRange.isRange ? Math.max(interp.maxRange.min, interp.maxRange.max) : interp.maxRange.min;
      if (minCheck > 1 || maxCheck > 1) {
        const normalizedMin = interp.minRange.isRange
          ? RangeOrValue.range(interp.minRange.min / 255, interp.minRange.max / 255)
          : RangeOrValue.single(interp.minRange.min / 255);
        const normalizedMax = interp.maxRange.isRange
          ? RangeOrValue.range(interp.maxRange.min / 255, interp.maxRange.max / 255)
          : RangeOrValue.single(interp.maxRange.min / 255);
        interp = new InterpolationData(normalizedMin, normalizedMax, interp.easeName, interp.durationRange, interp.repeatCount, interp.isForever, interp.interpolationType);
      }
      switch (channelName.toLowerCase()) {
        case 'red': s.colorRedInterpolation = interp; break;
        case 'green': s.colorGreenInterpolation = interp; break;
        case 'blue': s.colorBlueInterpolation = interp; break;
      }
    }
  } else {
    // Plain value or range (e.g. "128" or "0to255")
    // Store as a RangeOrValue so each voice can sample independently
    const range = RangeOrValue.parse(value);
    // Normalize 0-255 to 0-1
    const normalizedRange = (range.max > 1 || range.min > 1)
      ? (range.isRange ? RangeOrValue.range(range.min / 255, range.max / 255) : RangeOrValue.single(range.min / 255))
      : range;
    switch (channelName.toLowerCase()) {
      case 'red': s.colorRedRange = normalizedRange; break;
      case 'green': s.colorGreenRange = normalizedRange; break;
      case 'blue': s.colorBlueRange = normalizedRange; break;
    }
  }
}

// DSP effect parsers

function parseDSPParam(v: string, paramRx: RegExp): { range: RangeOrValue; interp: InterpolationData | null } | null {
  const match = v.match(paramRx);
  if (!match) return null;
  const val = match[1].trim();
  if (hasInterpolation(val)) return { range: RangeOrValue.Null, interp: InterpolationData.parse(val) };
  return { range: RangeOrValue.parse(val), interp: null };
}

function parseReverb(s: Statement, v: string): void {
  const wet = parseDSPParam(v, /\b(?:wet|drywet)\s+(.+?)(?=\s+(?:size|roomsize|damp|damping)\s+|$)/i);
  const size = parseDSPParam(v, /\b(?:size|roomsize)\s+(.+?)(?=\s+(?:wet|drywet|damp|damping)\s+|$)/i);
  const damp = parseDSPParam(v, /\b(?:damp|damping)\s+(.+?)(?=\s+(?:wet|drywet|size|roomsize)\s+|$)/i);

  s.reverbParams = {
    dryWet: wet?.range ?? RangeOrValue.single(0.33),
    roomSize: size?.range ?? RangeOrValue.single(0.5),
    damping: damp?.range ?? RangeOrValue.single(0.5),
    dryWetInterpolation: wet?.interp ?? null,
    roomSizeInterpolation: size?.interp ?? null,
    dampingInterpolation: damp?.interp ?? null,
  };
}

function parseDelay(s: Statement, v: string): void {
  const wet = parseDSPParam(v, /\b(?:wet|drywet)\s+(.+?)(?=\s+(?:time|feedback|pingpong)\s+|$)/i);
  const time = parseDSPParam(v, /\btime\s+(.+?)(?=\s+(?:wet|drywet|feedback|pingpong)\s+|$)/i);
  const fb = parseDSPParam(v, /\bfeedback\s+(.+?)(?=\s+(?:wet|drywet|time|pingpong)\s+|$)/i);
  const pp = parseDSPParam(v, /\bpingpong\s+(.+?)(?=\s+(?:wet|drywet|time|feedback)\s+|$)/i);

  s.delayParams = {
    dryWet: wet?.range ?? RangeOrValue.single(0.5),
    time: time?.range ?? RangeOrValue.single(0.375),
    feedback: fb?.range ?? RangeOrValue.single(0.5),
    pingPong: pp ? pp.range.sample() > 0.5 : false,
    dryWetInterpolation: wet?.interp ?? null,
    timeInterpolation: time?.interp ?? null,
    feedbackInterpolation: fb?.interp ?? null,
  };
}

function parseFilter(s: Statement, v: string): void {
  const modeMatch = v.match(/\bmode\s+(lowpass|highpass|bandpass|notch|peak)/i);
  const cutoff = parseDSPParam(v, /\b(?:cutoff|freq)\s+(.+?)(?=\s+(?:mode|resonance|q|wet|drywet)\s+|$)/i);
  const res = parseDSPParam(v, /\b(?:resonance|q)\s+(.+?)(?=\s+(?:mode|cutoff|freq|wet|drywet)\s+|$)/i);
  const wet = parseDSPParam(v, /\b(?:wet|drywet)\s+(.+?)(?=\s+(?:mode|cutoff|freq|resonance|q)\s+|$)/i);

  s.filterParams = {
    mode: modeMatch ? modeMatch[1].toLowerCase() : 'lowpass',
    cutoff: cutoff?.range ?? RangeOrValue.single(1000),
    resonance: res?.range ?? RangeOrValue.single(1),
    dryWet: wet?.range ?? RangeOrValue.single(1),
    cutoffInterpolation: cutoff?.interp ?? null,
    resonanceInterpolation: res?.interp ?? null,
    dryWetInterpolation: wet?.interp ?? null,
  };
}

function parseDistortion(s: Statement, v: string): void {
  const modeMatch = v.match(/\bmode\s+(softclip|hardclip|tanh|cubic|asymmetric)/i);
  const drive = parseDSPParam(v, /\bdrive\s+(.+?)(?=\s+(?:mode|wet|drywet)\s+|$)/i);
  const wet = parseDSPParam(v, /\b(?:wet|drywet)\s+(.+?)(?=\s+(?:mode|drive)\s+|$)/i);

  s.distortionParams = {
    mode: modeMatch ? modeMatch[1].toLowerCase() : 'softclip',
    drive: drive?.range ?? RangeOrValue.single(1),
    dryWet: wet?.range ?? RangeOrValue.single(1),
    driveInterpolation: drive?.interp ?? null,
    dryWetInterpolation: wet?.interp ?? null,
  };
}

function parseEQ(s: Statement, v: string): void {
  const low = parseDSPParam(v, /\blow\s+(.+?)(?=\s+(?:mid|high)\s+|$)/i);
  const mid = parseDSPParam(v, /\bmid\s+(.+?)(?=\s+(?:low|high)\s+|$)/i);
  const high = parseDSPParam(v, /\bhigh\s+(.+?)(?=\s+(?:low|mid)\s+|$)/i);

  s.eqParams = {
    lowGain: low?.range ?? RangeOrValue.single(0),
    midGain: mid?.range ?? RangeOrValue.single(0),
    highGain: high?.range ?? RangeOrValue.single(0),
    lowGainInterpolation: low?.interp ?? null,
    midGainInterpolation: mid?.interp ?? null,
    highGainInterpolation: high?.interp ?? null,
  };
}

// Flush group properties into children
function flushGroup(dst: Statement[], g: GroupCtx): void {
  const hasVol = g.props.has('volume');
  const hasPitch = g.props.has('pitch');
  const hasColor = g.props.has('color');

  let groupVolInterp: InterpolationData | null = null;
  let groupPitchInterp: InterpolationData | null = null;
  let gVolRange = RangeOrValue.One;
  let gPitchRange = RangeOrValue.One;

  if (hasVol) {
    const vRaw = g.props.get('volume')!;
    if (hasInterpolation(vRaw)) groupVolInterp = InterpolationData.parse(vRaw);
    else gVolRange = RangeOrValue.parse(vRaw);
  }

  if (hasPitch) {
    const pRaw = g.props.get('pitch')!;
    if (hasInterpolation(pRaw)) groupPitchInterp = InterpolationData.parse(pRaw);
    else gPitchRange = RangeOrValue.parse(pRaw);
  }

  // Group color
  let groupColorR: InterpolationData | null = null;
  let groupColorG: InterpolationData | null = null;
  let groupColorB: InterpolationData | null = null;
  let groupStaticColor: string | null = null;

  if (hasColor) {
    const tempStmt = new Statement();
    parseColor(tempStmt, g.props.get('color')!);
    groupStaticColor = tempStmt.staticColor;
    groupColorR = tempStmt.colorRedInterpolation;
    groupColorG = tempStmt.colorGreenInterpolation;
    groupColorB = tempStmt.colorBlueInterpolation;
  }

  for (const s of g.children) {
    if (groupVolInterp && !s.volumeInterpolation) s.volumeInterpolation = groupVolInterp;
    if (groupPitchInterp && !s.pitchInterpolation) s.pitchInterpolation = groupPitchInterp;

    if (hasColor) {
      if (groupStaticColor && !s.staticColor) s.staticColor = groupStaticColor;
      if (groupColorR && !s.colorRedInterpolation) s.colorRedInterpolation = groupColorR;
      if (groupColorG && !s.colorGreenInterpolation) s.colorGreenInterpolation = groupColorG;
      if (groupColorB && !s.colorBlueInterpolation) s.colorBlueInterpolation = groupColorB;
    }

    // Volume and pitch multiply with group values (sample per statement for unique randoms)
    const gVol = gVolRange.sample();
    const gPitch = gPitchRange.sample();

    if (hasVol && !groupVolInterp) {
      s.volume = !s.volume.isNull ? s.volume.mul(gVol) : RangeOrValue.single(gVol);
    }

    if (hasPitch && !groupPitchInterp) {
      s.pitch = !s.pitch.isNull ? s.pitch.mul(gPitch) : RangeOrValue.single(gPitch);
    }

    // Apply other group properties as defaults
    for (const [key, val] of g.props) {
      switch (key) {
        case 'volume': case 'pitch': case 'color': break;
        case 'starts_at': // Legacy alias
        case 'start': if (s.start.isNull) s.start = RangeOrValue.parse(val); break;
        case 'end': if (s.end.isNull) parseEnd(s, val); break;
        case 'duration': if (s.duration.isNull) s.duration = RangeOrValue.parse(val); break;
        case 'fade_in': if (s.fadeIn.isNull) s.fadeIn = RangeOrValue.parse(val); break;
        case 'fade_out': if (s.fadeOut.isNull) s.fadeOut = RangeOrValue.parse(val); break;
        case 'every': if (s.every.isNull) s.every = RangeOrValue.parse(val); break;
        case 'overlap': s.overlap = true; break;
        case 'persistent': s.persistent = true; break;
        case 'mute': s.mute = true; break;
        case 'solo': s.solo = true; break;
        case 'random_start': case 'randomstart': s.randomStart = true; break;
      }
    }

    dst.push(s);
  }
}

// ============ AND PRE-PASS ============

/** Property keywords that trigger `and` splitting. */
const PROPERTY_KEYWORDS = new Set([
  'volume', 'pitch', 'duration', 'move', 'filter', 'reverb', 'delay',
  'distortion', 'eq', 'color', 'visual', 'influence', 'loopable',
  'randomstart', 'random_start', 'fadein', 'fade_in', 'fadeout', 'fade_out',
  'overlap', 'persistent', 'mute', 'solo', 'start', 'end', 'every', 'alpha',
  'prompt',
]);

/**
 * Pre-pass: expand ` and <keyword>` into indented newlines.
 * `and` is only treated as a separator when followed by a property keyword.
 * e.g. `visual trail sphere` keeps `and` as literal since `sphere` is not a keyword.
 */
function expandAndSeparators(lines: string[]): string[] {
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    const indent = line.substring(0, line.length - trimmed.length);

    // Only expand on statement lines or indented property lines
    // Split on ` and ` where the next word is a property keyword
    // Use a global regex to find all ` and <word>` occurrences and split at keyword ones
    const parts: string[] = [];
    const andRx = /\s+and\s+(\w+)/gi;
    let lastSplitEnd = 0;
    let m: RegExpExecArray | null;
    while ((m = andRx.exec(trimmed)) !== null) {
      const nextWord = m[1].toLowerCase();
      if (PROPERTY_KEYWORDS.has(nextWord)) {
        parts.push(trimmed.substring(lastSplitEnd, m.index));
        lastSplitEnd = m.index + m[0].length - m[1].length; // keep the keyword
      }
    }
    parts.push(trimmed.substring(lastSplitEnd));

    if (parts.length === 1) {
      result.push(line);
    } else {
      // First part keeps original indent, subsequent parts get extra indent
      result.push(indent + parts[0]);
      const propIndent = indent + (indent.length > 0 ? '  ' : '    ');
      for (let i = 1; i < parts.length; i++) {
        result.push(propIndent + parts[i]);
      }
    }
  }
  return result;
}

// ============ VARIABLE EXTRACTION & SUBSTITUTION ============

/** Words that cannot be used as variable names. */
const RESERVED_WORDS = new Set([
  ...PROPERTY_KEYWORDS,
  'loop', 'oneshot', 'group', 'endgroup', 'gen', 'comment', 'endcomment', 'let',
  'and', 'in', 'as', 'for', 'ever', 'at', 'to', 'fade',
  'walk', 'fly', 'fixed', 'pos', 'spiral', 'orbit', 'lorenz',
  'goto', 'gobetween', 'interpolate',
  'x', 'y', 'z',
  'wet', 'drywet', 'size', 'roomsize', 'damping', 'damp', 'time',
  'feedback', 'pingpong', 'mode', 'cutoff', 'freq', 'resonance',
  'drive', 'low', 'mid', 'high', 'speed',
  'lowpass', 'highpass', 'bandpass', 'notch', 'peak',
  'softclip', 'hardclip', 'tanh', 'cubic', 'asymmetric',
  'red', 'green', 'blue', 'white', 'black', 'yellow', 'cyan', 'magenta', 'gray', 'grey',
  'sphere', 'trail', 'object', 'audio',
]);

/**
 * Extract variable definitions (`let name value` or bare `name value` at top level)
 * and substitute references in all other lines.
 *
 * Clip name positions in statement lines are protected from substitution.
 * Variable names cannot be reserved words.
 */
function extractAndSubstituteVariables(lines: string[]): string[] {
  const vars = new Map<string, string>();
  const varLineIndices = new Set<number>();

  // Pass 1: collect variable definitions
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (countIndent(line) > 0) continue; // variables must be top-level

    // Skip structural keywords
    if (/^(?:loop|oneshot|group|endgroup|gen|comment|endcomment)\b/i.test(trimmed)) continue;

    // `let name value` syntax
    let varMatch = trimmed.match(/^let\s+([a-zA-Z_]\w*)\s+(.+?)(?:\s+#.*)?$/);
    if (!varMatch) {
      // Bare `name value` syntax — name must not be a reserved word
      varMatch = trimmed.match(/^([a-zA-Z_]\w*)\s+(.+?)(?:\s+#.*)?$/);
      if (varMatch && RESERVED_WORDS.has(varMatch[1].toLowerCase())) {
        varMatch = null;
      }
    }

    if (varMatch) {
      vars.set(varMatch[1], varMatch[2].trim());
      varLineIndices.add(i);
    }
  }

  if (vars.size === 0) return lines;

  // Build a single regex matching any variable name (longest first for safety)
  const varNames = Array.from(vars.keys()).sort((a, b) => b.length - a.length);
  const varRx = new RegExp(`\\b(${varNames.map(escapeRegex).join('|')})\\b`, 'g');

  // Pass 2: substitute references, remove definition lines
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (varLineIndices.has(i)) continue;

    let line = lines[i];
    const trimmed = line.trimStart();

    // For statement lines, protect the clip name from substitution
    const stmtMatch = trimmed.match(/^((?:\d+\s*\*\s*)?(?:loop|oneshot)\s+)(\S+)(.*)/i);
    if (stmtMatch) {
      const indent = line.substring(0, line.length - trimmed.length);
      const rest = stmtMatch[3].replace(varRx, (m) => vars.get(m) ?? m);
      line = indent + stmtMatch[1] + stmtMatch[2] + rest;
    } else {
      line = line.replace(varRx, (m) => vars.get(m) ?? m);
    }

    result.push(line);
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============ MULTI-CLIP EXPANSION ============

/**
 * Expand multi-clip `and` syntax into separate statements.
 *
 * `oneshot bird and rain and lizard every 5` becomes three separate oneshot statements.
 * `loop gen bird and gen rain every 5` becomes two separate gen statements.
 *
 * Each segment must be either a single word (plain clip) or start with `gen ` (gen clip).
 * If any segment is ambiguous, the line is left unchanged.
 */
function expandMultiClip(lines: string[]): string[] {
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const lineIndent = line.substring(0, line.length - trimmed.length);

    // Match statement header
    const headerMatch = trimmed.match(/^((?:\d+\s*\*\s*)?)(loop|oneshot)\s+(.+)$/i);

    if (headerMatch && headerMatch[3].includes(' and ')) {
      const countPrefix = headerMatch[1];
      const kind = headerMatch[2];
      let rest = headerMatch[3];

      // Strip inline comment
      let comment = '';
      const commentMatch = rest.match(/\s+#.*$/);
      if (commentMatch) {
        comment = commentMatch[0];
        rest = rest.substring(0, rest.length - commentMatch[0].length);
      }

      // Strip every clause (value is a single non-space token like 5 or 5to10)
      let everyClause = '';
      const everyMatch = rest.match(/\s+every\s+\S+$/i);
      if (everyMatch) {
        everyClause = everyMatch[0];
        rest = rest.substring(0, rest.length - everyMatch[0].length);
      }

      // rest is now the clips area
      // If clips area starts with `gen `, only split on ` and gen ` or ` and <single-word>`
      // to avoid breaking multi-word gen prompts containing `and`
      const startsWithGen = rest.toLowerCase().startsWith('gen ');
      const segments = startsWithGen
        ? rest.split(/\s+and\s+(?=gen\s)/i)  // only split before another `gen`
        : rest.split(/\s+and\s+/);

      // Validate: each segment is a single word (plain clip) or starts with `gen `
      const allValid = segments.length > 1 && segments.every(seg => {
        const s = seg.trim();
        return s.length > 0 && (!s.includes(' ') || s.toLowerCase().startsWith('gen '));
      });

      if (allValid) {
        // Collect indented property block
        const stmtIndent = countIndent(line);
        const block: string[] = [];
        let j = i + 1;
        while (j < lines.length && countIndent(lines[j]) > stmtIndent) {
          block.push(lines[j]);
          j++;
        }

        // Emit one statement per clip
        for (const seg of segments) {
          result.push(`${lineIndent}${countPrefix}${kind} ${seg.trim()}${everyClause}${comment}`);
          for (const blockLine of block) {
            result.push(blockLine);
          }
        }

        i = j;
        continue;
      }
    }

    result.push(line);
    i++;
  }

  return result;
}

// ============ GEN BLOCK EXTRACTION ============

const GenBlockRx = /^gen\s+(\w+)\s*(?:#.*)?$/i;

/**
 * Extract `gen <name>` blocks from the script lines.
 * Returns the gen definitions map and the remaining lines with gen blocks removed.
 */
function extractGenBlocks(lines: string[]): { genDefs: Map<string, GenDefinition>; remaining: string[] } {
  const genDefs = new Map<string, GenDefinition>();
  const remaining: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trimStart();
    const m = trimmed.match(GenBlockRx);

    if (m) {
      const name = m[1];
      const blockIndent = countIndent(lines[i]);
      i++;

      // Consume indented lines
      let prompt = '';
      let duration = RangeOrValue.Null;
      let influence = RangeOrValue.Null;
      let loopable = false;

      while (i < lines.length) {
        const lineIndent = countIndent(lines[i]);
        const lineTrimmed = lines[i].trimStart();
        if (!lineTrimmed || lineTrimmed.startsWith('#')) { i++; continue; }
        if (lineIndent <= blockIndent) break;

        const propMatch = lineTrimmed.match(/^(\w+)(?:\s+(.+))?$/);
        if (propMatch) {
          const key = propMatch[1].toLowerCase();
          const val = propMatch[2]?.trim() ?? '';
          switch (key) {
            case 'prompt': prompt = val; break;
            case 'duration': duration = RangeOrValue.parse(val); break;
            case 'influence': influence = RangeOrValue.parse(val); break;
            case 'loopable': loopable = true; break;
            default:
              console.warn(`[Satie] Unknown gen property '${key}' in gen block '${name}'`);
          }
        }
        i++;
      }

      if (!prompt) {
        throw new SatieSyntaxError(
          `Gen block '${name}' is missing a 'prompt' property`,
          'prompt', null, `gen ${name}`,
        );
      }

      // Clamp duration
      if (!duration.isNull) {
        const clampVal = (v: number) => Math.max(0.5, Math.min(22, v));
        duration = duration.isRange
          ? RangeOrValue.range(clampVal(duration.min), clampVal(duration.max))
          : RangeOrValue.single(clampVal(duration.min));
      }

      // Clamp influence
      if (!influence.isNull) {
        const clampVal = (v: number) => Math.max(0, Math.min(1, v));
        influence = influence.isRange
          ? RangeOrValue.range(clampVal(influence.min), clampVal(influence.max))
          : RangeOrValue.single(clampVal(influence.min));
      }

      if (genDefs.has(name)) {
        console.warn(`[Satie] Duplicate gen definition '${name}' — last one wins`);
      }

      genDefs.set(name, { name, prompt, duration, influence, loopable });
    } else {
      remaining.push(lines[i]);
      i++;
    }
  }

  return { genDefs, remaining };
}

// ============ TRAJECTORY GEN BLOCK EXTRACTION ============

const TrajGenBlockRx = /^gen\s+(\w+)\s*$/i;

/**
 * Detect trajectory gen blocks — differentiated from audio gen blocks by their properties.
 * A gen block is a trajectory gen if it contains any of: smoothing, resolution, seed, ground, variation.
 * Otherwise it's treated as audio gen (existing behavior).
 *
 * This runs as a second pass on the extracted gen blocks — if a genDef has trajectory-specific
 * properties, it's moved from genDefs to trajGenDefs.
 */
function extractTrajectoryGenBlocks(
  lines: string[],
): { trajGenDefs: Map<string, TrajectoryGenDefinition>; remaining: string[] } {
  const trajGenDefs = new Map<string, TrajectoryGenDefinition>();
  const remaining: string[] = [];
  let i = 0;

  // Trajectory-specific keywords that distinguish from audio gen
  const TRAJ_KEYWORDS = new Set(['smoothing', 'resolution', 'seed', 'ground', 'variation']);

  while (i < lines.length) {
    const trimmed = lines[i].trimStart();
    const m = trimmed.match(TrajGenBlockRx);

    if (m) {
      const name = m[1];
      const blockIndent = countIndent(lines[i]);
      const blockStartIdx = i;
      i++;

      // Peek at properties to determine if this is a trajectory gen block
      const blockLines: string[] = [];
      let isTraj = false;
      const peekIdx = i;

      while (i < lines.length) {
        const lineIndent = countIndent(lines[i]);
        const lineTrimmed = lines[i].trimStart();
        if (!lineTrimmed || lineTrimmed.startsWith('#')) { blockLines.push(lines[i]); i++; continue; }
        if (lineIndent <= blockIndent) break;
        blockLines.push(lines[i]);

        const propMatch = lineTrimmed.match(/^(\w+)(?:\s+(.+))?$/);
        if (propMatch && TRAJ_KEYWORDS.has(propMatch[1].toLowerCase())) {
          isTraj = true;
        }
        i++;
      }

      if (isTraj) {
        // Parse trajectory gen properties
        let prompt = '';
        let duration = 30;
        let resolution = 8192;
        let smoothing = 0;
        let seed = 0;
        let ground = false;
        let variation = 0.5;

        for (const bline of blockLines) {
          const lt = bline.trimStart();
          if (!lt || lt.startsWith('#')) continue;
          const propMatch = lt.match(/^(\w+)(?:\s+(.+))?$/);
          if (!propMatch) continue;
          const key = propMatch[1].toLowerCase();
          const val = propMatch[2]?.trim() ?? '';
          switch (key) {
            case 'prompt': prompt = val; break;
            case 'duration': { const n = parseFloat(val); if (!isNaN(n)) duration = Math.max(1, Math.min(120, n)); break; }
            case 'resolution': { const n = parseInt(val); if (!isNaN(n)) resolution = Math.max(256, Math.min(32768, n)); break; }
            case 'smoothing': { const n = parseFloat(val); if (!isNaN(n)) smoothing = Math.max(0, Math.min(1, n)); break; }
            case 'seed': { const n = parseInt(val); if (!isNaN(n)) seed = n; break; }
            case 'ground': ground = true; break;
            case 'variation': { const n = parseFloat(val); if (!isNaN(n)) variation = Math.max(0, Math.min(1, n)); break; }
            default:
              console.warn(`[Satie] Unknown trajectory gen property '${key}' in gen block '${name}'`);
          }
        }

        if (!prompt) {
          throw new SatieSyntaxError(
            `Trajectory gen block '${name}' is missing a 'prompt' property`,
            'prompt', null, `gen ${name}`,
          );
        }

        trajGenDefs.set(name, { name, prompt, duration, resolution, smoothing, seed, ground, variation });
      } else {
        // Not a trajectory gen — put original lines back for audio gen extraction
        remaining.push(lines[blockStartIdx]);
        for (const bl of blockLines) remaining.push(bl);
      }
    } else {
      remaining.push(lines[i]);
      i++;
    }
  }

  return { trajGenDefs, remaining };
}

// ============ MAIN PARSE FUNCTION ============

export function parse(script: string): Statement[] {
  const rawLines = script.replace(/\r\n/g, '\n').split('\n');

  // Pre-pass 1: expand `and <keyword>` into indented property lines
  const expandedLines = expandAndSeparators(rawLines);

  // Pre-pass 2: extract variable definitions and substitute references
  const substitutedLines = extractAndSubstituteVariables(expandedLines);

  // Pre-pass 3: expand multi-clip `and` into separate statements
  const multiClipLines = expandMultiClip(substitutedLines);

  // Pre-pass 4: extract trajectory gen blocks (before audio gen, same syntax differentiated by keywords)
  const { trajGenDefs, remaining: afterTrajGen } = extractTrajectoryGenBlocks(multiClipLines);

  // Pre-pass 5: extract audio gen blocks
  const { genDefs, remaining: lines } = extractGenBlocks(afterTrajGen);

  const outList: Statement[] = [];
  let grp: GroupCtx | null = null;
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trimStart();

    if (trimmed.toLowerCase().startsWith('comment')) { inBlockComment = true; continue; }
    if (trimmed.toLowerCase().startsWith('endcomment')) { inBlockComment = false; continue; }
    if (inBlockComment) continue;
    if (!raw.trim() || trimmed.startsWith('#')) continue;

    const indent = countIndent(raw);
    const body = trimmed;

    // Reject gen blocks inside groups
    if (grp !== null && GenBlockRx.test(body)) {
      throw new SatieSyntaxError(
        'Gen blocks are not allowed inside groups',
        'gen', null, body,
      );
    }

    // Close group?
    if (grp !== null && indent === grp.indent &&
        (StmtStartRx.test(body) || body.toLowerCase().startsWith('group ') || body.toLowerCase().startsWith('endgroup'))) {
      flushGroup(outList, grp);
      grp = null;
    }
    if (grp !== null && body.toLowerCase().startsWith('endgroup')) continue;

    // Open group
    if (body.toLowerCase().startsWith('group ')) {
      grp = { props: new Map(), children: [], indent };
      continue;
    }

    // Statement
    if (StmtStartRx.test(body)) {
      const { line: rewrittenBody, prompt: genPrompt, isGen } = preprocessGen(body);

      const stmtIndent = indent;
      const sb: string[] = [rewrittenBody];

      let j = i + 1;
      while (j < lines.length && countIndent(lines[j]) > stmtIndent) {
        sb.push(lines[j]);
        j++;
      }
      i = j - 1;

      const st = parseSingle(sb.join('\n') + '\n');

      if (isGen) {
        // Inline gen statement
        st.isGenerated = true;
        st.genPrompt = genPrompt;
        promoteGenDuration(st);

        if (st.count > 1) {
          const n = st.count;
          const baseClip = st.clip;
          for (let v = 0; v < n; v++) {
            const variant = parseSingle(sb.join('\n') + '\n');
            variant.count = 1;
            variant.clip = `${baseClip}_${v + 1}`;
            variant.isGenerated = true;
            variant.genPrompt = genPrompt;
            promoteGenDuration(variant);
            copyGenPropsFromStatement(st, variant);
            if (grp) grp.children.push(variant); else outList.push(variant);
          }
          continue;
        }
      } else {
        // Check if clip name references a gen definition
        const genDef = genDefs.get(st.clip);
        if (genDef) {
          st.isGenerated = true;
          st.genPrompt = genDef.prompt;
          st.genDuration = genDef.duration;
          st.genInfluence = genDef.influence;
          st.genLoopable = genDef.loopable;
          const baseName = 'generation/' + sanitizeForClipName(genDef.prompt);
          st.clip = baseName;

          if (st.count > 1) {
            const n = st.count;
            for (let v = 0; v < n; v++) {
              const variant = parseSingle(sb.join('\n') + '\n');
              variant.count = 1;
              variant.clip = `${baseName}_${v + 1}`;
              variant.isGenerated = true;
              variant.genPrompt = genDef.prompt;
              variant.genDuration = genDef.duration;
              variant.genInfluence = genDef.influence;
              variant.genLoopable = genDef.loopable;
              if (grp) grp.children.push(variant); else outList.push(variant);
            }
            continue;
          }
        }
      }

      if (grp) grp.children.push(st); else outList.push(st);
      continue;
    }

    // Property line (inside group)
    if (grp !== null) {
      const propRxSingle = /^[ \t]*(?<key>\w+)(?:[ \t]+(?<val>[^\r\n#]+))?/;
      const pm = body.match(propRxSingle);
      if (pm?.groups) {
        const k = pm.groups.key.toLowerCase();
        const STANDALONE_FLAGS = new Set(['overlap', 'persistent', 'mute', 'solo', 'randomstart', 'random_start']);
        const isFlag = STANDALONE_FLAGS.has(k);
        const rawVal = (!isFlag && pm.groups.val) ? pm.groups.val.trim() : '';
        if (k === 'move' || k === 'visual') {
          console.warn(`[Satie] '${k}' not allowed on a group — ignored.`);
        } else {
          grp.props.set(k, rawVal);
        }
        continue;
      }
    }

    console.warn(`[Satie] Unrecognised line: '${body}'`);
  }

  if (grp) flushGroup(outList, grp);

  // Post-pass: apply trajectory gen definitions to statements with matching move names
  if (trajGenDefs.size > 0) {
    for (const st of outList) {
      applyTrajGenDef(st, trajGenDefs);
    }
  }

  return outList;
}

/** Apply trajectory gen definition to a statement if its customTrajectoryName matches. */
function applyTrajGenDef(st: Statement, trajGenDefs: Map<string, TrajectoryGenDefinition>): void {
  if (st.wanderType !== WanderType.Custom || !st.customTrajectoryName) return;
  const def = trajGenDefs.get(st.customTrajectoryName);
  if (!def) return;

  st.isGenTrajectory = true;
  st.genTrajectoryPrompt = def.prompt;
  st.genTrajectoryDuration = def.duration;
  st.genTrajectoryResolution = def.resolution;
  st.genTrajectorySmoothing = def.smoothing;
  st.genTrajectorySeed = def.seed;
  st.genTrajectoryGround = def.ground;
  st.genTrajectoryVariation = def.variation;
}

/** Copy gen-specific properties from a parsed statement to a variant. */
function copyGenPropsFromStatement(src: Statement, dst: Statement): void {
  dst.genDuration = src.genDuration;
  dst.genInfluence = src.genInfluence;
  dst.genLoopable = src.genLoopable;
}

/**
 * For gen statements, if `duration` was set in the property block and `genDuration` is not,
 * move it to `genDuration` (generation length, not playback length).
 * Also clamp genDuration to 0.5–22s.
 */
function promoteGenDuration(s: Statement): void {
  if (!s.duration.isNull && s.genDuration.isNull) {
    s.genDuration = s.duration;
    s.duration = RangeOrValue.Null;
  }
  if (!s.genDuration.isNull) {
    const clampVal = (v: number) => Math.max(0.5, Math.min(22, v));
    s.genDuration = s.genDuration.isRange
      ? RangeOrValue.range(clampVal(s.genDuration.min), clampVal(s.genDuration.max))
      : RangeOrValue.single(clampVal(s.genDuration.min));
  }
}

export function tryParse(script: string): { success: boolean; statements: Statement[] | null; errors: string | null } {
  try {
    const statements = parse(script);
    return { success: true, statements, errors: null };
  } catch (e: any) {
    return { success: false, statements: null, errors: e.message };
  }
}
