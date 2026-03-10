/**
 * Easing functions for interpolation.
 * Ported from Satie Unity: EaseFunctions.cs
 */

export type EaseFunction = (t: number) => number;

export const linear: EaseFunction = (t) => t;

export const easeInSine: EaseFunction = (t) => 1 - Math.cos((t * Math.PI) / 2);
export const easeOutSine: EaseFunction = (t) => Math.sin((t * Math.PI) / 2);
export const easeInOutSine: EaseFunction = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

export const easeInQuad: EaseFunction = (t) => t * t;
export const easeOutQuad: EaseFunction = (t) => t * (2 - t);
export const easeInOutQuad: EaseFunction = (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

export const easeInCubic: EaseFunction = (t) => t * t * t;
export const easeOutCubic: EaseFunction = (t) => { const t1 = t - 1; return t1 * t1 * t1 + 1; };
export const easeInOutCubic: EaseFunction = (t) =>
  t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;

export const easeInQuart: EaseFunction = (t) => t * t * t * t;
export const easeOutQuart: EaseFunction = (t) => { const t1 = t - 1; return 1 - t1 * t1 * t1 * t1; };
export const easeInOutQuart: EaseFunction = (t) => {
  const t1 = t - 1;
  return t < 0.5 ? 8 * t * t * t * t : 1 - 8 * t1 * t1 * t1 * t1;
};

export const easeInQuint: EaseFunction = (t) => t * t * t * t * t;
export const easeOutQuint: EaseFunction = (t) => { const t1 = t - 1; return 1 + t1 * t1 * t1 * t1 * t1; };
export const easeInOutQuint: EaseFunction = (t) => {
  const t1 = t - 1;
  return t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * t1 * t1 * t1 * t1 * t1;
};

export const easeInExpo: EaseFunction = (t) => t === 0 ? 0 : Math.pow(2, 10 * t - 10);
export const easeOutExpo: EaseFunction = (t) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
export const easeInOutExpo: EaseFunction = (t) => {
  if (t === 0) return 0;
  if (t === 1) return 1;
  if (t < 0.5) return Math.pow(2, 20 * t - 10) / 2;
  return (2 - Math.pow(2, -20 * t + 10)) / 2;
};

export const easeInCirc: EaseFunction = (t) => 1 - Math.sqrt(1 - t * t);
export const easeOutCirc: EaseFunction = (t) => Math.sqrt(1 - (t - 1) * (t - 1));
export const easeInOutCirc: EaseFunction = (t) =>
  t < 0.5
    ? (1 - Math.sqrt(1 - (2 * t) * (2 * t))) / 2
    : (Math.sqrt(1 - (-2 * t + 2) * (-2 * t + 2)) + 1) / 2;

export const easeInBack: EaseFunction = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return c3 * t * t * t - c1 * t * t;
};

export const easeOutBack: EaseFunction = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export const easeInOutBack: EaseFunction = (t) => {
  const c1 = 1.70158;
  const c2 = c1 * 1.525;
  return t < 0.5
    ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
};

export const easeInElastic: EaseFunction = (t) => {
  const c4 = (2 * Math.PI) / 3;
  if (t === 0) return 0;
  if (t === 1) return 1;
  return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
};

export const easeOutElastic: EaseFunction = (t) => {
  const c4 = (2 * Math.PI) / 3;
  if (t === 0) return 0;
  if (t === 1) return 1;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

export const easeInOutElastic: EaseFunction = (t) => {
  const c5 = (2 * Math.PI) / 4.5;
  if (t === 0) return 0;
  if (t === 1) return 1;
  if (t < 0.5) return -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2;
  return (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1;
};

export const easeOutBounce: EaseFunction = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }
  if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
  t -= 2.625 / d1;
  return n1 * t * t + 0.984375;
};

export const easeInBounce: EaseFunction = (t) => 1 - easeOutBounce(1 - t);
export const easeInOutBounce: EaseFunction = (t) =>
  t < 0.5 ? (1 - easeOutBounce(1 - 2 * t)) / 2 : (1 + easeOutBounce(2 * t - 1)) / 2;

export const sine: EaseFunction = (t) => (Math.sin(t * Math.PI * 2 - Math.PI * 0.5) + 1) * 0.5;
export const sineReturn: EaseFunction = (t) => Math.sin(t * Math.PI);
export const cosineReturn: EaseFunction = (t) => (1 - Math.cos(t * Math.PI * 2)) * 0.5;

export const elasticReturn: EaseFunction = (t) =>
  t <= 0.5 ? easeOutElastic(t * 2) : easeOutElastic((1 - t) * 2);

export const bounceReturn: EaseFunction = (t) =>
  t <= 0.5 ? easeOutBounce(t * 2) : easeOutBounce((1 - t) * 2);

const easeFunctionMap: Record<string, EaseFunction> = {
  linear,
  insine: easeInSine, easeinsine: easeInSine,
  outsine: easeOutSine, easeoutsine: easeOutSine,
  inoutsine: easeInOutSine, easeinoutsine: easeInOutSine,
  inquad: easeInQuad, easeinquad: easeInQuad,
  outquad: easeOutQuad, easeoutquad: easeOutQuad,
  inoutquad: easeInOutQuad, easeinoutquad: easeInOutQuad,
  incubic: easeInCubic, easeincubic: easeInCubic,
  outcubic: easeOutCubic, easeoutcubic: easeOutCubic,
  inoutcubic: easeInOutCubic, easeinoutcubic: easeInOutCubic,
  inquart: easeInQuart, easeinquart: easeInQuart,
  outquart: easeOutQuart, easeoutquart: easeOutQuart,
  inoutquart: easeInOutQuart, easeinoutquart: easeInOutQuart,
  inquint: easeInQuint, easeinquint: easeInQuint,
  outquint: easeOutQuint, easeoutquint: easeOutQuint,
  inoutquint: easeInOutQuint, easeinoutquint: easeInOutQuint,
  inexpo: easeInExpo, easeinexpo: easeInExpo,
  outexpo: easeOutExpo, easeoutexpo: easeOutExpo,
  inoutexpo: easeInOutExpo, easeinoutexpo: easeInOutExpo,
  incirc: easeInCirc, easeincirc: easeInCirc,
  outcirc: easeOutCirc, easeoutcirc: easeOutCirc,
  inoutcirc: easeInOutCirc, easeinoutcirc: easeInOutCirc,
  inback: easeInBack, easeinback: easeInBack,
  outback: easeOutBack, easeoutback: easeOutBack,
  inoutback: easeInOutBack, easeinoutback: easeInOutBack,
  inelastic: easeInElastic, easeinelastic: easeInElastic,
  outelastic: easeOutElastic, easeoutelastic: easeOutElastic,
  inoutelastic: easeInOutElastic, easeinoutelastic: easeInOutElastic,
  inbounce: easeInBounce, easeinbounce: easeInBounce,
  outbounce: easeOutBounce, easeoutbounce: easeOutBounce,
  inoutbounce: easeInOutBounce, easeinoutbounce: easeInOutBounce,
  sine,
  sinereturn: sineReturn,
  cosinereturn: cosineReturn,
  elasticreturn: elasticReturn,
  bouncereturn: bounceReturn,
};

export function getEaseFunction(name: string | null | undefined): EaseFunction {
  if (!name) return linear;
  return easeFunctionMap[name.toLowerCase()] ?? linear;
}
