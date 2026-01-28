using UnityEngine;

namespace Satie
{
    public enum InterpolationType
    {
        Interpolate,
        Goto,
        GoBetween
    }

    public class InterpolationData
    {
        public RangeOrValue minRange;
        public RangeOrValue maxRange;
        public RangeOrValue durationRange;
        public string easeName;
        public float minValue;
        public float maxValue;
        public int repeatCount;
        public bool isForever;
        public InterpolationType interpolationType;

        public InterpolationData(RangeOrValue min, RangeOrValue max, string easeName, RangeOrValue dur, int count = 1, bool forever = false, InterpolationType type = InterpolationType.Interpolate)
        {
            minRange = min;
            maxRange = max;
            durationRange = dur;
            this.easeName = easeName;
            interpolationType = type;
            repeatCount = count;
            isForever = forever;

            minValue = min.Sample();
            maxValue = max.Sample();
        }

        public static InterpolationData Parse(string interpolateStr)
        {
            if (string.IsNullOrWhiteSpace(interpolateStr)) return null;

            // Try goto with optional easing (defaults to linear)
            // Pattern: goto(0and1 in 2) or goto(0and1 as inquad in 2)
            var gotoPattern = @"goto\s*\(\s*(?<min>-?[\d.]+(?:to-?[\d.]+)?)\s*and\s*(?<max>-?[\d.]+(?:to-?[\d.]+)?)\s*(?:as\s+(?<ease>\w+))?\s+in\s+(?<dur>-?[\d.]+(?:to-?[\d.]+)?)\s*\)";
            var gotoRegex = new System.Text.RegularExpressions.Regex(gotoPattern, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            var gotoMatch = gotoRegex.Match(interpolateStr);

            if (gotoMatch.Success)
            {
                RangeOrValue min = RangeOrValue.Parse(gotoMatch.Groups["min"].Value);
                RangeOrValue max = RangeOrValue.Parse(gotoMatch.Groups["max"].Value);
                string easeName = gotoMatch.Groups["ease"].Success ? gotoMatch.Groups["ease"].Value : "linear";
                RangeOrValue duration = RangeOrValue.Parse(gotoMatch.Groups["dur"].Value);
                return new InterpolationData(min, max, easeName, duration, 1, false, InterpolationType.Goto);
            }

            // Try gobetween with optional easing (defaults to linear)
            // Pattern: gobetween(0and1 in 2) or gobetween(0 and 1 in 2) or gobetween(0and1 as inquad in 2)
            var goBetweenPattern = @"gobetween\s*\(\s*(?<min>-?[\d.]+(?:to-?[\d.]+)?)\s*and\s*(?<max>-?[\d.]+(?:to-?[\d.]+)?)\s*(?:as\s+(?<ease>\w+))?\s+in\s+(?<dur>-?[\d.]+(?:to-?[\d.]+)?)\s*(?:\s+for\s+(?<count>ever|\d+))?\s*\)";
            var goBetweenRegex = new System.Text.RegularExpressions.Regex(goBetweenPattern, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            var goBetweenMatch = goBetweenRegex.Match(interpolateStr);

            if (goBetweenMatch.Success)
            {
                RangeOrValue min = RangeOrValue.Parse(goBetweenMatch.Groups["min"].Value);
                RangeOrValue max = RangeOrValue.Parse(goBetweenMatch.Groups["max"].Value);
                string easeName = goBetweenMatch.Groups["ease"].Success ? goBetweenMatch.Groups["ease"].Value : "linear";
                RangeOrValue duration = RangeOrValue.Parse(goBetweenMatch.Groups["dur"].Value);

                bool forever = true;
                int count = 1;

                if (goBetweenMatch.Groups["count"].Success)
                {
                    string countStr = goBetweenMatch.Groups["count"].Value.ToLower();
                    if (countStr == "ever")
                    {
                        forever = true;
                    }
                    else
                    {
                        forever = false;
                        count = int.Parse(countStr);
                    }
                }

                return new InterpolationData(min, max, easeName, duration, count, forever, InterpolationType.GoBetween);
            }

            var pattern = @"interpolate\s*\(\s*(?<min>-?[\d.]+(?:to-?[\d.]+)?)\s*and\s*(?<max>-?[\d.]+(?:to-?[\d.]+)?)\s+as\s+(?<ease>\w+)\s+in\s+(?<dur>-?[\d.]+(?:to-?[\d.]+)?)\s*(?:\s+for\s+(?<count>ever|\d+))?\s*\)";
            var regex = new System.Text.RegularExpressions.Regex(pattern, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            var match = regex.Match(interpolateStr);

            if (!match.Success) return null;

            RangeOrValue minLegacy = RangeOrValue.Parse(match.Groups["min"].Value);
            RangeOrValue maxLegacy = RangeOrValue.Parse(match.Groups["max"].Value);
            string easeNameLegacy = match.Groups["ease"].Value;
            RangeOrValue durationLegacy = RangeOrValue.Parse(match.Groups["dur"].Value);

            bool foreverLegacy = false;
            int countLegacy = 1;

            if (match.Groups["count"].Success)
            {
                string countStr = match.Groups["count"].Value.ToLower();
                if (countStr == "ever")
                {
                    foreverLegacy = true;
                }
                else
                {
                    countLegacy = int.Parse(countStr);
                }
            }

            return new InterpolationData(minLegacy, maxLegacy, easeNameLegacy, durationLegacy, countLegacy, foreverLegacy, InterpolationType.Interpolate);
        }
    }
}
