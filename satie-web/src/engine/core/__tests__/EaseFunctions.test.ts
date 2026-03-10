import { describe, it, expect } from 'vitest';
import {
  linear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeInSine,
  easeOutSine,
  easeInOutSine,
  easeInExpo,
  easeOutExpo,
  easeInElastic,
  easeOutElastic,
  easeInBounce,
  easeOutBounce,
  easeInOutBounce,
  easeInBack,
  easeOutBack,
  sine,
  sineReturn,
  getEaseFunction,
} from '../EaseFunctions';

describe('EaseFunctions', () => {
  describe('boundary conditions', () => {
    const fns = [
      { name: 'linear', fn: linear },
      { name: 'easeInQuad', fn: easeInQuad },
      { name: 'easeOutQuad', fn: easeOutQuad },
      { name: 'easeInOutQuad', fn: easeInOutQuad },
      { name: 'easeInCubic', fn: easeInCubic },
      { name: 'easeOutCubic', fn: easeOutCubic },
      { name: 'easeInOutCubic', fn: easeInOutCubic },
      { name: 'easeInSine', fn: easeInSine },
      { name: 'easeOutSine', fn: easeOutSine },
      { name: 'easeInOutSine', fn: easeInOutSine },
      { name: 'easeInExpo', fn: easeInExpo },
      { name: 'easeOutExpo', fn: easeOutExpo },
      { name: 'easeOutBounce', fn: easeOutBounce },
      { name: 'easeInBounce', fn: easeInBounce },
      { name: 'easeInOutBounce', fn: easeInOutBounce },
    ];

    for (const { name, fn } of fns) {
      it(`${name}(0) ≈ 0`, () => {
        expect(fn(0)).toBeCloseTo(0, 5);
      });

      it(`${name}(1) ≈ 1`, () => {
        expect(fn(1)).toBeCloseTo(1, 5);
      });
    }
  });

  describe('monotonicity of basic eases', () => {
    it('linear is monotonically increasing', () => {
      for (let t = 0; t < 1; t += 0.01) {
        expect(linear(t + 0.01)).toBeGreaterThanOrEqual(linear(t));
      }
    });

    it('easeInQuad is monotonically increasing', () => {
      for (let t = 0; t < 1; t += 0.01) {
        expect(easeInQuad(t + 0.01)).toBeGreaterThanOrEqual(easeInQuad(t));
      }
    });
  });

  describe('special eases', () => {
    it('sine(0) should be 0 (trough)', () => {
      expect(sine(0)).toBeCloseTo(0, 5);
    });

    it('sine(0.25) should be 0.5', () => {
      expect(sine(0.25)).toBeCloseTo(0.5, 1);
    });

    it('sineReturn peaks at 0.5', () => {
      expect(sineReturn(0.5)).toBeCloseTo(1, 5);
    });

    it('sineReturn(0) = 0', () => {
      expect(sineReturn(0)).toBeCloseTo(0, 5);
    });

    it('sineReturn(1) = 0', () => {
      expect(sineReturn(1)).toBeCloseTo(0, 3);
    });
  });

  describe('elastic and back overshoot', () => {
    it('easeInElastic goes below 0 near start', () => {
      // elastic should overshoot
      let hasNegative = false;
      for (let t = 0.01; t < 0.5; t += 0.01) {
        if (easeInElastic(t) < 0) hasNegative = true;
      }
      expect(hasNegative).toBe(true);
    });

    it('easeOutElastic goes above 1 near end', () => {
      let hasOvershoot = false;
      for (let t = 0.5; t < 1; t += 0.01) {
        if (easeOutElastic(t) > 1) hasOvershoot = true;
      }
      expect(hasOvershoot).toBe(true);
    });

    it('easeInBack goes below 0', () => {
      let hasNegative = false;
      for (let t = 0; t < 0.5; t += 0.01) {
        if (easeInBack(t) < -0.01) hasNegative = true;
      }
      expect(hasNegative).toBe(true);
    });

    it('easeOutBack goes above 1', () => {
      let hasOvershoot = false;
      for (let t = 0.5; t <= 1; t += 0.01) {
        if (easeOutBack(t) > 1.01) hasOvershoot = true;
      }
      expect(hasOvershoot).toBe(true);
    });
  });

  describe('getEaseFunction()', () => {
    it('returns linear for null/undefined', () => {
      expect(getEaseFunction(null)).toBe(linear);
      expect(getEaseFunction(undefined)).toBe(linear);
    });

    it('case-insensitive lookup', () => {
      expect(getEaseFunction('incubic')).toBe(easeInCubic);
      expect(getEaseFunction('INCUBIC')).toBe(easeInCubic);
      expect(getEaseFunction('InCubic')).toBe(easeInCubic);
    });

    it('supports both naming conventions', () => {
      expect(getEaseFunction('incubic')).toBe(easeInCubic);
      expect(getEaseFunction('easeincubic')).toBe(easeInCubic);
    });

    it('returns linear for unknown', () => {
      const fn = getEaseFunction('nonexistent');
      expect(fn).toBe(linear);
      expect(fn(0.5)).toBe(0.5);
    });
  });
});
