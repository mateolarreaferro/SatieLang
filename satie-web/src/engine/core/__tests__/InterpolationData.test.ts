import { describe, it, expect } from 'vitest';
import { InterpolationData, InterpolationType } from '../InterpolationData';

describe('InterpolationData', () => {
  describe('parse goto', () => {
    it('basic goto(0and1 in 5)', () => {
      const r = InterpolationData.parse('goto(0and1 in 5)');
      expect(r).not.toBeNull();
      expect(r!.interpolationType).toBe(InterpolationType.Goto);
      expect(r!.minRange.min).toBe(0);
      expect(r!.maxRange.min).toBe(1);
      expect(r!.durationRange.min).toBe(5);
      expect(r!.easeName).toBe('linear');
    });

    it('goto with easing: goto(0and1 as incubic in 10)', () => {
      const r = InterpolationData.parse('goto(0and1 as incubic in 10)');
      expect(r).not.toBeNull();
      expect(r!.easeName).toBe('incubic');
      expect(r!.durationRange.min).toBe(10);
    });

    it('goto with range values: goto(0to0.2and0.8to1 in 3to5)', () => {
      const r = InterpolationData.parse('goto(0to0.2and0.8to1 in 3to5)');
      expect(r).not.toBeNull();
      expect(r!.minRange.isRange).toBe(true);
      expect(r!.minRange.min).toBe(0);
      expect(r!.minRange.max).toBe(0.2);
      expect(r!.maxRange.isRange).toBe(true);
      expect(r!.durationRange.isRange).toBe(true);
    });

    it('goto with negative values: goto(-1and1 in 2)', () => {
      const r = InterpolationData.parse('goto(-1and1 in 2)');
      expect(r).not.toBeNull();
      expect(r!.minRange.min).toBe(-1);
      expect(r!.maxRange.min).toBe(1);
    });
  });

  describe('parse gobetween', () => {
    it('basic gobetween(0and1 in 5)', () => {
      const r = InterpolationData.parse('gobetween(0and1 in 5)');
      expect(r).not.toBeNull();
      expect(r!.interpolationType).toBe(InterpolationType.GoBetween);
      expect(r!.isForever).toBe(true); // default is forever
    });

    it('gobetween with ease and count: gobetween(0and1 as insine in 3 for 5)', () => {
      const r = InterpolationData.parse('gobetween(0and1 as insine in 3 for 5)');
      expect(r).not.toBeNull();
      expect(r!.easeName).toBe('insine');
      expect(r!.repeatCount).toBe(5);
      expect(r!.isForever).toBe(false);
    });

    it('gobetween with "for ever"', () => {
      const r = InterpolationData.parse('gobetween(0and1 in 2 for ever)');
      expect(r).not.toBeNull();
      expect(r!.isForever).toBe(true);
    });

    it('gobetween with range duration', () => {
      const r = InterpolationData.parse('gobetween(0.5and2 as incubic in 5to10)');
      expect(r).not.toBeNull();
      expect(r!.durationRange.isRange).toBe(true);
      expect(r!.durationRange.min).toBe(5);
      expect(r!.durationRange.max).toBe(10);
    });
  });

  describe('parse interpolate', () => {
    it('interpolate(0.8and1.2 as incubic in 10)', () => {
      const r = InterpolationData.parse('interpolate(0.8and1.2 as incubic in 10)');
      expect(r).not.toBeNull();
      expect(r!.interpolationType).toBe(InterpolationType.Interpolate);
      expect(r!.easeName).toBe('incubic');
      expect(r!.minRange.min).toBe(0.8);
      expect(r!.maxRange.min).toBe(1.2);
    });

    it('interpolate with for ever', () => {
      const r = InterpolationData.parse('interpolate(0and1 as linear in 5 for ever)');
      expect(r).not.toBeNull();
      expect(r!.isForever).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns null for empty string', () => {
      expect(InterpolationData.parse('')).toBeNull();
      expect(InterpolationData.parse('  ')).toBeNull();
    });

    it('returns null for plain number', () => {
      expect(InterpolationData.parse('0.5')).toBeNull();
    });

    it('returns null for garbage', () => {
      expect(InterpolationData.parse('not an interpolation')).toBeNull();
    });
  });
});
