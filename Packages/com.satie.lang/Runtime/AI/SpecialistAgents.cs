using System;
using System.Collections.Generic;
using System.Linq;
using System.IO;
using System.Threading.Tasks;
using UnityEngine;

namespace Satie.AI
{
    /// <summary>
    /// Fast specialist agent for syntax validation
    /// Uses Haiku for speed - validates Satie DSL syntax rules
    /// </summary>
    public class SyntaxValidatorAgent
    {
        private readonly ILLMProvider _provider;

        public SyntaxValidatorAgent(ILLMProvider provider)
        {
            _provider = provider;
        }

        public async Task<SyntaxValidationResult> ValidateAsync(string prompt)
        {
            var systemPrompt = @"You are a syntax validator for the Satie audio DSL.

Analyze the user's request and identify potential syntax requirements.

VALID SYNTAX RULES (NO COLONS, NO QUOTES):
- Statements: loop audio/file OR oneshot audio/file every 2to5
- Properties: volume 0.5 OR pitch 0.8to1.2 (space-separated, NO equals)
- Interpolation: volume goto(0and0.2 in 5) OR pitch gobetween(1and2 in 10)
- Easing: gobetween(0and255 as incubic in 20) - supports: linear, inquad, incubic, inoutquad
- Movement: move walk OR move fly speed 1to3 OR move x -10to10 y 0to15 z -10to5 speed 2
- Color: color red gobetween(0and255 as incubic in 20) green 0to255 blue 100
- Effects: delay wet 0.9 time 0.5to0.9 feedback 0.2to1
          reverb wet 0.8 size 0.9
          filter mode lowpass cutoff gobetween(300and3000 in 15)
- Visual commands: visual sphere OR visual trail OR visual cube OR visual trail and sphere
- Ranges: 1to5, -10to10, 0.1to0.5 (NO SPACES around 'to')

Respond with ONLY a JSON object:
{
  ""needsMovement"": true/false,
  ""needsVisuals"": true/false,
  ""estimatedStatements"": number,
  ""warnings"": [""list of potential syntax issues""]
}";

            var request = new GenerateRequest
            {
                Prompt = prompt,
                SystemPrompt = systemPrompt,
                Temperature = 0.2f,
                MaxTokens = 500,
                UseCache = false
            };

            var response = await _provider.GenerateAsync(request);

            if (!response.Success)
            {
                return new SyntaxValidationResult
                {
                    Success = false,
                    Error = response.Error
                };
            }

            try
            {
                var result = JsonUtility.FromJson<SyntaxValidationResult>(response.Content);
                result.Success = true;
                result.LatencyMs = response.LatencyMs;
                return result;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[SyntaxValidator] Failed to parse response: {e.Message}");
                return new SyntaxValidationResult
                {
                    Success = true, // Don't block generation on parse failure
                    NeedsMovement = false,
                    NeedsVisuals = false,
                    EstimatedStatements = 1,
                    LatencyMs = response.LatencyMs
                };
            }
        }
    }

    [System.Serializable]
    public class SyntaxValidationResult
    {
        public bool Success;
        public bool NeedsMovement;
        public bool NeedsVisuals;
        public int EstimatedStatements;
        public string[] Warnings;
        public long LatencyMs;
        public string Error;
    }

    /// <summary>
    /// Fast specialist agent for library checking
    /// Validates that requested audio samples exist, suggests alternatives
    /// </summary>
    public class LibraryCheckerAgent
    {
        private readonly ILLMProvider _provider;
        private readonly HashSet<string> _availableAudio;

        public LibraryCheckerAgent(ILLMProvider provider)
        {
            _provider = provider;
            _availableAudio = ScanAudioLibrary();
        }

        public async Task<LibraryCheckResult> CheckAsync(string prompt)
        {
            // Quick local check first (no API call needed!)
            var requestedSounds = ExtractSoundKeywords(prompt);
            var missing = new List<string>();
            var available = new List<string>();

            foreach (var keyword in requestedSounds)
            {
                var matches = _availableAudio
                    .Where(a => a.ToLower().Contains(keyword.ToLower()))
                    .ToList();

                if (matches.Count > 0)
                {
                    available.AddRange(matches);
                }
                else
                {
                    missing.Add(keyword);
                }
            }

            // If everything is available, return immediately (fast path!)
            if (missing.Count == 0)
            {
                return new LibraryCheckResult
                {
                    Success = true,
                    AllSamplesAvailable = true,
                    AvailableSamples = available.Distinct().ToArray(),
                    MissingSamples = new string[0],
                    LatencyMs = 0 // Local check, no latency
                };
            }

            // If some samples are missing, ask LLM for suggestions
            var systemPrompt = $@"You are an audio library assistant.

Available audio samples:
{string.Join("\n", _availableAudio.Take(200))}

User requested: {prompt}

Missing sounds: {string.Join(", ", missing)}

Suggest the best available alternatives. Respond with ONLY a JSON object:
{{
  ""suggestions"": [""path/to/sample1"", ""path/to/sample2""],
  ""canGenerate"": true/false
}}";

            var request = new GenerateRequest
            {
                Prompt = $"Find alternatives for: {string.Join(", ", missing)}",
                SystemPrompt = systemPrompt,
                Temperature = 0.3f,
                MaxTokens = 300,
                UseCache = true
            };

            var response = await _provider.GenerateAsync(request);

            return new LibraryCheckResult
            {
                Success = response.Success,
                AllSamplesAvailable = false,
                AvailableSamples = available.Distinct().ToArray(),
                MissingSamples = missing.ToArray(),
                SuggestedAlternatives = ParseSuggestions(response.Content),
                LatencyMs = response.LatencyMs,
                Error = response.Error
            };
        }

