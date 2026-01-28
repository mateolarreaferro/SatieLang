using System.Text.RegularExpressions;
using UnityEngine;

namespace Satie
{
    internal static class SatieUtil
    {
        static readonly Regex clipRangeRx =
            new(@"^(.*\/)?(\d+)to(\d+)$",
                RegexOptions.Compiled);

        public static string ResolveClip(string pattern, SatieRandom random)
        {
            var m = clipRangeRx.Match(pattern);
            if (!m.Success)
                return pattern;

            int min = int.Parse(m.Groups[2].Value);
            int max = int.Parse(m.Groups[3].Value) + 1;
            int choice = random.Range(min, max);

            int digits = m.Groups[2].Value.Length;
            string idx = choice.ToString().PadLeft(digits, '0');

            string prefix = m.Groups[1].Success ? m.Groups[1].Value : string.Empty;
            return prefix + idx;
        }
    }
}