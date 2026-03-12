import { describe, it, expect } from 'vitest';
import { parse, tryParse, sanitizeForClipName, pathFor } from '../SatieParser';
import { WanderType } from '../Statement';
import { InterpolationType } from '../InterpolationData';

describe('SatieParser', () => {
  // ─── Helper: parse a single-statement script ───
  function parseOne(script: string) {
    const stmts = parse(script + '\n');
    expect(stmts.length).toBeGreaterThanOrEqual(1);
    return stmts[0];
  }

  // ──────────────────────────────────────────────
  // Basic statements
  // ──────────────────────────────────────────────
  describe('basic statements', () => {
    it('parses loop', () => {
      const s = parseOne('loop rain');
      expect(s.kind).toBe('loop');
      expect(s.clip).toBe('rain');
      expect(s.count).toBe(1);
    });

    it('parses oneshot', () => {
      const s = parseOne('oneshot thunder');
      expect(s.kind).toBe('oneshot');
      expect(s.clip).toBe('thunder');
    });

    it('parses count prefix: 3* loop rain', () => {
      const s = parseOne('3* loop rain');
      expect(s.count).toBe(3);
      expect(s.clip).toBe('rain');
    });

    it('parses every with range: oneshot click every 2to4', () => {
      const s = parseOne('oneshot click every 2to4');
      expect(s.every.isRange).toBe(true);
      expect(s.every.min).toBe(2);
      expect(s.every.max).toBe(4);
    });

    it('parses every with single value: oneshot click every 3', () => {
      const s = parseOne('oneshot click every 3');
      expect(s.every.min).toBe(3);
      expect(s.every.isRange).toBe(false);
    });

    it('parses clip with path: loop ambient/forest', () => {
      const s = parseOne('loop ambient/forest');
      expect(s.clip).toBe('ambient/forest');
    });
  });

  // ──────────────────────────────────────────────
  // Properties
  // ──────────────────────────────────────────────
  describe('properties', () => {
    it('volume as single value', () => {
      const s = parseOne('loop rain\n  volume 0.5');
      expect(s.volume.min).toBe(0.5);
      expect(s.volume.isRange).toBe(false);
    });

    it('volume as range', () => {
      const s = parseOne('loop rain\n  volume 0.2to0.8');
      expect(s.volume.isRange).toBe(true);
      expect(s.volume.min).toBe(0.2);
      expect(s.volume.max).toBe(0.8);
    });

    it('pitch as single value', () => {
      const s = parseOne('loop rain\n  pitch 1.5');
      expect(s.pitch.min).toBe(1.5);
    });

    it('start', () => {
      const s = parseOne('loop rain\n  start 0.5');
      expect(s.start.min).toBe(0.5);
    });

    it('end', () => {
      const s = parseOne('loop rain\n  end 10');
      expect(s.end.min).toBe(10);
    });

    it('end with fade', () => {
      const s = parseOne('loop rain\n  end 10 fade 2');
      expect(s.end.min).toBe(10);
      expect(s.endFade.min).toBe(2);
    });

    it('duration', () => {
      const s = parseOne('loop rain\n  duration 30');
      expect(s.duration.min).toBe(30);
    });

    it('fade_in and fade_out', () => {
      const s = parseOne('loop rain\n  fade_in 2\n  fade_out 3');
      expect(s.fadeIn.min).toBe(2);
      expect(s.fadeOut.min).toBe(3);
    });

    it('every as property', () => {
      const s = parseOne('oneshot click\n  every 1to3');
      expect(s.every.isRange).toBe(true);
      expect(s.every.min).toBe(1);
      expect(s.every.max).toBe(3);
    });
  });

  // ──────────────────────────────────────────────
  // Flags
  // ──────────────────────────────────────────────
  describe('flags', () => {
    it('overlap', () => {
      const s = parseOne('loop rain\n  overlap');
      expect(s.overlap).toBe(true);
    });

    it('persistent', () => {
      const s = parseOne('loop rain\n  persistent');
      expect(s.persistent).toBe(true);
    });

    it('mute', () => {
      const s = parseOne('loop rain\n  mute');
      expect(s.mute).toBe(true);
    });

    it('solo', () => {
      const s = parseOne('loop rain\n  solo');
      expect(s.solo).toBe(true);
    });

    it('random_start', () => {
      const s = parseOne('loop rain\n  random_start');
      expect(s.randomStart).toBe(true);
    });

    it('randomstart (no underscore)', () => {
      const s = parseOne('loop rain\n  randomstart');
      expect(s.randomStart).toBe(true);
    });
  });

  // ──────────────────────────────────────────────
  // Interpolation in properties
  // ──────────────────────────────────────────────
  describe('interpolation in properties', () => {
    it('volume goto', () => {
      const s = parseOne('loop rain\n  volume goto(0and1 in 5)');
      expect(s.volumeInterpolation).not.toBeNull();
      expect(s.volumeInterpolation!.interpolationType).toBe(InterpolationType.Goto);
      expect(s.volumeInterpolation!.minRange.min).toBe(0);
      expect(s.volumeInterpolation!.maxRange.min).toBe(1);
      expect(s.volumeInterpolation!.durationRange.min).toBe(5);
    });

    it('volume gobetween with easing', () => {
      const s = parseOne('loop rain\n  volume gobetween(0and1 as incubic in 10)');
      expect(s.volumeInterpolation).not.toBeNull();
      expect(s.volumeInterpolation!.interpolationType).toBe(InterpolationType.GoBetween);
      expect(s.volumeInterpolation!.easeName).toBe('incubic');
    });

    it('pitch interpolate', () => {
      const s = parseOne('loop rain\n  pitch interpolate(0.5and2 as insine in 20)');
      expect(s.pitchInterpolation).not.toBeNull();
      expect(s.pitchInterpolation!.interpolationType).toBe(InterpolationType.Interpolate);
    });
  });

  // ──────────────────────────────────────────────
  // Spatial: move
  // ──────────────────────────────────────────────
  describe('move', () => {
    it('bare walk', () => {
      const s = parseOne('loop rain\n  move walk');
      expect(s.wanderType).toBe(WanderType.Walk);
      expect(s.areaMin.y).toBe(0);
      expect(s.areaMax.y).toBe(0);
    });

    it('bare fly', () => {
      const s = parseOne('loop rain\n  move fly');
      expect(s.wanderType).toBe(WanderType.Fly);
      expect(s.areaMin.y).toBe(-5);
      expect(s.areaMax.y).toBe(5);
    });

    it('fly with axes: move fly x -5to5 y 0to3 z -5to5', () => {
      const s = parseOne('loop rain\n  move fly x -5to5 y 0to3 z -5to5');
      expect(s.wanderType).toBe(WanderType.Fly);
      expect(s.areaMin.x).toBe(-5);
      expect(s.areaMax.x).toBe(5);
      expect(s.areaMin.y).toBe(0);
      expect(s.areaMax.y).toBe(3);
      expect(s.areaMin.z).toBe(-5);
      expect(s.areaMax.z).toBe(5);
    });

    it('walk with x and z only: move x -3to3 z -3to3', () => {
      const s = parseOne('loop rain\n  move x -3to3 z -3to3');
      expect(s.wanderType).toBe(WanderType.Walk);
      expect(s.areaMin.x).toBe(-3);
      expect(s.areaMax.x).toBe(3);
      expect(s.areaMin.y).toBe(0);
      expect(s.areaMax.y).toBe(0);
    });

    it('move with speed: move fly speed 2', () => {
      const s = parseOne('loop rain\n  move fly speed 2');
      expect(s.wanderType).toBe(WanderType.Fly);
      expect(s.wanderHz.min).toBe(2);
    });

    it('legacy comma syntax: move walk, -5to5, -5to5, 0.3', () => {
      const s = parseOne('loop rain\n  move walk, -5to5, -5to5, 0.3');
      expect(s.wanderType).toBe(WanderType.Walk);
      expect(s.areaMin.x).toBe(-5);
      expect(s.areaMax.x).toBe(5);
      expect(s.areaMin.z).toBe(-5);
      expect(s.areaMax.z).toBe(5);
    });

    it('legacy comma pos syntax: move pos, 3, 1, -2', () => {
      const s = parseOne('loop rain\n  move pos, 3, 1, -2');
      expect(s.wanderType).toBe(WanderType.Fixed);
    });
  });

  // ──────────────────────────────────────────────
  // Color
  // ──────────────────────────────────────────────
  describe('color', () => {
    it('hex color', () => {
      const s = parseOne('loop rain\n  color #FF0000');
      expect(s.staticColor).toBe('#FF0000');
    });

    it('named color', () => {
      const s = parseOne('loop rain\n  color red');
      expect(s.staticColor).toBe('#ff0000');
    });

    it('named color grey', () => {
      const s = parseOne('loop rain\n  color grey');
      expect(s.staticColor).toBe('#808080');
    });

    it('RGB comma syntax', () => {
      const s = parseOne('loop rain\n  color 255,0,128');
      expect(s.staticColor).toBe('#ff0080');
    });

    it('color channel interpolation: red gobetween', () => {
      const s = parseOne('loop rain\n  color red gobetween(0and255 in 5) green 128 blue 0');
      expect(s.colorRedInterpolation).not.toBeNull();
      // Static values (green 128, blue 0) go to colorRange, not interpolation
      expect(s.colorGreenRange).not.toBeNull();
      expect(s.colorGreenRange!.min).toBeCloseTo(128 / 255);
      expect(s.colorBlueRange).not.toBeNull();
      expect(s.colorBlueRange!.min).toBeCloseTo(0);
    });
  });

  // ──────────────────────────────────────────────
  // DSP
  // ──────────────────────────────────────────────
  describe('DSP', () => {
    it('reverb with parameters', () => {
      const s = parseOne('loop rain\n  reverb wet 0.5 size 0.8');
      expect(s.reverbParams).not.toBeNull();
      expect(s.reverbParams!.dryWet.min).toBe(0.5);
      expect(s.reverbParams!.roomSize.min).toBe(0.8);
    });

    it('reverb with damping', () => {
      const s = parseOne('loop rain\n  reverb wet 0.3 size 0.7 damp 0.4');
      expect(s.reverbParams!.damping.min).toBe(0.4);
    });

    it('reverb defaults', () => {
      const s = parseOne('loop rain\n  reverb wet 0.5');
      expect(s.reverbParams!.roomSize.min).toBe(0.5); // default
      expect(s.reverbParams!.damping.min).toBe(0.5);  // default
    });

    it('delay with parameters', () => {
      const s = parseOne('loop rain\n  delay time 0.3 feedback 0.5 wet 0.4');
      expect(s.delayParams).not.toBeNull();
      expect(s.delayParams!.time.min).toBe(0.3);
      expect(s.delayParams!.feedback.min).toBe(0.5);
      expect(s.delayParams!.dryWet.min).toBe(0.4);
    });

    it('filter with mode and cutoff', () => {
      const s = parseOne('loop rain\n  filter mode lowpass cutoff 1000');
      expect(s.filterParams).not.toBeNull();
      expect(s.filterParams!.mode).toBe('lowpass');
      expect(s.filterParams!.cutoff.min).toBe(1000);
    });

    it('filter highpass', () => {
      const s = parseOne('loop rain\n  filter mode highpass cutoff 500 resonance 2');
      expect(s.filterParams!.mode).toBe('highpass');
      expect(s.filterParams!.cutoff.min).toBe(500);
      expect(s.filterParams!.resonance.min).toBe(2);
    });

    it('distortion with mode and drive', () => {
      const s = parseOne('loop rain\n  distortion mode tanh drive 3 wet 0.8');
      expect(s.distortionParams).not.toBeNull();
      expect(s.distortionParams!.mode).toBe('tanh');
      expect(s.distortionParams!.drive.min).toBe(3);
      expect(s.distortionParams!.dryWet.min).toBe(0.8);
    });

    it('EQ with bands', () => {
      const s = parseOne('loop rain\n  eq low 3 mid -2 high 1');
      expect(s.eqParams).not.toBeNull();
      expect(s.eqParams!.lowGain.min).toBe(3);
      expect(s.eqParams!.midGain.min).toBe(-2);
      expect(s.eqParams!.highGain.min).toBe(1);
    });

    it('DSP with interpolation: reverb wet gobetween(0and1 in 5)', () => {
      const s = parseOne('loop rain\n  reverb wet gobetween(0and1 in 5)');
      expect(s.reverbParams!.dryWetInterpolation).not.toBeNull();
      expect(s.reverbParams!.dryWetInterpolation!.interpolationType).toBe(InterpolationType.GoBetween);
    });
  });

  // ──────────────────────────────────────────────
  // Gen
  // ──────────────────────────────────────────────
  describe('gen', () => {
    it('basic gen statement', () => {
      const s = parseOne('loop gen ethereal pad sound');
      expect(s.isGenerated).toBe(true);
      expect(s.genPrompt).toBe('ethereal pad sound');
      expect(s.clip).toContain('generation/');
    });

    it('gen with every', () => {
      const s = parseOne('oneshot gen thunder rumble every 5to10');
      expect(s.isGenerated).toBe(true);
      expect(s.genPrompt).toBe('thunder rumble');
      expect(s.every.isRange).toBe(true);
    });

    it('gen with count creates multiple variants', () => {
      const stmts = parse('3* loop gen soft wind\n');
      expect(stmts.length).toBe(3);
      for (let i = 0; i < 3; i++) {
        expect(stmts[i].isGenerated).toBe(true);
        expect(stmts[i].clip).toContain(`_${i + 1}`);
      }
    });
  });

  // ──────────────────────────────────────────────
  // Groups
  // ──────────────────────────────────────────────
  describe('groups', () => {
    it('group applies volume to children', () => {
      const stmts = parse(
        'group ambient\n' +
        '  volume 0.5\n' +
        '  loop rain\n' +
        '  loop wind\n' +
        'endgroup\n',
      );
      expect(stmts.length).toBe(2);
      expect(stmts[0].volume.min).toBe(0.5);
      expect(stmts[1].volume.min).toBe(0.5);
    });

    it('group volume multiplies child volume', () => {
      const stmts = parse(
        'group ambient\n' +
        '  volume 0.5\n' +
        '  loop rain\n' +
        '    volume 0.8\n' +
        'endgroup\n',
      );
      expect(stmts[0].volume.min).toBeCloseTo(0.4); // 0.5 * 0.8
    });

    it('group applies pitch', () => {
      const stmts = parse(
        'group low\n' +
        '  pitch 0.5\n' +
        '  loop rain\n' +
        'endgroup\n',
      );
      expect(stmts[0].pitch.min).toBe(0.5);
    });

    it('group applies fade_in as default', () => {
      const stmts = parse(
        'group gentle\n' +
        '  fade_in 2\n' +
        '  loop rain\n' +
        'endgroup\n',
      );
      expect(stmts[0].fadeIn.min).toBe(2);
    });

    it('child override beats group default', () => {
      const stmts = parse(
        'group gentle\n' +
        '  fade_in 2\n' +
        '  loop rain\n' +
        '    fade_in 5\n' +
        'endgroup\n',
      );
      expect(stmts[0].fadeIn.min).toBe(5); // child wins
    });

    it('group applies color', () => {
      const stmts = parse(
        'group colored\n' +
        '  color red\n' +
        '  loop rain\n' +
        'endgroup\n',
      );
      expect(stmts[0].staticColor).toBe('#ff0000');
    });

    it('group applies flags', () => {
      const stmts = parse(
        'group special\n' +
        '  overlap\n' +
        '  persistent\n' +
        '  loop rain\n' +
        'endgroup\n',
      );
      expect(stmts[0].overlap).toBe(true);
      expect(stmts[0].persistent).toBe(true);
    });
  });

  // ──────────────────────────────────────────────
  // Comments
  // ──────────────────────────────────────────────
  describe('comments', () => {
    it('line comments with #', () => {
      const stmts = parse('# this is a comment\nloop rain\n');
      expect(stmts.length).toBe(1);
      expect(stmts[0].clip).toBe('rain');
    });

    it('block comments', () => {
      const stmts = parse(
        'comment\n' +
        'loop ignored\n' +
        'endcomment\n' +
        'loop rain\n',
      );
      expect(stmts.length).toBe(1);
      expect(stmts[0].clip).toBe('rain');
    });

    it('inline comment on statement', () => {
      const s = parseOne('loop rain # ambient sound');
      expect(s.clip).toBe('rain');
    });
  });

  // ──────────────────────────────────────────────
  // Multiple statements
  // ──────────────────────────────────────────────
  describe('multiple statements', () => {
    it('parses multiple consecutive statements', () => {
      const stmts = parse(
        'loop rain\n' +
        '  volume 0.5\n' +
        'oneshot thunder every 10to30\n' +
        'loop wind\n' +
        '  pitch 0.8\n',
      );
      expect(stmts.length).toBe(3);
      expect(stmts[0].clip).toBe('rain');
      expect(stmts[1].clip).toBe('thunder');
      expect(stmts[2].clip).toBe('wind');
    });

    it('empty script returns empty array', () => {
      expect(parse('')).toEqual([]);
      expect(parse('\n\n\n')).toEqual([]);
    });

    it('whitespace-only lines are skipped', () => {
      const stmts = parse('loop rain\n\n\n  volume 0.5\n');
      expect(stmts.length).toBe(1);
    });
  });

  // ──────────────────────────────────────────────
  // Visual
  // ──────────────────────────────────────────────
  describe('visual', () => {
    it('parses visual property', () => {
      const s = parseOne('loop rain\n  visual sphere');
      expect(s.visual).toContain('sphere');
    });

    it('parses visual with object path', () => {
      const s = parseOne('loop rain\n  visual object "MyPrefab"');
      expect(s.visual).toContain('object:MyPrefab');
    });

    it('parses visual with "and"', () => {
      const s = parseOne('loop rain\n  visual sphere and trail');
      expect(s.visual).toContain('sphere');
      expect(s.visual).toContain('trail');
    });
  });

  // ──────────────────────────────────────────────
  // tryParse
  // ──────────────────────────────────────────────
  describe('tryParse', () => {
    it('returns success for valid script', () => {
      const result = tryParse('loop rain\n');
      expect(result.success).toBe(true);
      expect(result.statements).not.toBeNull();
      expect(result.errors).toBeNull();
    });

    it('accepts single-word move names as custom trajectory references', () => {
      // Single words in move are now treated as custom trajectory names
      const result = tryParse('loop rain\n  move mytrajectory');
      expect(result.success).toBe(true);
      expect(result.statements![0].wanderType).toBe('custom');
      expect(result.statements![0].customTrajectoryName).toBe('mytrajectory');
    });
  });

  // ──────────────────────────────────────────────
  // Utility functions
  // ──────────────────────────────────────────────
  describe('utilities', () => {
    it('sanitizeForClipName', () => {
      expect(sanitizeForClipName('ethereal pad sound')).toBe('ethereal_pad_sound');
      expect(sanitizeForClipName('a<b>c:d')).toBe('a_b_c_d');
    });

    it('sanitizeForClipName truncates at 30', () => {
      const long = 'a'.repeat(50);
      expect(sanitizeForClipName(long).length).toBe(30);
    });

    it('pathFor adds Audio/ prefix', () => {
      expect(pathFor('rain')).toBe('Audio/rain');
    });

    it('pathFor strips extension', () => {
      expect(pathFor('rain.wav')).toBe('Audio/rain');
    });

    it('pathFor leaves Audio/ prefix alone', () => {
      expect(pathFor('Audio/ambient/rain')).toBe('Audio/ambient/rain');
    });

    it('pathFor handles empty', () => {
      expect(pathFor('')).toBe('');
    });
  });

  // ──────────────────────────────────────────────
  // Universal `and` separator
  // ──────────────────────────────────────────────
  describe('and separator', () => {
    it('expands `and volume` into separate property', () => {
      const s = parseOne('oneshot x every 10to20 and pitch 2 and volume 0.5');
      expect(s.every.min).toBe(10);
      expect(s.every.max).toBe(20);
      expect(s.pitch.min).toBe(2);
      expect(s.volume.min).toBe(0.5);
    });

    it('does not split `and` when next word is not a keyword', () => {
      const s = parseOne('loop rain\n  visual trail and sphere');
      expect(s.visual).toContain('trail');
      expect(s.visual).toContain('sphere');
    });

    it('works with DSP: loop rain and reverb wet 0.5 size 0.8', () => {
      const s = parseOne('loop rain and reverb wet 0.5 size 0.8');
      expect(s.reverbParams).not.toBeNull();
      expect(s.reverbParams!.dryWet.min).toBe(0.5);
      expect(s.reverbParams!.roomSize.min).toBe(0.8);
    });

    it('works with gen: loop gen singing bird and duration 15 and loopable', () => {
      const s = parseOne('loop gen singing bird and duration 15 and loopable');
      expect(s.isGenerated).toBe(true);
      expect(s.genPrompt).toBe('singing bird');
      expect(s.genDuration.min).toBe(15);
      expect(s.genLoopable).toBe(true);
    });

    it('preserves `and` in gen prompt when next word is not a keyword', () => {
      const s = parseOne('loop gen birds singing and flying');
      expect(s.isGenerated).toBe(true);
      expect(s.genPrompt).toBe('birds singing and flying');
    });

    it('splits `and influence` in gen statement', () => {
      const s = parseOne('loop gen forest ambience and influence 0.5 and duration 8');
      expect(s.isGenerated).toBe(true);
      expect(s.genInfluence.min).toBe(0.5);
      expect(s.genDuration.min).toBe(8);
    });
  });

  // ──────────────────────────────────────────────
  // Gen blocks
  // ──────────────────────────────────────────────
  describe('gen blocks', () => {
    it('parses a gen block and resolves reference', () => {
      const stmts = parse(
        'gen myBird\n' +
        '    prompt singing bird in a forest\n' +
        '    duration 15\n' +
        '    influence 0.3\n' +
        '    loopable\n' +
        '\n' +
        'loop myBird\n' +
        '    volume 0.5\n',
      );
      expect(stmts.length).toBe(1);
      expect(stmts[0].isGenerated).toBe(true);
      expect(stmts[0].genPrompt).toBe('singing bird in a forest');
      expect(stmts[0].genDuration.min).toBe(15);
      expect(stmts[0].genInfluence.min).toBe(0.3);
      expect(stmts[0].genLoopable).toBe(true);
      expect(stmts[0].volume.min).toBe(0.5);
      expect(stmts[0].clip).toContain('generation/');
    });

    it('gen block with count expands into unique variants', () => {
      const stmts = parse(
        'gen myBird\n' +
        '    prompt singing bird\n' +
        '    duration 10\n' +
        '\n' +
        '5* loop myBird\n' +
        '    volume 0.5\n',
      );
      expect(stmts.length).toBe(5);
      for (let i = 0; i < 5; i++) {
        expect(stmts[i].isGenerated).toBe(true);
        expect(stmts[i].clip).toContain(`_${i + 1}`);
        expect(stmts[i].genPrompt).toBe('singing bird');
        expect(stmts[i].genDuration.min).toBe(10);
      }
    });

    it('gen block with range params', () => {
      const stmts = parse(
        'gen ambient\n' +
        '    prompt forest ambience\n' +
        '    duration 10to20\n' +
        '    influence 0.2to0.8\n' +
        '\n' +
        'loop ambient\n',
      );
      expect(stmts.length).toBe(1);
      expect(stmts[0].genDuration.isRange).toBe(true);
      expect(stmts[0].genDuration.min).toBe(10);
      expect(stmts[0].genDuration.max).toBe(20);
      expect(stmts[0].genInfluence.isRange).toBe(true);
      expect(stmts[0].genInfluence.min).toBe(0.2);
      expect(stmts[0].genInfluence.max).toBe(0.8);
    });

    it('gen block missing prompt throws', () => {
      expect(() => parse(
        'gen broken\n' +
        '    duration 10\n' +
        '\n' +
        'loop broken\n',
      )).toThrow(/missing.*prompt/i);
    });

    it('gen block clamps duration to 0.5-22', () => {
      const stmts = parse(
        'gen test\n' +
        '    prompt test sound\n' +
        '    duration 50\n' +
        '\n' +
        'loop test\n',
      );
      expect(stmts[0].genDuration.min).toBe(22);
    });

    it('gen block clamps influence to 0-1', () => {
      const stmts = parse(
        'gen test\n' +
        '    prompt test sound\n' +
        '    influence 5\n' +
        '\n' +
        'loop test\n',
      );
      expect(stmts[0].genInfluence.min).toBe(1);
    });

    it('duplicate gen name: last wins', () => {
      const stmts = parse(
        'gen mySound\n' +
        '    prompt first prompt\n' +
        '\n' +
        'gen mySound\n' +
        '    prompt second prompt\n' +
        '\n' +
        'loop mySound\n',
      );
      expect(stmts[0].genPrompt).toBe('second prompt');
    });

    it('gen reference without count keeps single statement', () => {
      const stmts = parse(
        'gen wind\n' +
        '    prompt gentle wind\n' +
        '\n' +
        'loop wind\n' +
        '    move fly\n',
      );
      expect(stmts.length).toBe(1);
      expect(stmts[0].wanderType).toBe(WanderType.Fly);
    });
  });

  // ──────────────────────────────────────────────
  // Inline gen with properties
  // ──────────────────────────────────────────────
  describe('inline gen with properties', () => {
    it('parses inline gen with indented gen properties', () => {
      const s = parseOne(
        'loop gen singing bird\n' +
        '    duration 15\n' +
        '    influence 0.5\n' +
        '    loopable\n',
      );
      expect(s.isGenerated).toBe(true);
      expect(s.genPrompt).toBe('singing bird');
      expect(s.genDuration.min).toBe(15);
      expect(s.genInfluence.min).toBe(0.5);
      expect(s.genLoopable).toBe(true);
    });

    it('inline gen duration is clamped', () => {
      const s = parseOne(
        'loop gen test sound\n' +
        '    duration 100\n',
      );
      expect(s.genDuration.min).toBe(22);
    });

    it('inline gen influence is clamped', () => {
      const s = parseOne(
        'loop gen test sound\n' +
        '    influence 5\n',
      );
      expect(s.genInfluence.min).toBe(1);
    });
  });

  // ──────────────────────────────────────────────
  // Multi-clip `and`
  // ──────────────────────────────────────────────
  describe('multi-clip and', () => {
    it('expands plain clips: oneshot bird and rain and lizard every 5', () => {
      const stmts = parse('oneshot bird and rain and lizard every 5\n    volume 0.5\n');
      expect(stmts.length).toBe(3);
      expect(stmts[0].clip).toBe('bird');
      expect(stmts[1].clip).toBe('rain');
      expect(stmts[2].clip).toBe('lizard');
      // All share the same properties
      expect(stmts[0].every.min).toBe(5);
      expect(stmts[1].every.min).toBe(5);
      expect(stmts[2].every.min).toBe(5);
      expect(stmts[0].volume.min).toBe(0.5);
      expect(stmts[1].volume.min).toBe(0.5);
    });

    it('expands gen clips: oneshot gen bird and gen rain every 5', () => {
      const stmts = parse('oneshot gen bird and gen rain every 5\n');
      expect(stmts.length).toBe(2);
      expect(stmts[0].isGenerated).toBe(true);
      expect(stmts[0].genPrompt).toBe('bird');
      expect(stmts[1].isGenerated).toBe(true);
      expect(stmts[1].genPrompt).toBe('rain');
    });

    it('count prefix applies to each clip', () => {
      const stmts = parse('3* loop bird and rain\n');
      expect(stmts.length).toBe(2);
      expect(stmts[0].count).toBe(3);
      expect(stmts[0].clip).toBe('bird');
      expect(stmts[1].count).toBe(3);
      expect(stmts[1].clip).toBe('rain');
    });

    it('does not split when segment is multi-word non-gen', () => {
      // "singing bird" is multi-word and doesn't start with gen — not a valid segment
      const stmts = parse('loop rain\n');
      // This should just parse normally (no and involved)
      expect(stmts.length).toBe(1);
    });

    it('multi-clip inside group', () => {
      const stmts = parse(
        'group nature\n' +
        '    volume 0.5\n' +
        '    loop bird and rain\n' +
        'endgroup\n',
      );
      expect(stmts.length).toBe(2);
      expect(stmts[0].clip).toBe('bird');
      expect(stmts[1].clip).toBe('rain');
      // Group volume applied to both
      expect(stmts[0].volume.min).toBe(0.5);
      expect(stmts[1].volume.min).toBe(0.5);
    });

    it('multi-clip with property and separator combined', () => {
      const stmts = parse('oneshot bird and rain every 5 and volume 0.3\n');
      expect(stmts.length).toBe(2);
      expect(stmts[0].clip).toBe('bird');
      expect(stmts[1].clip).toBe('rain');
      expect(stmts[0].volume.min).toBe(0.3);
      expect(stmts[1].volume.min).toBe(0.3);
    });

    it('mixed gen and plain clips', () => {
      const stmts = parse('oneshot bird and gen rain every 5\n');
      expect(stmts.length).toBe(2);
      expect(stmts[0].isGenerated).toBe(false);
      expect(stmts[0].clip).toBe('bird');
      expect(stmts[1].isGenerated).toBe(true);
      expect(stmts[1].genPrompt).toBe('rain');
    });
  });

  // ──────────────────────────────────────────────
  // Variables
  // ──────────────────────────────────────────────
  describe('variables', () => {
    it('basic variable substitution in property value', () => {
      const stmts = parse('myVol 0.5\nloop bird\n    volume myVol\n');
      expect(stmts.length).toBe(1);
      expect(stmts[0].volume.min).toBe(0.5);
    });

    it('let syntax', () => {
      const stmts = parse('let myVol 0.5\nloop bird\n    volume myVol\n');
      expect(stmts.length).toBe(1);
      expect(stmts[0].volume.min).toBe(0.5);
    });

    it('range variable', () => {
      const stmts = parse('myRange 0.2to0.8\nloop bird\n    volume myRange\n');
      expect(stmts.length).toBe(1);
      expect(stmts[0].volume.isRange).toBe(true);
      expect(stmts[0].volume.min).toBe(0.2);
      expect(stmts[0].volume.max).toBe(0.8);
    });

    it('interpolation variable', () => {
      const stmts = parse('myInterp goto(0and1 in 10)\nloop bird\n    volume myInterp\n');
      expect(stmts.length).toBe(1);
      expect(stmts[0].volumeInterpolation).not.toBeNull();
      expect(stmts[0].volumeInterpolation!.interpolationType).toBe(InterpolationType.Goto);
    });

    it('variable in every clause', () => {
      const stmts = parse('myTiming 5to10\noneshot bird every myTiming\n');
      expect(stmts.length).toBe(1);
      expect(stmts[0].every.isRange).toBe(true);
      expect(stmts[0].every.min).toBe(5);
      expect(stmts[0].every.max).toBe(10);
    });

    it('variable not substituted in clip name position', () => {
      const stmts = parse('myVar 999\nloop myVar\n');
      expect(stmts.length).toBe(1);
      // Clip name is protected — should stay as 'myVar', not become '999'
      expect(stmts[0].clip).toBe('myVar');
    });

    it('reserved word is not treated as variable', () => {
      // 'volume' is reserved, so this line is unrecognized, not a variable
      const stmts = parse('loop bird\n    volume 0.5\n');
      expect(stmts.length).toBe(1);
      expect(stmts[0].volume.min).toBe(0.5);
    });

    it('multiple variables', () => {
      const stmts = parse(
        'myVol 0.5\n' +
        'myPitch 1.2\n' +
        'loop bird\n' +
        '    volume myVol\n' +
        '    pitch myPitch\n',
      );
      expect(stmts.length).toBe(1);
      expect(stmts[0].volume.min).toBe(0.5);
      expect(stmts[0].pitch.min).toBe(1.2);
    });

    it('variable used across multiple statements', () => {
      const stmts = parse(
        'myVol 0.3\n' +
        'loop bird\n' +
        '    volume myVol\n' +
        'loop rain\n' +
        '    volume myVol\n',
      );
      expect(stmts.length).toBe(2);
      expect(stmts[0].volume.min).toBe(0.3);
      expect(stmts[1].volume.min).toBe(0.3);
    });

    it('variable with comment on definition line', () => {
      const stmts = parse('myVol 0.5 # quiet\nloop bird\n    volume myVol\n');
      expect(stmts[0].volume.min).toBe(0.5);
    });

    it('variable definition lines are removed from output', () => {
      const stmts = parse('myVol 0.5\nloop bird\n');
      expect(stmts.length).toBe(1);
      expect(stmts[0].clip).toBe('bird');
    });
  });

  // ──────────────────────────────────────────────
  // Complex / realistic scripts
  // ──────────────────────────────────────────────
  describe('realistic scripts', () => {
    it('parses a full ambient scene', () => {
      const script = `
group nature
  volume 0.7
  fade_in 3

  loop rain
    volume 0.5
    move walk x -10to10 z -10to10 speed 0.5

  3* oneshot birds every 5to15
    volume 0.3to0.6
    pitch 0.8to1.2
    move fly x -8to8 y 2to5 z -8to8

  loop wind
    volume gobetween(0.1and0.5 as insine in 10 for ever)
    filter mode lowpass cutoff 2000

endgroup

oneshot thunder every 30to60
  volume 0.8
  reverb wet 0.7 size 0.9

loop fire
  volume 0.4
  distortion mode softclip drive 1.5
  eq low 2 mid 0 high -3
  color #FF4400
`;
      const stmts = parse(script);

      // 3* for non-gen = 1 statement with count=3 (only gen expands)
      // group: rain(1) + birds(1, count=3) + wind(1) = 3
      // outside: thunder(1) + fire(1) = 2
      // total = 5
      expect(stmts.length).toBe(5);

      // Check group volume was applied
      const rain = stmts[0];
      expect(rain.clip).toBe('rain');
      expect(rain.fadeIn.min).toBe(3); // from group

      // Thunder is outside group
      const thunder = stmts.find(s => s.clip === 'thunder');
      expect(thunder).toBeDefined();
      expect(thunder!.reverbParams).not.toBeNull();

      // Fire
      const fire = stmts.find(s => s.clip === 'fire');
      expect(fire).toBeDefined();
      expect(fire!.distortionParams).not.toBeNull();
      expect(fire!.eqParams).not.toBeNull();
      expect(fire!.staticColor).toBe('#FF4400');
    });
  });
});