        public HashSet<string> GetAvailableAudio() => _availableAudio;

        private HashSet<string> ScanAudioLibrary()
        {
            var audioFiles = new HashSet<string>();

            try
            {
                string audioPath = Path.Combine(Application.dataPath, "Resources", "Audio");

                if (!Directory.Exists(audioPath))
                {
                    Debug.LogWarning("[LibraryChecker] No Resources/Audio directory found");
                    return audioFiles;
                }

                var supportedExtensions = new[] { ".wav", ".mp3", ".ogg", ".aiff", ".aif" };

                foreach (string file in Directory.GetFiles(audioPath, "*", SearchOption.AllDirectories))
                {
                    string extension = Path.GetExtension(file).ToLower();
                    if (supportedExtensions.Contains(extension))
                    {
                        string relativePath = Path.GetRelativePath(audioPath, file);
                        string audioName = Path.ChangeExtension(relativePath, null).Replace('\\', '/');
                        audioFiles.Add(audioName);
                    }
                }

                Debug.Log($"[LibraryChecker] Found {audioFiles.Count} audio files");
            }
            catch (Exception e)
            {
                Debug.LogError($"[LibraryChecker] Failed to scan audio library: {e.Message}");
            }

            return audioFiles;
        }

        private List<string> ExtractSoundKeywords(string prompt)
        {
            // Extract common sound keywords from prompt
            var keywords = new List<string>();
            var commonSounds = new[] {
                "bird", "piano", "ambience", "voice", "conversation",
                "bicycle", "animal", "music", "sacred", "wind",
                "forest", "rain", "thunder", "ocean", "river"
            };

            foreach (var sound in commonSounds)
            {
                if (prompt.ToLower().Contains(sound))
                {
                    keywords.Add(sound);
                }
            }

            return keywords;
        }

        private string[] ParseSuggestions(string jsonResponse)
        {
            try
            {
                var result = JsonUtility.FromJson<SuggestionResponse>(jsonResponse);
                return result?.suggestions ?? new string[0];
            }
            catch
            {
                return new string[0];
            }
        }

        [System.Serializable]
        private class SuggestionResponse
        {
            public string[] suggestions;
            public bool canGenerate;
        }
    }

    [System.Serializable]
    public class LibraryCheckResult
    {
        public bool Success;
        public bool AllSamplesAvailable;
        public string[] AvailableSamples;
        public string[] MissingSamples;
        public string[] SuggestedAlternatives;
        public long LatencyMs;
        public string Error;
    }

    /// <summary>
    /// Fast specialist agent for compilation verification
    /// Uses Haiku to analyze parser errors and suggest fixes
    /// </summary>
    public class CompilationVerifierAgent
    {
        private readonly ILLMProvider _provider;

        public CompilationVerifierAgent(ILLMProvider provider)
        {
            _provider = provider;
        }

