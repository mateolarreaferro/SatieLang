using UnityEngine;

namespace Satie
{
    public static class EaseFunctions
    {
        public delegate float EaseFunction(float t);

        public static float Linear(float t) => t;

        public static float EaseInSine(float t) => 1 - Mathf.Cos((t * Mathf.PI) / 2);
        public static float EaseOutSine(float t) => Mathf.Sin((t * Mathf.PI) / 2);
        public static float EaseInOutSine(float t) => -(Mathf.Cos(Mathf.PI * t) - 1) / 2;

        public static float EaseInQuad(float t) => t * t;
        public static float EaseOutQuad(float t) => t * (2 - t);
        public static float EaseInOutQuad(float t) => t < 0.5f ? 2 * t * t : -1 + (4 - 2 * t) * t;

        public static float EaseInCubic(float t) => t * t * t;
        public static float EaseOutCubic(float t) => (--t) * t * t + 1;
        public static float EaseInOutCubic(float t) => t < 0.5f ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;

        public static float EaseInQuart(float t) => t * t * t * t;
        public static float EaseOutQuart(float t) => 1 - (--t) * t * t * t;
        public static float EaseInOutQuart(float t) => t < 0.5f ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t;

        public static float EaseInQuint(float t) => t * t * t * t * t;
        public static float EaseOutQuint(float t) => 1 + (--t) * t * t * t * t;
        public static float EaseInOutQuint(float t) => t < 0.5f ? 16 * t * t * t * t * t : 1 + 16 * (--t) * t * t * t * t;

        public static float EaseInExpo(float t) => t == 0 ? 0 : Mathf.Pow(2, 10 * t - 10);
        public static float EaseOutExpo(float t) => t == 1 ? 1 : 1 - Mathf.Pow(2, -10 * t);
        public static float EaseInOutExpo(float t)
        {
            if (t == 0) return 0;
            if (t == 1) return 1;
            if (t < 0.5f) return Mathf.Pow(2, 20 * t - 10) / 2;
            return (2 - Mathf.Pow(2, -20 * t + 10)) / 2;
        }

        public static float EaseInCirc(float t) => 1 - Mathf.Sqrt(1 - Mathf.Pow(t, 2));
        public static float EaseOutCirc(float t) => Mathf.Sqrt(1 - Mathf.Pow(t - 1, 2));
        public static float EaseInOutCirc(float t) => t < 0.5f
            ? (1 - Mathf.Sqrt(1 - Mathf.Pow(2 * t, 2))) / 2
            : (Mathf.Sqrt(1 - Mathf.Pow(-2 * t + 2, 2)) + 1) / 2;

        public static float EaseInBack(float t)
        {
            const float c1 = 1.70158f;
            const float c3 = c1 + 1;
            return c3 * t * t * t - c1 * t * t;
        }

        public static float EaseOutBack(float t)
        {
            const float c1 = 1.70158f;
            const float c3 = c1 + 1;
            return 1 + c3 * Mathf.Pow(t - 1, 3) + c1 * Mathf.Pow(t - 1, 2);
        }

