/**
 * Satie Language Parser — full port from SatieParser.cs
 * Parses .satie scripts into Statement objects.
 */
import { RangeOrValue } from './RangeOrValue';
import { InterpolationData, InterpolationType } from './InterpolationData';
import {
  Statement,
  GenDefinition,
  WanderType,
  ReverbParams,
  DelayParams,
  FilterParams,
  DistortionParams,
  EQParams,
} from './Statement';

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
  const parts = v.split(' and ');
  for (const part of parts) {
    const trimmed = part.trim();
    const objMatch = trimmed.match(/^object\s+"(.+?)"/i);
    if (objMatch) {
      s.visual.push(`object:${objMatch[1]}`);
    } else {
      s.visual.push(trimmed.toLowerCase());
    }
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

  // Trajectory types — named movement patterns
  const trajectoryMatch = v.match(/^(spiral|orbit|lorenz)\b\s*/i);
  if (trajectoryMatch) {
    const trajName = trajectoryMatch[1].toLowerCase();
    v = v.substring(trajectoryMatch[0].length);

    // Extract speed if present
    let trajSpeed = 1;
    const trajSpeedMatch = v.match(/(?:at\s+)?speed\s+(.+?)(?=\s+(?:x|y|z)\s+|$)/i);
    if (trajSpeedMatch) {
      const speedValue = trajSpeedMatch[1].trim();
      const speedInterp = InterpolationData.parse(speedValue);
      if (speedInterp) {
        s.moveSpeedInterpolation = speedInterp;
        trajSpeed = speedInterp.minValue;
      } else {
        trajSpeed = parseFloat(speedValue) || 1;
      }
      v = v.substring(0, trajSpeedMatch.index!).trim() + v.substring(trajSpeedMatch.index! + trajSpeedMatch[0].length).trim();
    }

    // Map to WanderType
    switch (trajName) {
      case 'spiral': s.wanderType = WanderType.Spiral; break;
      case 'orbit': s.wanderType = WanderType.Orbit; break;
      case 'lorenz': s.wanderType = WanderType.Lorenz; break;
    }
    s.wanderHz = RangeOrValue.single(trajSpeed);

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

  // New flexible syntax — detect and strip leading walk/fly keyword before axis parsing
  let detectedType: 'walk' | 'fly' | null = null;
  const typeMatch = v.match(/^(walk|fly)\b\s*/i);
  if (typeMatch) {
    detectedType = typeMatch[1].toLowerCase() as 'walk' | 'fly';
    v = v.substring(typeMatch[0].length);
  }
  let xMin = -5, xMax = 5, yMin = -5, yMax = 5, zMin = -5, zMax = 5;
  let speed = 1;
  let moveType = WanderType.None;
  let hasX = false, hasY = false, hasZ = false;

  // Extract speed
  const speedMatch = v.match(/(?:at\s+)?speed\s+(.+?)(?=\s+(?:x|y|z)\s+|$)/i);
  if (speedMatch) {
    const speedValue = speedMatch[1].trim();
    const speedInterp = InterpolationData.parse(speedValue);
    if (speedInterp) {
      s.moveSpeedInterpolation = speedInterp;
      speed = speedInterp.minValue;
    } else {
      const speedRange = RangeOrValue.parse(speedValue);
      s.wanderHz = speedRange;
      speed = speedRange.min;
    }
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
    s.wanderHz = RangeOrValue.single(speed);
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
    s.wanderHz = RangeOrValue.single(speed);
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
 * e.g. `visual trail and sphere` keeps `and` as literal since `sphere` is not a keyword.
 */
function expandAndSeparators(lines: string[]): string[] {
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    const indent = line.substring(0, line.length - trimmed.length);

    // Only expand on statement lines or indented property lines
    // Split on ` and ` where the next word is a property keyword
    const parts: string[] = [];
    let remaining = trimmed;
    while (remaining.length > 0) {
      const match = remaining.match(/^(.+?)\s+and\s+(\w+)/i);
      if (match) {
        const nextWord = match[2].toLowerCase();
        if (PROPERTY_KEYWORDS.has(nextWord)) {
          parts.push(match[1]);
          remaining = remaining.substring(match[0].length - match[2].length);
          continue;
        }
      }
      parts.push(remaining);
      break;
    }

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

// ============ MAIN PARSE FUNCTION ============

export function parse(script: string): Statement[] {
  const rawLines = script.replace(/\r\n/g, '\n').split('\n');

  // Pre-pass 1: expand `and` separators
  const expandedLines = expandAndSeparators(rawLines);

  // Pre-pass 2: extract gen blocks
  const { genDefs, remaining: lines } = extractGenBlocks(expandedLines);

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
  return outList;
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
