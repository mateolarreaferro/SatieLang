using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;
using UnityEngine;

namespace Satie
{
    public sealed class Statement
    {
        public string kind;
        public string clip;
        public RangeOrValue starts_at = RangeOrValue.Zero;
        public RangeOrValue duration = RangeOrValue.Null;
        public RangeOrValue every = RangeOrValue.Zero;
        public RangeOrValue volume = new(1f);
        public RangeOrValue pitch = new(1f);
        public bool overlap = false;
        public RangeOrValue fade_in = RangeOrValue.Zero;
        public RangeOrValue fade_out = RangeOrValue.Zero;

        public enum WanderType { None, Walk, Fly, Fixed }
        public WanderType wanderType = WanderType.None;
        public Vector3 areaMin, areaMax;
        public RangeOrValue wanderHz = new(0.3f);

        public bool visualize = false;
    }

    public readonly struct RangeOrValue
    {
        public readonly float min, max;
        public readonly bool  isRange, isSet;

        public static readonly RangeOrValue Zero = new(0f);
        public static readonly RangeOrValue Null = default;

        public RangeOrValue(float v) { min = max = v; isRange = false; isSet = true; }
        public RangeOrValue(float a, float b) { min = a; max = b; isRange = true;  isSet = true; }

        public float Sample() => !isSet ? 0f : isRange ? Random.Range(min, max) : min;

        public static RangeOrValue Parse(string s)
        {
            if (string.IsNullOrWhiteSpace(s)) return Null;
            if (s.Contains(".."))
            {
                var p = s.Split("..");
                return new(float.Parse(p[0]), float.Parse(p[1]));
            }
            return new(float.Parse(s));
        }

        public RangeOrValue Mul(float k) =>
            !isSet ? this : isRange ? new(min * k, max * k) : new(min * k);
    }

    // parser
    public static class SatieParser
    {
        static readonly Regex StmtRx = new(
            @"^(?<kind>loop|oneshot)\s+""(?<clip>.+?)""\s*(?:every\s+(?<e1>\d+\.?\d*)\.\.(?<e2>\d+\.?\d*))?\s*:\s*\r?\n" +
            @"(?<block>(?:[ \t]+.*\r?\n?)*)",
            RegexOptions.Multiline | RegexOptions.IgnoreCase | RegexOptions.Compiled);

        static readonly Regex PropRx = new(
            @"^[ \t]*(?<key>\w+)\s*=\s*(?<val>[^\r\n#]+)",
            RegexOptions.Multiline | RegexOptions.Compiled);

        sealed class GroupCtx
        {
            public readonly Dictionary<string,string> props = new();
            public readonly List<Statement> children = new();
            public int indent;
        }

        // Parse
        public static List<Statement> Parse(string script)
        {
            var outList = new List<Statement>();
            var lines   = script.Replace("\r\n", "\n").Split('\n');

            GroupCtx grp = null;

            for (int i = 0; i < lines.Length; ++i)
            {
                string raw  = lines[i];
                if (string.IsNullOrWhiteSpace(raw) || raw.TrimStart().StartsWith("#"))
                    continue;

                int    indent = CountIndent(raw);
                string body   = raw.TrimStart();

                //  close grp?
                if (grp != null &&
                    indent == grp.indent &&
                    (body.StartsWith("loop ",   true, null) ||
                     body.StartsWith("oneshot ",true, null) ||
                     body.StartsWith("group ",  true, null) ||
                     body.StartsWith("endgroup",true, null)))
                {
                    FlushGroup(outList, grp);
                    grp = null;
                }
                if (grp != null && body.StartsWith("endgroup", true, null))
                    continue; // don't treat "endgroup" as a statement

                // open group
                if (body.StartsWith("group ", true, null) && body.TrimEnd().EndsWith(":"))
                {
                    grp = new GroupCtx { indent = indent };
                    continue;
                }

                // statement
                if (body.StartsWith("loop ", true, null) ||
                    body.StartsWith("oneshot ", true, null))
                {
                    int stmtIndent = indent;
                    var sb = new StringBuilder();
                    sb.AppendLine(body);

                    int j = i + 1;
                    while (j < lines.Length && CountIndent(lines[j]) > stmtIndent)
                    {
                        sb.AppendLine(lines[j]);
                        ++j;
                    }
                    i = j - 1;

                    var st = ParseSingle(sb.ToString());
                    if (grp != null) grp.children.Add(st); else outList.Add(st);
                    continue;
                }

                //  property
                if (grp != null && PropRx.IsMatch(body))
                {
                    var m = PropRx.Match(body);
                    string k = m.Groups["key"].Value.ToLower();
                    if (k is "move" or "visualize")
                        Debug.LogWarning($"[Satie] '{k}' not allowed on a group – ignored.");
                    else
                        grp.props[k] = m.Groups["val"].Value.Trim();
                    continue;
                }

                Debug.LogWarning($"[Satie] Unrecognised line: '{body}'");
            }

            if (grp != null) FlushGroup(outList, grp);
            return outList;
        }

        //  PathFor
        public static string PathFor(string clip)
        {
            if (string.IsNullOrWhiteSpace(clip)) return string.Empty;
            string c = clip.Replace('\\','/').TrimStart('/');
            int dot = c.LastIndexOf('.');
            if (dot >= 0) c = c[..dot];
            if (!c.StartsWith("Audio/")) c = $"Audio/{c}";
            return c;
        }

