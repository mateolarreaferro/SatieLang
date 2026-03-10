/**
 * Interpolation data for dynamic property changes.
 * Supports goto(), gobetween(), and interpolate() syntax.
 * Ported from Satie Unity: InterpolationData.cs
 */
import { RangeOrValue } from './RangeOrValue';

export enum InterpolationType {
  Interpolate = 'interpolate',
  Goto = 'goto',
  GoBetween = 'gobetween',
}

export class InterpolationData {
  minRange: RangeOrValue;
  maxRange: RangeOrValue;
  durationRange: RangeOrValue;
  easeName: string;
  minValue: number;
  maxValue: number;
  repeatCount: number;
  isForever: boolean;
  interpolationType: InterpolationType;

  constructor(
    min: RangeOrValue,
    max: RangeOrValue,
    easeName: string,
    dur: RangeOrValue,
    count: number = 1,
    forever: boolean = false,
    type: InterpolationType = InterpolationType.Interpolate,
  ) {
    this.minRange = min;
    this.maxRange = max;
    this.durationRange = dur;
    this.easeName = easeName;
    this.interpolationType = type;
    this.repeatCount = count;
    this.isForever = forever;
    this.minValue = min.sample();
    this.maxValue = max.sample();
  }

  /**
   * Parse interpolation strings:
   *   goto(0and1 in 2)
   *   goto(0and1 as inquad in 2)
   *   gobetween(0and1 in 2)
   *   gobetween(0and1 as inquad in 2 for 3)
   *   gobetween(0and1 in 2 for ever)
   *   interpolate(0.8and1.2 as incubic in 10)
   */
  static parse(str: string): InterpolationData | null {
    if (!str || !str.trim()) return null;

    // goto(min and max [as ease] in dur)
    const gotoRx = /goto\s*\(\s*(?<min>-?[\d.]+(?:to-?[\d.]+)?)\s*and\s*(?<max>-?[\d.]+(?:to-?[\d.]+)?)\s*(?:as\s+(?<ease>\w+))?\s+in\s+(?<dur>-?[\d.]+(?:to-?[\d.]+)?)\s*\)/i;
    const gotoMatch = str.match(gotoRx);
    if (gotoMatch?.groups) {
      const { min, max, ease, dur } = gotoMatch.groups;
      return new InterpolationData(
        RangeOrValue.parse(min),
        RangeOrValue.parse(max),
        ease ?? 'linear',
        RangeOrValue.parse(dur),
        1,
        false,
        InterpolationType.Goto,
      );
    }

    // gobetween(min and max [as ease] in dur [for count|ever])
    const gbRx = /gobetween\s*\(\s*(?<min>-?[\d.]+(?:to-?[\d.]+)?)\s*and\s*(?<max>-?[\d.]+(?:to-?[\d.]+)?)\s*(?:as\s+(?<ease>\w+))?\s+in\s+(?<dur>-?[\d.]+(?:to-?[\d.]+)?)\s*(?:\s+for\s+(?<count>ever|\d+))?\s*\)/i;
    const gbMatch = str.match(gbRx);
    if (gbMatch?.groups) {
      const { min, max, ease, dur, count } = gbMatch.groups;
      let forever = true;
      let repeatCount = 1;
      if (count) {
        if (count.toLowerCase() === 'ever') {
          forever = true;
        } else {
          forever = false;
          repeatCount = parseInt(count, 10);
        }
      }
      return new InterpolationData(
        RangeOrValue.parse(min),
        RangeOrValue.parse(max),
        ease ?? 'linear',
        RangeOrValue.parse(dur),
        repeatCount,
        forever,
        InterpolationType.GoBetween,
      );
    }

    // interpolate(min and max as ease in dur [for count|ever])
    const interpRx = /interpolate\s*\(\s*(?<min>-?[\d.]+(?:to-?[\d.]+)?)\s*and\s*(?<max>-?[\d.]+(?:to-?[\d.]+)?)\s+as\s+(?<ease>\w+)\s+in\s+(?<dur>-?[\d.]+(?:to-?[\d.]+)?)\s*(?:\s+for\s+(?<count>ever|\d+))?\s*\)/i;
    const interpMatch = str.match(interpRx);
    if (interpMatch?.groups) {
      const { min, max, ease, dur, count } = interpMatch.groups;
      let forever = false;
      let repeatCount = 1;
      if (count) {
        if (count.toLowerCase() === 'ever') {
          forever = true;
        } else {
          repeatCount = parseInt(count, 10);
        }
      }
      return new InterpolationData(
        RangeOrValue.parse(min),
        RangeOrValue.parse(max),
        ease,
        RangeOrValue.parse(dur),
        repeatCount,
        forever,
        InterpolationType.Interpolate,
      );
    }

    return null;
  }
}
