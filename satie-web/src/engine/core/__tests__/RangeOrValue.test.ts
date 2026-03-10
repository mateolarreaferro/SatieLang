import { describe, it, expect } from 'vitest';
import { RangeOrValue } from '../RangeOrValue';

describe('RangeOrValue', () => {
  describe('static singletons', () => {
    it('Null is null', () => {
      expect(RangeOrValue.Null.isNull).toBe(true);
      expect(RangeOrValue.Null.sample()).toBe(0);
    });

    it('Zero is 0', () => {
      expect(RangeOrValue.Zero.isNull).toBe(false);
      expect(RangeOrValue.Zero.sample()).toBe(0);
    });

    it('One is 1', () => {
      expect(RangeOrValue.One.isNull).toBe(false);
      expect(RangeOrValue.One.sample()).toBe(1);
    });
  });

  describe('single()', () => {
    it('creates a single value', () => {
      const v = RangeOrValue.single(0.5);
      expect(v.min).toBe(0.5);
      expect(v.max).toBe(0.5);
      expect(v.isRange).toBe(false);
      expect(v.isNull).toBe(false);
      expect(v.sample()).toBe(0.5);
    });

    it('negative values', () => {
      const v = RangeOrValue.single(-3);
      expect(v.sample()).toBe(-3);
    });
  });

  describe('range()', () => {
    it('creates a range', () => {
      const v = RangeOrValue.range(0.2, 0.8);
      expect(v.min).toBe(0.2);
      expect(v.max).toBe(0.8);
      expect(v.isRange).toBe(true);
      expect(v.isNull).toBe(false);
    });

    it('samples within range', () => {
      const v = RangeOrValue.range(10, 20);
      for (let i = 0; i < 50; i++) {
        const s = v.sample();
        expect(s).toBeGreaterThanOrEqual(10);
        expect(s).toBeLessThanOrEqual(20);
      }
    });

    it('samples with custom rng', () => {
      const v = RangeOrValue.range(0, 10);
      expect(v.sample(() => 0)).toBe(0);
      expect(v.sample(() => 0.5)).toBe(5);
      expect(v.sample(() => 1)).toBe(10);
    });
  });

  describe('parse()', () => {
    it('parses single value', () => {
      const v = RangeOrValue.parse('0.5');
      expect(v.isRange).toBe(false);
      expect(v.min).toBe(0.5);
    });

    it('parses range with "to"', () => {
      const v = RangeOrValue.parse('0.2to0.8');
      expect(v.isRange).toBe(true);
      expect(v.min).toBe(0.2);
      expect(v.max).toBe(0.8);
    });

    it('parses negative range', () => {
      const v = RangeOrValue.parse('-5to5');
      expect(v.min).toBe(-5);
      expect(v.max).toBe(5);
    });

    it('parses integer', () => {
      const v = RangeOrValue.parse('3');
      expect(v.min).toBe(3);
      expect(v.isRange).toBe(false);
    });

    it('returns Null for empty string', () => {
      expect(RangeOrValue.parse('').isNull).toBe(true);
      expect(RangeOrValue.parse('  ').isNull).toBe(true);
    });

    it('returns Null for non-numeric', () => {
      expect(RangeOrValue.parse('abc').isNull).toBe(true);
    });

    it('handles whitespace', () => {
      const v = RangeOrValue.parse('  0.5  ');
      expect(v.min).toBe(0.5);
    });
  });

  describe('toString()', () => {
    it('single value', () => {
      expect(RangeOrValue.single(0.5).toString()).toBe('0.5');
    });

    it('range', () => {
      expect(RangeOrValue.range(1, 5).toString()).toBe('1to5');
    });

    it('null', () => {
      expect(RangeOrValue.Null.toString()).toBe('null');
    });
  });
});