        // helpers
        static Statement ParseSingle(string block)
        {
            var m = StmtRx.Match(block);
            var s = new Statement
            {
                kind = m.Groups["kind"].Value.ToLower(),
                clip = m.Groups["clip"].Value.Trim()
            };

            if (m.Groups["e1"].Success)
                s.every = new RangeOrValue(
                    float.Parse(m.Groups["e1"].Value),
                    float.Parse(m.Groups["e2"].Value));

            foreach (Match p in PropRx.Matches(m.Groups["block"].Value))
            {
                string k = p.Groups["key"].Value.ToLower();
                string v = p.Groups["val"].Value.Trim();
                switch (k)
                {
                    case "volume": s.volume = RangeOrValue.Parse(v); break;
                    case "pitch": s.pitch = RangeOrValue.Parse(v); break;
                    case "starts_at": s.starts_at = RangeOrValue.Parse(v); break;
                    case "duration": s.duration = RangeOrValue.Parse(v); break;
                    case "fade_in": s.fade_in = RangeOrValue.Parse(v); break;
                    case "fade_out": s.fade_out = RangeOrValue.Parse(v); break;
                    case "every": s.every = RangeOrValue.Parse(v); break;
                    case "overlap": s.overlap = v.ToLower().StartsWith("t"); break;
                    case "visualize": s.visualize = v.ToLower().StartsWith("t"); break;
                    case "move": ParseMove(s,v); break;
                }
            }
            return s;
        }

        static void FlushGroup(List<Statement> dst, GroupCtx g)
        {
            bool hasVol = g.props.TryGetValue("volume", out string vRaw);
            bool hasPitch = g.props.TryGetValue("pitch",  out string pRaw);
            float gVol = hasVol   ? RangeOrValue.Parse(vRaw).Sample()  : 1f;
            float gPitch = hasPitch ? RangeOrValue.Parse(pRaw).Sample()  : 1f;

            foreach (var s in g.children)
            {
                if (hasVol) s.volume = s.volume.isSet ? s.volume.Mul(gVol) : new RangeOrValue(gVol);
                if (hasPitch) s.pitch = s.pitch.isSet  ? s.pitch .Mul(gPitch) : new RangeOrValue(gPitch);

                foreach (var kv in g.props)
                {
                    switch (kv.Key)
                    {
                        case "volume":
                        case "pitch": break;   // done above
                        case "starts_at" when !s.starts_at.isSet: s.starts_at = RangeOrValue.Parse(kv.Value); break;
                        case "duration" when !s.duration.isSet: s.duration = RangeOrValue.Parse(kv.Value); break;
                        case "fade_in" when !s.fade_in.isSet: s.fade_in = RangeOrValue.Parse(kv.Value); break;
                        case "fade_out" when !s.fade_out.isSet: s.fade_out = RangeOrValue.Parse(kv.Value); break;
                        case "every" when !s.every.isSet: s.every = RangeOrValue.Parse(kv.Value); break;
                        case "overlap": s.overlap = kv.Value.ToLower().StartsWith("t"); break;
                    }
                }
                dst.Add(s);
            }
        }

        static int CountIndent(string line)
        {
            int n = 0; while (n < line.Length && (line[n]==' ' || line[n]=='\t')) ++n; return n;
        }

        static void ParseMove(Statement s,string v)
        {
            string[] t = v.Split(',');
            if (t.Length < 4) { Debug.LogError("move: not enough parameters"); return; }

            static (float,float) R(string str)
            {
                if (str.Contains("..")) { var p=str.Split(".."); return (float.Parse(p[0]),float.Parse(p[1])); }
                float f=float.Parse(str); return (f,f);
            }

            string mode=t[0].Trim().ToLower();
            if (mode=="walk" && t.Length==4)
            {
                var (xmin,xmax)=R(t[1]); var (zmin,zmax)=R(t[2]);
                s.wanderType=Statement.WanderType.Walk;
                s.areaMin=new Vector3(xmin,0f,zmin); s.areaMax=new Vector3(xmax,0f,zmax);
                s.wanderHz=RangeOrValue.Parse(t[3]);
            }
            else if (mode=="fly" && t.Length==5)
            {
                var (xmin,xmax)=R(t[1]); var (ymin,ymax)=R(t[2]); var (zmin,zmax)=R(t[3]);
                s.wanderType=Statement.WanderType.Fly;
                s.areaMin=new Vector3(xmin,ymin,zmin); s.areaMax=new Vector3(xmax,ymax,zmax);
                s.wanderHz=RangeOrValue.Parse(t[4]);
            }
            else if (mode=="pos" && t.Length==4)
            {
                var (xmin,xmax)=R(t[1]); var (ymin,ymax)=R(t[2]); var (zmin,zmax)=R(t[3]);
                s.wanderType=Statement.WanderType.Fixed;
                s.areaMin=new Vector3(xmin,ymin,zmin); s.areaMax=new Vector3(xmax,ymax,zmax);
            }
            else Debug.LogError($"move: bad syntax '{v}'");
        }
    }
}
