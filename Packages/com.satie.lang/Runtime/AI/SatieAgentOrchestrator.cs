using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using UnityEngine;

namespace Satie.AI
{
    /// <summary>
    /// Hierarchical orchestrator that coordinates specialist agents
    /// for fast, correct Satie code generation
    ///
    /// Architecture:
    /// - Orchestrator (Sonnet 4.5): Main code generation
    /// - Syntax Validator (Haiku 4.5): Parallel syntax checking
    /// - Library Checker (Haiku 4.5): Parallel sample validation
    /// - Compilation Verifier (Haiku 4.5): Post-generation error fixing
    /// </summary>
    public class SatieAgentOrchestrator : MonoBehaviour
    {
        private static SatieAgentOrchestrator _instance;
        public static SatieAgentOrchestrator Instance
        {
            get
            {
                if (_instance == null)
                {
                    var go = new GameObject("SatieAgentOrchestrator");
                    _instance = go.AddComponent<SatieAgentOrchestrator>();
                    DontDestroyOnLoad(go);
                }
                return _instance;
            }
        }

        [Header("Model Configuration")]
        [SerializeField] private string orchestratorModel = "claude-sonnet-4-5-20250929";
        [SerializeField] private string specialistModel = "claude-haiku-4-5-20251001";

        private ILLMProvider _orchestrator;
        private ILLMProvider _specialist;

        private SyntaxValidatorAgent _syntaxValidator;
        private LibraryCheckerAgent _libraryChecker;
        private CompilationVerifierAgent _compilationVerifier;
        private ScriptTemplateAgent _scriptTemplateAgent;

        private bool _initialized = false;
        private bool _initializing = false;
        private Task _initializationTask;

        // Event for streaming updates
        public event Action<string> OnStreamUpdate;
        public event Action<GenerationMetrics> OnGenerationComplete;

        private void Start()
        {
            Initialize();
        }

        public async void Initialize()
        {
            if (_initialized || _initializing) return;

            _initializationTask = InitializeAsync();
            await _initializationTask;
        }

        private async Task InitializeAsync()
        {
            if (_initialized || _initializing) return;

            _initializing = true;

            try
            {
                UnityEngine.Debug.Log("[Orchestrator] Initializing multi-agent system...");

                // Create providers
                _orchestrator = new AnthropicProvider(orchestratorModel);
                _specialist = new AnthropicProvider(specialistModel);

                // Create specialist agents (ScriptTemplateAgent doesn't need API access)
                _syntaxValidator = new SyntaxValidatorAgent(_specialist);
                _libraryChecker = new LibraryCheckerAgent(_specialist);
                _compilationVerifier = new CompilationVerifierAgent(_specialist);
                _scriptTemplateAgent = new ScriptTemplateAgent();

                // Health check
                bool orchestratorHealthy = await _orchestrator.IsHealthyAsync();
                bool specialistHealthy = await _specialist.IsHealthyAsync();

                if (!orchestratorHealthy || !specialistHealthy)
                {
                    UnityEngine.Debug.LogError("[Orchestrator] Health check failed. Please configure Anthropic API key.");
                    _initializing = false;
                    return;
                }

                _initialized = true;
                UnityEngine.Debug.Log("[Orchestrator] Initialization complete!");
            }
            catch (Exception e)
            {
                UnityEngine.Debug.LogError($"[Orchestrator] Initialization failed: {e.Message}");
            }
            finally
            {
                _initializing = false;
            }
        }

