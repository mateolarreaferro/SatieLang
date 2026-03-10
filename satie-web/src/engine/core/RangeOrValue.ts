/**
 * A value that can be either a single float or a range (min..max).
 * When sampled, ranges return a random value within the range.
 * Ported from Satie Unity: RangeOrValue struct.
 */
export class RangeOrValue {
  readonly min: number;
  readonly max: number;
  readonly isRange: boolean;
  readonly isNull: boolean;

  private constructor(min: number, max: number, isRange: boolean, isNull: boolean) {
    this.min = min;
    this.max = max;
    this.isRange = isRange;
    this.isNull = isNull;
  }

  static readonly Null = new RangeOrValue(0, 0, false, true);
  static readonly Zero = new RangeOrValue(0, 0, false, false);
  static readonly One = new RangeOrValue(1, 1, false, false);

  static single(value: number): RangeOrValue {
    return new RangeOrValue(value, value, false, false);
  }

  static range(min: number, max: number): RangeOrValue {
    return new RangeOrValue(min, max, true, false);
  }

  /**
   * Parse a string like "0.5" or "0.2to0.8" into a RangeOrValue.
   */
  static parse(str: string): RangeOrValue {
    if (!str || str.trim() === '') return RangeOrValue.Null;

    const trimmed = str.trim();
    const toIndex = trimmed.indexOf('to');

    if (toIndex !== -1) {
      const minStr = trimmed.substring(0, toIndex);
      const maxStr = trimmed.substring(toIndex + 2);
      const min = parseFloat(minStr);
      const max = parseFloat(maxStr);
      if (isNaN(min) || isNaN(max)) return RangeOrValue.Null;
      return RangeOrValue.range(min, max);
    }

    const val = parseFloat(trimmed);
    if (isNaN(val)) return RangeOrValue.Null;
    return RangeOrValue.single(val);
  }

  /**
   * Sample the value. If it's a range, returns a random value between min and max.
   * If it's a single value, returns that value.
   */
  sample(rng?: () => number): number {
    if (this.isNull) return 0;
    if (!this.isRange) return this.min;
    const r = rng ? rng() : Math.random();
    return this.min + r * (this.max - this.min);
  }

  /** Multiply range by a scalar, preserving range-ness. */
  mul(k: number): RangeOrValue {
    if (this.isNull) return this;
    if (this.isRange) return RangeOrValue.range(this.min * k, this.max * k);
    return RangeOrValue.single(this.min * k);
  }

  toString(): string {
    if (this.isNull) return 'null';
    if (this.isRange) return `${this.min}to${this.max}`;
    return `${this.min}`;
  }
}