        public async Task<string> RepairCodeAsync(string generatedCode, string parserErrors, int attemptNumber = 1)
        {
            if (attemptNumber > 2)
            {
                Debug.LogWarning("[CompilationVerifier] Max repair attempts reached");
                return generatedCode;
            }

            var systemPrompt = @"You are a Satie code repair specialist.

Fix the syntax errors in the provided Satie code. Output ONLY the corrected code.

CRITICAL SYNTAX RULES (NO COLONS, NO QUOTES, NO EQUALS):
- Statements: loop audio/file (NOT loop ""audio/file"": or loop = ""audio/file"")
- Statements: oneshot audio/file every 2to5 (NOT oneshot ""audio/file"": every 2to5)
- Properties: volume 0.5 (NOT volume = 0.5 or volume: 0.5)
- Properties: pitch 0.8to1.2 (space-separated, NO equals sign)
- Interpolation: volume goto(0and0.2 in 5) OR pitch gobetween(1and2 in 10)
- Easing: gobetween(0and255 as incubic in 20) - supports: linear, inquad, incubic, inoutquad
- Movement: move walk OR move fly speed 1to3 OR move x -10to10 y 0to15 z -10to5 speed 2
- Color: color red gobetween(0and255 as incubic in 20) green 0to255 blue 100
- Effects: delay wet 0.9 time 0.5to0.9 feedback 0.2to1
          reverb wet 0.8 size 0.9
          filter mode lowpass cutoff gobetween(300and3000 in 15)
- Visual: visual trail OR visual sphere OR visual trail and cube (NOT visual = trail)
- Ranges: 0.5to1.0 (NO SPACES around 'to')
- Numbers: Use dots not commas (0.5 not 0,5)
- NO explanations, NO markdown, NO text before/after code";

            var request = new GenerateRequest
            {
                Prompt = $@"CODE WITH ERRORS:
```
{generatedCode}
```

PARSER ERRORS:
{parserErrors}

Fix these errors and output the corrected code ONLY.",
                SystemPrompt = systemPrompt,
                Temperature = 0.2f,
                MaxTokens = 2000,
                UseCache = false
            };

            var response = await _provider.GenerateAsync(request);

            if (!response.Success)
            {
                Debug.LogError($"[CompilationVerifier] Repair failed: {response.Error}");
                return generatedCode;
            }

            Debug.Log($"[CompilationVerifier] Attempt {attemptNumber} completed in {response.LatencyMs}ms");
            return CleanGeneratedCode(response.Content);
        }

        private string CleanGeneratedCode(string code)
        {
            // Remove markdown code blocks if present
            code = code.Trim();

            if (code.StartsWith("```"))
            {
                var lines = code.Split('\n');
                code = string.Join("\n", lines.Skip(1).Take(lines.Length - 2));
            }

            return code.Trim();
        }
    }

    /// <summary>
    /// Specialist agent for detecting requests for complete script templates
    /// Matches user intent with existing .sat script files
    /// </summary>
    public class ScriptTemplateAgent
    {
        private readonly Dictionary<string, TemplateDefinition> _templates;

        public ScriptTemplateAgent()
        {
            _templates = new Dictionary<string, TemplateDefinition>();
            RegisterTemplates();
        }

        private void RegisterTemplates()
        {
            // Register TK.sat as the avant-garde/experimental template
            _templates["avant-garde"] = new TemplateDefinition
            {
                ScriptPath = "Assets/Satie Scripts/TK.sat",
                Keywords = new[] { "avant-garde", "avant garde", "experimental", "contemporary", "modern composition", "abstract", "atonal" },
                Description = "Avant-garde experimental piece with evolving soundscapes"
            };

            // You can add more templates here in the future
            // _templates["ambient"] = new TemplateDefinition { ... };
        }

        public ScriptTemplateResult CheckForTemplate(string prompt)
        {
            string lowerPrompt = prompt.ToLower();

            // Check for keywords that indicate the user wants a complete piece (not modifications)
            bool wantsNewPiece = lowerPrompt.Contains("make") ||
                                lowerPrompt.Contains("create") ||
                                lowerPrompt.Contains("generate") ||
                                lowerPrompt.Contains("give me") ||
                                lowerPrompt.Contains("show me") ||
                                lowerPrompt.Contains("initial") ||
                                lowerPrompt.Contains("starting") ||
                                lowerPrompt.Contains("example") ||
                                lowerPrompt.Contains("template") ||
                                lowerPrompt.Contains("piece") ||
                                lowerPrompt.Contains("composition") ||
                                lowerPrompt.Contains("provide");

            foreach (var template in _templates)
            {
                foreach (var keyword in template.Value.Keywords)
                {
                    if (lowerPrompt.Contains(keyword))
                    {
                        // If they want a new piece (not modifying existing), load the template
                        if (wantsNewPiece)
                        {
                            return new ScriptTemplateResult
                            {
                                HasTemplate = true,
                                TemplateName = template.Key,
                                TemplateScript = LoadTemplateScript(template.Value.ScriptPath),
                                Description = template.Value.Description
                            };
                        }
                    }
                }
            }

            return new ScriptTemplateResult { HasTemplate = false };
        }

        private string LoadTemplateScript(string path)
        {
            try
            {
                if (File.Exists(path))
                {
                    return File.ReadAllText(path);
                }
                else
                {
                    Debug.LogWarning($"[ScriptTemplate] Template file not found: {path}");
                    return null;
                }
            }
            catch (Exception e)
            {
                Debug.LogError($"[ScriptTemplate] Failed to load template: {e.Message}");
                return null;
            }
        }
    }

    [System.Serializable]
    public class TemplateDefinition
    {
        public string ScriptPath;
        public string[] Keywords;
        public string Description;
    }

    [System.Serializable]
    public class ScriptTemplateResult
    {
        public bool HasTemplate;
        public string TemplateName;
        public string TemplateScript;
        public string Description;
    }
}