        /// <summary>
        /// Generate Satie code with full orchestration pipeline
        /// </summary>
        public async Task<CodeGenerationResult> GenerateCodeAsync(string userPrompt, string currentScript = null)
        {
            // Wait for initialization if needed
            if (!_initialized)
            {
                if (_initializing && _initializationTask != null)
                {
                    UnityEngine.Debug.Log("[Orchestrator] Waiting for initialization to complete...");
                    await _initializationTask;
                }
                else if (!_initializing)
                {
                    UnityEngine.Debug.Log("[Orchestrator] Starting initialization...");
                    await InitializeAsync();
                }

                // If still not initialized after waiting, return error
                if (!_initialized)
                {
                    UnityEngine.Debug.LogError("[Orchestrator] Initialization failed. Check API key configuration.");
                    return new CodeGenerationResult { Success = false, Error = "Initialization failed. Check API key configuration." };
                }
            }

            var overallStopwatch = Stopwatch.StartNew();
            var metrics = new GenerationMetrics();

            try
            {
                // Step 0: Check if this matches a script template (ULTRA FAST!)
                // Templates work even without API access!
                var templateResult = _scriptTemplateAgent.CheckForTemplate(userPrompt);

                if (templateResult.HasTemplate && !string.IsNullOrEmpty(templateResult.TemplateScript))
                {
                    UnityEngine.Debug.Log($"[Orchestrator] Template matched: {templateResult.TemplateName}");
                    OnStreamUpdate?.Invoke($"Loading {templateResult.Description}...\n\n{templateResult.TemplateScript}");

                    overallStopwatch.Stop();

                    return new CodeGenerationResult
                    {
                        Success = true,
                        Code = templateResult.TemplateScript,
                        Explanation = $"Loaded template: {templateResult.Description}",
                        MissingSamples = new List<string>(),
                        Metrics = new GenerationMetrics
                        {
                            TotalLatencyMs = overallStopwatch.ElapsedMilliseconds,
                            ValidationLatencyMs = 0,
                            GenerationLatencyMs = 0,
                            VerificationLatencyMs = 0,
                            RepairAttempts = 0
                        }
                    };
                }

                // Step 1: Immediate acknowledgment
                OnStreamUpdate?.Invoke("Analyzing your request...");
                await Task.Delay(50); // Small delay for UI responsiveness

                // Step 2: Parallel specialist validation (FAST!)
                var validationStopwatch = Stopwatch.StartNew();

                var syntaxTask = _syntaxValidator.ValidateAsync(userPrompt);
                var libraryTask = _libraryChecker.CheckAsync(userPrompt);

                await Task.WhenAll(syntaxTask, libraryTask);

                var syntaxResult = await syntaxTask;
                var libraryResult = await libraryTask;

                validationStopwatch.Stop();
                metrics.ValidationLatencyMs = validationStopwatch.ElapsedMilliseconds;

                UnityEngine.Debug.Log($"[Orchestrator] Validation complete in {metrics.ValidationLatencyMs}ms");

                // Step 3: Build enriched prompt with constraints
                OnStreamUpdate?.Invoke("Generating code...");

                string enrichedPrompt = BuildEnrichedPrompt(
                    userPrompt,
                    currentScript,
                    syntaxResult,
                    libraryResult
                );

                // Step 4: Generate code with streaming
                var generationStopwatch = Stopwatch.StartNew();
                var codeBuilder = new StringBuilder();

                await foreach (var chunk in _orchestrator.StreamAsync(new GenerateRequest
                {
                    Prompt = enrichedPrompt,
                    SystemPrompt = BuildSystemPrompt(libraryResult),
                    Temperature = 0.7f,
                    MaxTokens = 4000,
                    UseCache = true
                }))
                {
                    codeBuilder.Append(chunk);
                    OnStreamUpdate?.Invoke(chunk);
                }

                generationStopwatch.Stop();
                metrics.GenerationLatencyMs = generationStopwatch.ElapsedMilliseconds;

                string generatedCode = CleanGeneratedCode(codeBuilder.ToString());

                // Step 5: Verify compilation (with self-correction)
                OnStreamUpdate?.Invoke("\n\nVerifying code...");

                var verificationStopwatch = Stopwatch.StartNew();
                var verificationResult = await VerifyAndRepairAsync(generatedCode);
                verificationStopwatch.Stop();

                metrics.VerificationLatencyMs = verificationStopwatch.ElapsedMilliseconds;
                metrics.RepairAttempts = verificationResult.attemptCount;

                overallStopwatch.Stop();
                metrics.TotalLatencyMs = overallStopwatch.ElapsedMilliseconds;

                // Step 6: Return result
                var result = new CodeGenerationResult
                {
                    Success = verificationResult.success,
                    Code = verificationResult.code,
                    Explanation = BuildExplanation(syntaxResult, libraryResult),
                    MissingSamples = libraryResult.MissingSamples?.ToList() ?? new List<string>(),
                    Metrics = metrics,
                    Error = verificationResult.error
                };

                OnGenerationComplete?.Invoke(metrics);

                UnityEngine.Debug.Log($"[Orchestrator] Generation complete! Total: {metrics.TotalLatencyMs}ms");
                return result;
            }
            catch (Exception e)
            {
                overallStopwatch.Stop();
                UnityEngine.Debug.LogError($"[Orchestrator] Generation failed: {e.Message}");

                return new CodeGenerationResult
                {
                    Success = false,
                    Error = e.Message,
                    Metrics = new GenerationMetrics { TotalLatencyMs = overallStopwatch.ElapsedMilliseconds }
                };
            }
        }