        public static float EaseInOutBack(float t)
        {
            const float c1 = 1.70158f;
            const float c2 = c1 * 1.525f;
            return t < 0.5f
                ? (Mathf.Pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
                : (Mathf.Pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
        }

        public static float EaseInElastic(float t)
        {
            const float c4 = (2 * Mathf.PI) / 3;
            if (t == 0) return 0;
            if (t == 1) return 1;
            return -Mathf.Pow(2, 10 * t - 10) * Mathf.Sin((t * 10 - 10.75f) * c4);
        }

        public static float EaseOutElastic(float t)
        {
            const float c4 = (2 * Mathf.PI) / 3;
            if (t == 0) return 0;
            if (t == 1) return 1;
            return Mathf.Pow(2, -10 * t) * Mathf.Sin((t * 10 - 0.75f) * c4) + 1;
        }

        public static float EaseInOutElastic(float t)
        {
            const float c5 = (2 * Mathf.PI) / 4.5f;
            if (t == 0) return 0;
            if (t == 1) return 1;
            if (t < 0.5f)
                return -(Mathf.Pow(2, 20 * t - 10) * Mathf.Sin((20 * t - 11.125f) * c5)) / 2;
            return (Mathf.Pow(2, -20 * t + 10) * Mathf.Sin((20 * t - 11.125f) * c5)) / 2 + 1;
        }

        public static float EaseInBounce(float t) => 1 - EaseOutBounce(1 - t);

        public static float EaseOutBounce(float t)
        {
            const float n1 = 7.5625f;
            const float d1 = 2.75f;

            if (t < 1 / d1)
            {
                return n1 * t * t;
            }
            else if (t < 2 / d1)
            {
                return n1 * (t -= 1.5f / d1) * t + 0.75f;
            }
            else if (t < 2.5f / d1)
            {
                return n1 * (t -= 2.25f / d1) * t + 0.9375f;
            }
            else
            {
                return n1 * (t -= 2.625f / d1) * t + 0.984375f;
            }
        }

        public static float EaseInOutBounce(float t) => t < 0.5f
            ? (1 - EaseOutBounce(1 - 2 * t)) / 2
            : (1 + EaseOutBounce(2 * t - 1)) / 2;

        public static float Sine(float t) => (Mathf.Sin(t * Mathf.PI * 2 - Mathf.PI * 0.5f) + 1f) * 0.5f;

        public static float SineReturn(float t) => Mathf.Sin(t * Mathf.PI);

        public static float CosineReturn(float t) => (1f - Mathf.Cos(t * Mathf.PI * 2)) * 0.5f;

        public static float ElasticReturn(float t)
        {
            if (t <= 0.5f)
                return EaseOutElastic(t * 2);
            else
                return EaseOutElastic((1 - t) * 2);
        }

        public static float BounceReturn(float t)
        {
            if (t <= 0.5f)
                return EaseOutBounce(t * 2);
            else
                return EaseOutBounce((1 - t) * 2);
        }

        public static EaseFunction GetEaseFunction(string name)
        {
            return name?.ToLower() switch
            {
                "linear" => Linear,
                // Support both old and new naming conventions
                "easeinsine" or "insine" => EaseInSine,
                "easeoutsine" or "outsine" => EaseOutSine,
                "easeinoutsine" or "inoutsine" => EaseInOutSine,
                "easeinquad" or "inquad" => EaseInQuad,
                "easeoutquad" or "outquad" => EaseOutQuad,
                "easeinoutquad" or "inoutquad" => EaseInOutQuad,
                "easeincubic" or "incubic" => EaseInCubic,
                "easeoutcubic" or "outcubic" => EaseOutCubic,
                "easeinoutcubic" or "inoutcubic" => EaseInOutCubic,
                "easeinquart" or "inquart" => EaseInQuart,
                "easeoutquart" or "outquart" => EaseOutQuart,
                "easeinoutquart" or "inoutquart" => EaseInOutQuart,
                "easeinquint" or "inquint" => EaseInQuint,
                "easeoutquint" or "outquint" => EaseOutQuint,
                "easeinoutquint" or "inoutquint" => EaseInOutQuint,
                "easeinexpo" or "inexpo" => EaseInExpo,
                "easeoutexpo" or "outexpo" => EaseOutExpo,
                "easeinoutexpo" or "inoutexpo" => EaseInOutExpo,
                "easeincirc" or "incirc" => EaseInCirc,
                "easeoutcirc" or "outcirc" => EaseOutCirc,
                "easeinoutcirc" or "inoutcirc" => EaseInOutCirc,
                "easeinback" or "inback" => EaseInBack,
                "easeoutback" or "outback" => EaseOutBack,
                "easeinoutback" or "inoutback" => EaseInOutBack,
                "easeinelastic" or "inelastic" => EaseInElastic,
                "easeoutelastic" or "outelastic" => EaseOutElastic,
                "easeinoutelastic" or "inoutelastic" => EaseInOutElastic,
                "easeinbounce" or "inbounce" => EaseInBounce,
                "easeoutbounce" or "outbounce" => EaseOutBounce,
                "easeinoutbounce" or "inoutbounce" => EaseInOutBounce,
                "sine" => Sine,
                "sinereturn" => SineReturn,
                "cosinereturn" => CosineReturn,
                "elasticreturn" => ElasticReturn,
                "bouncereturn" => BounceReturn,
                _ => Linear
            };
        }
    }
}