        #region Helper Methods

        private string BuildSystemPrompt(LibraryCheckResult libraryResult)
        {
            var availableAudio = _libraryChecker.GetAvailableAudio();
            var audioLibrary = FormatAudioLibrary(availableAudio);

            // Load language spec
            string langSpec = LoadLanguageSpec();

            return $@"{langSpec}

Output ONLY valid Satie code. No explanations, no markdown, no text before or after the code.

STRICT RULES:
- Your response must be pure Satie code only
- NO explanations or descriptions
- NO markdown code blocks
- NO ""Here's your code"" or similar text
- Start directly with the Satie code
- End directly with the Satie code

SIMPLICITY PRINCIPLE - CRITICAL:
- ONLY add features the user explicitly requested
- DO NOT add: visuals, color, reverb, delay, filters, randomstart, pitch variations UNLESS asked
- Keep it minimal - use basic volume levels, no fancy modulation unless requested
- Less is more - don't show off all available features
- If user wants complexity, they will ask for it explicitly

EXAMPLE - User says ""rain and piano flying"":
CORRECT (simple):
loop water/rain
    volume 0.2

oneshot piano/1 every 2to5
    volume 0.3
    move fly

WRONG (over-engineered):
loop water/rain
    volume 0.3
    filter mode lowpass cutoff 2000
    reverb wet 0.4 size 0.8

oneshot piano/1 every 2to4
    pitch 0.8to1.2
    move fly speed 1to3
    visual trail and sphere
    color red gobetween(100and255 as incubic in 5) green 150to200 blue 100
    reverb wet 0.6 size 0.9
    randomstart

CRITICAL SYNTAX RULES (NO COLONS, NO QUOTES, NO EQUALS):
- Statements: loop audio/file (NOT loop ""audio/file"": or loop = ""audio/file"")
- Statements: oneshot audio/file every 2to5 (NOT oneshot ""audio/file"": every 2to5)
- Properties: volume 0.5 (NOT volume = 0.5 or volume: 0.5)
- Properties: pitch 0.8to1.2 (space-separated, NO equals)
- Ranges: 0.5to1.0 (NO SPACES around 'to')
- Numbers: Use dots not commas (0.5 not 0,5)

INTERPOLATION (goto & gobetween):
- goto: Interpolates from 0 to target value once
  Examples: volume goto(0and0.2 in 5)
           pitch goto(0and1.5 in 10)
           volume goto(0and0.1to0.15 in .5)  # can use ranges
- gobetween: Oscillates between two values continuously
  Examples: pitch gobetween(1and2 in 10)
           filter mode lowpass cutoff gobetween(300and3000 in 15)
           color red gobetween(0and255 as incubic in 20)
           reverb wet gobetween(0.1and1 in 10)
- Easing functions (optional): linear (default), inquad, incubic, inoutquad
  Examples: pitch gobetween(1and2 as inquad in 10)
           color red gobetween(0and255 as incubic in 20)

MOVEMENT (critical for spatial depth and dynamics):
- move walk: Moves object in X and Z axes only (ground movement)
  Example: move walk
- move fly: Moves object in X, Y, and Z axes (3D movement)
  Example: move fly speed 1to3
- move with ranges: Specify exact ranges for each axis
  Example: move x -10to10 y 0to15 z -10to5 speed 2to3
  Example: move x 0to0 z 10to10  # constrained movement
- Speed: Optional speed parameter
  Example: move fly speed 0.5
           move walk speed 2to5

COLOR (for visual objects):
- Basic colors: color red, color blue, color green, color yellow, color white
- RGB values: color red 255 green 0 blue 100
- With ranges: color red 0to255 green 100 blue 50to200
- With interpolation: color red gobetween(0and255 as incubic in 20) green 0to255 blue gobetween(0and155 in 15)
  Example: color red gobetween(0and255 as incubic in 8) green gobetween(0and100 as inquad in 10) blue gobetween(0and155 in 15)

VISUAL OBJECTS:
- visual trail: Trail effect behind sound
- visual sphere: Sphere object
- visual cube: Cube object
- Combine: visual trail and sphere, visual trail and cube

AUDIO EFFECTS:
- Delay: delay wet 0.9 time 0.5to0.9 feedback 0.2to1
  Parameters: wet (dry/wet mix), time (delay time), feedback (repetitions)
  Example: delay wet 0.7 time 0.3to0.8 feedback 0.6to0.9
- Reverb: reverb wet 0.8 size 0.9
  Parameters: wet (dry/wet mix), size (room size)
  Example: reverb wet gobetween(0.1and1 in 10) size 0.8
- Filter modes: lowpass, highpass, bandpass
  Example: filter mode lowpass cutoff 3000
           filter mode lowpass cutoff gobetween(300and3000 in 15)
           filter mode highpass cutoff goto(100and12000 in 5)
           filter mode lowpass cutoff 1000to5000

{audioLibrary}

IMPORTANT: ONLY use audio files from the above list. Do NOT make up file paths.

Generate valid Satie code following these exact syntax rules.";
        }

        private string BuildEnrichedPrompt(string userPrompt, string currentScript, SyntaxValidationResult syntaxResult, LibraryCheckResult libraryResult)
        {
            var promptBuilder = new StringBuilder();

            // Add simplicity reminder
            promptBuilder.AppendLine("IMPORTANT - KEEP IT SIMPLE:");
            promptBuilder.AppendLine("- ONLY use features the user explicitly asked for");
            promptBuilder.AppendLine("- Don't add visuals, color, effects, or modulation unless requested");
            promptBuilder.AppendLine("- Default to basic volume levels and simple syntax");
            promptBuilder.AppendLine();

            // Add syntax requirements with examples
            promptBuilder.AppendLine("SYNTAX REFERENCE (use only if requested):");
            promptBuilder.AppendLine("- Basic: loop audio/file OR oneshot audio/file every 2to5");
            promptBuilder.AppendLine("- Movement: move walk OR move fly OR move x -10to10 y 0to15 z -10to5 speed 2");
            promptBuilder.AppendLine("- Interpolation: volume goto(0and0.2 in 5) OR pitch gobetween(1and2 in 10)");
            promptBuilder.AppendLine("- Effects: delay/reverb/filter (only if user asks for effects)");
            promptBuilder.AppendLine("- Visuals: visual trail/sphere/cube (only if user asks for visuals)");
            promptBuilder.AppendLine("- Color: color red/blue/etc (only if user asks for color)");
            promptBuilder.AppendLine();

            // Add available samples info
            if (libraryResult.AvailableSamples != null && libraryResult.AvailableSamples.Length > 0)
            {
                promptBuilder.AppendLine("AVAILABLE SAMPLES FOR THIS REQUEST:");
                foreach (var sample in libraryResult.AvailableSamples.Take(10))
                {
                    promptBuilder.AppendLine($"  - {sample}");
                }
                promptBuilder.AppendLine();
            }

            // Add current script context if exists
            if (!string.IsNullOrEmpty(currentScript))
            {
                promptBuilder.AppendLine("CURRENT SCRIPT:");
                promptBuilder.AppendLine("```");
                promptBuilder.AppendLine(currentScript);
                promptBuilder.AppendLine("```");
                promptBuilder.AppendLine();
                promptBuilder.AppendLine("USER REQUEST:");
                promptBuilder.AppendLine(userPrompt);
                promptBuilder.AppendLine();
                promptBuilder.AppendLine("Modify the current script according to the user request. Output only the complete modified script with correct syntax (NO SPACES after commas in move commands).");
            }
            else
            {
                promptBuilder.AppendLine("USER REQUEST:");
                promptBuilder.AppendLine(userPrompt);
                promptBuilder.AppendLine();
                promptBuilder.AppendLine("Generate Satie code for this request using correct syntax (NO SPACES after commas in move commands).");
            }

            return promptBuilder.ToString();
        }

        private string FormatAudioLibrary(HashSet<string> audioFiles)
        {
            var grouped = audioFiles
                .GroupBy(f => f.Contains('/') ? f.Substring(0, f.LastIndexOf('/')) : "root")
                .OrderBy(g => g.Key);

            var result = new StringBuilder();
            result.AppendLine("AVAILABLE AUDIO FILES (use EXACT paths):");

            foreach (var group in grouped)
            {
                if (group.Key == "root")
                {
                    result.AppendLine(string.Join(", ", group));
                }
                else
                {
                    result.AppendLine($"{group.Key}/: {string.Join(", ", group.Select(f => f.Substring(f.LastIndexOf('/') + 1)))}");
                }
            }

            return result.ToString().TrimEnd();
        }

        private string BuildExplanation(SyntaxValidationResult syntaxResult, LibraryCheckResult libraryResult)
        {
            var explanation = new StringBuilder();

            if (libraryResult.AllSamplesAvailable)
            {
                explanation.AppendLine("All requested samples are available in your library.");
            }
            else if (libraryResult.MissingSamples?.Length > 0)
            {
                explanation.AppendLine($"Note: Some samples were not found: {string.Join(", ", libraryResult.MissingSamples)}");
                if (libraryResult.SuggestedAlternatives?.Length > 0)
                {
                    explanation.AppendLine($"Used alternatives: {string.Join(", ", libraryResult.SuggestedAlternatives)}");
                }
            }

            return explanation.ToString();
        }

        private async Task<(bool success, string code, string error, int attemptCount)> VerifyAndRepairAsync(string code)
        {
            int maxAttempts = 2;
            string currentCode = code;

            for (int attempt = 1; attempt <= maxAttempts; attempt++)
            {
                // Try to parse the code
                var parseResult = SatieParser.TryParseScript(currentCode, out var statements, out var errors);

                if (parseResult)
                {
                    UnityEngine.Debug.Log($"[Orchestrator] Code verified successfully on attempt {attempt}");
                    return (true, currentCode, null, attempt);
                }

                // If this was the last attempt, return with error
                if (attempt == maxAttempts)
                {
                    UnityEngine.Debug.LogWarning($"[Orchestrator] Max repair attempts reached. Final errors:\n{errors}");
                    return (false, currentCode, errors, attempt);
                }

                // Try to repair
                UnityEngine.Debug.Log($"[Orchestrator] Attempting repair {attempt}/{maxAttempts}...");
                OnStreamUpdate?.Invoke($"\n\nFixing errors (attempt {attempt})...");

                currentCode = await _compilationVerifier.RepairCodeAsync(currentCode, errors, attempt);
            }

            return (false, code, "Failed to verify code", maxAttempts);
        }

        private string CleanGeneratedCode(string code)
        {
            code = code.Trim();

            // Remove markdown code blocks if present
            if (code.StartsWith("```"))
            {
                var lines = code.Split('\n');
                code = string.Join("\n", lines.Skip(1).Take(lines.Length - 2));
            }

            return code.Trim();
        }

        private string LoadLanguageSpec()
        {
            try
            {
                var specAsset = UnityEngine.Resources.Load<TextAsset>("AI/SATIE_LANGUAGE_SPEC");
                if (specAsset != null)
                {
                    return specAsset.text;
                }
            }
            catch (Exception e)
            {
                UnityEngine.Debug.LogWarning($"[Orchestrator] Could not load language spec: {e.Message}");
            }

            // Fallback: inline minimal spec
            return @"SATIE SYNTAX:
Commands (NO colons): loop audio/file, oneshot audio/file every 2to5
Properties (space-separated): volume 0.5, pitch 0.8to1.2
Ranges: Use 'to' with NO SPACES (0.5to1.0)
Numbers: Use dots not commas (0.5 not 0,5)";
        }

        #endregion
    }

    #region Data Models

    [System.Serializable]
    public class CodeGenerationResult
    {
        public bool Success;
        public string Code;
        public string Explanation;
        public List<string> MissingSamples;
        public GenerationMetrics Metrics;
        public string Error;
    }

    [System.Serializable]
    public class GenerationMetrics
    {
        public long ValidationLatencyMs;
        public long GenerationLatencyMs;
        public long VerificationLatencyMs;
        public long TotalLatencyMs;
        public int RepairAttempts;

        public override string ToString()
        {
            return $@"Generation Metrics:
- Validation: {ValidationLatencyMs}ms
- Generation: {GenerationLatencyMs}ms
- Verification: {VerificationLatencyMs}ms
- Total: {TotalLatencyMs}ms
- Repair Attempts: {RepairAttempts}";
        }
    }

    #endregion
}
