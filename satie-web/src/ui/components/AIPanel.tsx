import { useState, useRef, useCallback, useEffect } from 'react';
import { tryParse } from '../../engine/core/SatieParser';

interface AIPanelProps {
  onGenerate: (code: string) => void;
  currentScript?: string;
  loadedSamples?: string[];
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// ── ASR: Microphone → Whisper transcription ────────────────

async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const apiKey = localStorage.getItem('satie-openai-key') ?? '';
  if (!apiKey) throw new Error('Set your OpenAI key in dashboard settings first.');

  const form = new FormData();
  form.append('file', audioBlob, 'audio.webm');
  form.append('model', 'whisper-1');
  form.append('language', 'en');
  form.append('response_format', 'json');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) throw new Error(`Whisper API ${res.status}`);
  const data = await res.json();
  return data.text ?? '';
}

function useASR(onTranscription: (text: string) => void, onError: (msg: string) => void) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startTime = useRef(0);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunks.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const elapsed = Date.now() - startTime.current;
        setRecording(false);
        if (elapsed < 300) return;

        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        setTranscribing(true);
        try {
          const text = await transcribeAudio(blob);
          if (text.trim()) onTranscription(text.trim());
        } catch (e: any) {
          onError(e.message);
        } finally {
          setTranscribing(false);
        }
      };

      mediaRecorder.current = recorder;
      startTime.current = Date.now();
      recorder.start();
      setRecording(true);
    } catch {
      onError('Microphone access denied');
    }
  }, [onTranscription, onError]);

  const stop = useCallback(() => {
    if (mediaRecorder.current?.state === 'recording') {
      mediaRecorder.current.stop();
    }
  }, []);

  return { recording, transcribing, start, stop };
}

// ── Code cleaning ──────────────────────────────────────────

function cleanGeneratedCode(raw: string): string {
  let code = raw.trim();

  // Remove markdown code blocks
  if (code.includes('```')) {
    const lines = code.split('\n');
    const result: string[] = [];
    let inBlock = false;
    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        inBlock = !inBlock;
        continue;
      }
      if (inBlock) result.push(line);
    }
    if (result.length > 0) code = result.join('\n').trim();
  }

  // Strip leading non-code text
  const lines = code.split('\n');
  let firstCodeLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (/^(?:loop|oneshot|group|\d+\s*\*|#|comment)\b/i.test(trimmed)) {
      firstCodeLine = i;
      break;
    }
  }
  if (firstCodeLine > 0) code = lines.slice(firstCodeLine).join('\n').trim();

  // Strip trailing prose
  const codeLines = code.split('\n');
  let lastCodeLine = codeLines.length - 1;
  for (let i = codeLines.length - 1; i >= 0; i--) {
    const trimmed = codeLines[i].trim();
    if (!trimmed) continue;
    if (/^[ \t]/.test(codeLines[i]) ||
        /^(?:loop|oneshot|group|endgroup|\d+\s*\*|#|comment|endcomment)\b/i.test(trimmed)) {
      lastCodeLine = i;
      break;
    }
    if (trimmed.length > 60 && trimmed.includes(' ') && !trimmed.includes('to') && !/\d/.test(trimmed.charAt(0))) {
      lastCodeLine = i - 1;
      break;
    }
    lastCodeLine = i;
    break;
  }
  if (lastCodeLine < codeLines.length - 1) {
    code = codeLines.slice(0, lastCodeLine + 1).join('\n').trim();
  }

  return code;
}

// ── Library checker (local, no API call) ───────────────────

interface LibraryCheckResult {
  availableSamples: string[];
  missingSamples: string[];
}

function checkLibrary(prompt: string, loadedSamples: string[]): LibraryCheckResult {
  const lower = prompt.toLowerCase();
  const keywords = extractSoundKeywords(lower);
  const available: string[] = [];
  const missing: string[] = [];

  for (const keyword of keywords) {
    const matches = loadedSamples.filter(s => s.toLowerCase().includes(keyword));
    if (matches.length > 0) {
      available.push(...matches);
    } else {
      missing.push(keyword);
    }
  }

  return {
    availableSamples: [...new Set(available)],
    missingSamples: missing,
  };
}

function extractSoundKeywords(prompt: string): string[] {
  const keywords: string[] = [];
  const commonSounds = [
    'bird', 'piano', 'ambience', 'voice', 'conversation',
    'bicycle', 'animal', 'music', 'sacred', 'wind',
    'forest', 'rain', 'thunder', 'ocean', 'river',
    'drum', 'guitar', 'bass', 'synth', 'pad', 'bell',
    'water', 'fire', 'whale', 'bowl', 'gong', 'flute',
    'strings', 'choir', 'noise', 'click', 'impact',
  ];

  for (const sound of commonSounds) {
    if (prompt.includes(sound)) keywords.push(sound);
  }

  return keywords;
}

// ── Anthropic API call helper ──────────────────────────────

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  maxTokens: number = 2048,
  temperature: number = 0.7,
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) throw new Error(`API ${response.status}`);
  const data = await response.json();
  return data.content?.[0]?.text ?? '';
}

// ── System prompt (ported from Unity SatieAgentOrchestrator) ──

function buildSystemPrompt(loadedSamples: string[], libraryResult: LibraryCheckResult): string {
  let audioLibrary: string;
  if (loadedSamples.length > 0) {
    audioLibrary = `AVAILABLE AUDIO FILES (use EXACT names):\n${loadedSamples.map(s => `  - ${s}`).join('\n')}\n\nIMPORTANT: Use audio files from the above list when available. For sounds NOT in the library, use the gen keyword to generate them. Do NOT make up file paths.`;
  } else {
    audioLibrary = 'No audio files loaded yet. Use the gen keyword to generate sounds (e.g. loop gen gentle rain on leaves).';
  }

  return `You are Satie, a spatial audio composition engine. You write code in the Satie DSL.

Output ONLY valid Satie code. No explanations, no markdown, no text before or after the code.

STRICT RULES:
- Your response must be pure Satie code only
- NO explanations or descriptions
- NO markdown code blocks
- NO "Here's your code" or similar text
- Start directly with the Satie code
- End directly with the Satie code

SIMPLICITY PRINCIPLE - CRITICAL:
- ONLY add features the user explicitly requested
- DO NOT add: visuals, color, reverb, delay, filters, randomstart, pitch variations UNLESS asked
- Keep it minimal - use basic volume levels, no fancy modulation unless requested
- Less is more - don't show off all available features
- If user wants complexity, they will ask for it explicitly

EXAMPLE - User says "rain and piano flying":
CORRECT (simple):
loop rain
    volume 0.2

oneshot piano_note_1 every 2to5
    volume 0.3
    move fly

WRONG (over-engineered):
loop rain
    volume 0.3
    filter mode lowpass cutoff 2000
    reverb wet 0.4 size 0.8

oneshot piano_note_1 every 2to4
    pitch 0.8to1.2
    move fly speed 1to3
    visual trail and sphere
    color red gobetween(100and255 as incubic in 5) green 150to200 blue 100
    reverb wet 0.6 size 0.9
    randomstart

CRITICAL SYNTAX RULES (NO COLONS, NO QUOTES, NO EQUALS):
- Statements: loop audio/file (NOT loop "audio/file": or loop = "audio/file")
- Statements: oneshot audio/file every 2to5 (NOT oneshot "audio/file": every 2to5)
- Properties: volume 0.5 (NOT volume = 0.5 or volume: 0.5)
- Properties: pitch 0.8to1.2 (space-separated, NO equals)
- Ranges: 0.5to1.0 (NO SPACES around 'to')
- Numbers: Use dots not commas (0.5 not 0,5)

INTERPOLATION (goto & gobetween):
- goto: Interpolates from start to target value once
  Examples: volume goto(0and0.2 in 5)
           pitch goto(0and1.5 in 10)
           volume goto(0and0.1to0.15 in .5)
- gobetween: Oscillates between two values continuously
  Examples: pitch gobetween(1and2 in 10)
           filter mode lowpass cutoff gobetween(300and3000 in 15)
           color red gobetween(0and255 as incubic in 20)
           reverb wet gobetween(0.1and1 in 10)
- Easing functions (optional): linear (default), inquad, incubic, inoutquad
  Examples: pitch gobetween(1and2 as inquad in 10)

MOVEMENT (critical for spatial depth):
- move walk: Ground movement (X and Z axes)
  Example: move walk
- move fly: 3D movement (X, Y, Z axes)
  Example: move fly speed 1to3
- move with ranges: Specify exact ranges per axis
  Example: move x -10to10 y 0to15 z -10to5 speed 2to3
  Example: move x 0to0 z 10to10
- Speed: move fly speed 0.5 | move walk speed 2to5

COLOR (for visual objects):
- Basic colors: color red, color blue, color green, color yellow, color white
- RGB values: color red 255 green 0 blue 100
- With ranges: color red 0to255 green 100 blue 50to200
- With interpolation: color red gobetween(0and255 as incubic in 20) green 0to255 blue gobetween(0and155 in 15)

VISUAL OBJECTS:
- visual trail: Trail effect behind sound
- visual sphere: Sphere object
- Combine: visual trail and sphere

AUDIO EFFECTS (only if requested):
- Delay: delay wet 0.9 time 0.5to0.9 feedback 0.2to1
- Reverb: reverb wet 0.8 size 0.9
- Filter: filter mode lowpass cutoff 3000
- Distortion: distortion mode tanh drive 2
- EQ: eq low 3 mid -2 high 1

AUDIO GENERATION (gen keyword):
- When a sound is NOT available in the library, use the gen keyword
- Syntax: loop gen descriptive prompt OR oneshot gen descriptive prompt every 2to5
- Examples: loop gen fire with crackles | oneshot gen thunder rumble every 5to15
- The prompt should be descriptive (e.g. "gentle rain on leaves" not just "rain")
- Use gen ONLY for sounds not available in the library - prefer existing samples

${audioLibrary}

Generate valid Satie code following these exact syntax rules.`;
}

// ── Enriched prompt (ported from Unity BuildEnrichedPrompt) ──

function buildEnrichedPrompt(
  userPrompt: string,
  currentScript: string | undefined,
  libraryResult: LibraryCheckResult,
): string {
  const parts: string[] = [];

  parts.push('IMPORTANT - KEEP IT SIMPLE:');
  parts.push('- ONLY use features the user explicitly asked for');
  parts.push("- Don't add visuals, color, effects, or modulation unless requested");
  parts.push('- Default to basic volume levels and simple syntax');
  parts.push('');

  parts.push('SYNTAX REFERENCE (use only if requested):');
  parts.push('- Basic: loop audio/file OR oneshot audio/file every 2to5');
  parts.push('- Generate: loop gen descriptive prompt OR oneshot gen descriptive prompt every 2to5');
  parts.push('- Movement: move walk OR move fly OR move x -10to10 y 0to15 z -10to5 speed 2');
  parts.push('- Interpolation: volume goto(0and0.2 in 5) OR pitch gobetween(1and2 in 10)');
  parts.push('- Effects: delay/reverb/filter (only if user asks for effects)');
  parts.push('- Visuals: visual trail/sphere/cube (only if user asks for visuals)');
  parts.push('- Color: color red/blue/etc (only if user asks for color)');
  parts.push('');

  if (libraryResult.availableSamples.length > 0) {
    parts.push('AVAILABLE SAMPLES FOR THIS REQUEST:');
    for (const s of libraryResult.availableSamples.slice(0, 10)) {
      parts.push(`  - ${s}`);
    }
    parts.push('');
  }

  if (libraryResult.missingSamples.length > 0) {
    parts.push('MISSING SAMPLES - USE gen KEYWORD TO GENERATE THESE:');
    for (const m of libraryResult.missingSamples) {
      parts.push(`  - ${m} → use gen (e.g. loop gen ${m} or oneshot gen ${m})`);
    }
    parts.push('Write a descriptive prompt after gen for best results.');
    parts.push('');
  }

  if (currentScript && currentScript.trim() && currentScript.trim() !== '# satie') {
    parts.push('CURRENT SCRIPT:');
    parts.push(currentScript);
    parts.push('');
    parts.push('USER REQUEST:');
    parts.push(userPrompt);
    parts.push('');
    parts.push('Modify the current script according to the user request. Output only the complete modified script with correct syntax.');
  } else {
    parts.push('USER REQUEST:');
    parts.push(userPrompt);
    parts.push('');
    parts.push('Generate Satie code for this request using correct syntax.');
  }

  return parts.join('\n');
}

// ── Compilation verifier (uses parser + Haiku repair) ──────

const REPAIR_SYSTEM_PROMPT = `You are a Satie code repair specialist.

Fix the syntax errors in the provided Satie code. Output ONLY the corrected code.

CRITICAL SYNTAX RULES (NO COLONS, NO QUOTES, NO EQUALS):
- Statements: loop audio/file (NOT loop "audio/file": or loop = "audio/file")
- Statements: oneshot audio/file every 2to5
- Generate: loop gen descriptive prompt OR oneshot gen descriptive prompt every 2to5
- Properties: volume 0.5 (NOT volume = 0.5 or volume: 0.5)
- Properties: pitch 0.8to1.2 (space-separated, NO equals sign)
- Interpolation: volume goto(0and0.2 in 5) OR pitch gobetween(1and2 in 10)
- Easing: gobetween(0and255 as incubic in 20)
- Movement: move walk OR move fly speed 1to3 OR move x -10to10 y 0to15 z -10to5 speed 2
- Color: color red gobetween(0and255 as incubic in 20) green 0to255 blue 100
- Effects: delay wet 0.9 time 0.5to0.9 feedback 0.2to1 | reverb wet 0.8 size 0.9 | filter mode lowpass cutoff 3000
- Visual: visual trail OR visual sphere OR visual trail and cube
- Ranges: 0.5to1.0 (NO SPACES around 'to')
- NO explanations, NO markdown, NO text before/after code`;

async function verifyAndRepair(
  apiKey: string,
  code: string,
  maxAttempts: number = 2,
): Promise<{ success: boolean; code: string; error: string | null }> {
  let currentCode = code;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = tryParse(currentCode);

    if (result.success) {
      return { success: true, code: currentCode, error: null };
    }

    if (attempt === maxAttempts) {
      // Still return the code — it might partially work
      return { success: false, code: currentCode, error: result.errors };
    }

    // Repair with Haiku
    try {
      const repaired = await callAnthropic(
        apiKey,
        'claude-haiku-4-5-20251001',
        REPAIR_SYSTEM_PROMPT,
        [{
          role: 'user',
          content: `CODE WITH ERRORS:\n${currentCode}\n\nPARSER ERRORS:\n${result.errors}\n\nFix these errors and output the corrected code ONLY.`,
        }],
        2000,
        0.2,
      );
      currentCode = cleanGeneratedCode(repaired);
    } catch {
      return { success: false, code: currentCode, error: result.errors };
    }
  }

  return { success: false, code, error: 'Failed to verify code' };
}

// ── Main orchestration pipeline ────────────────────────────

const ORCHESTRATOR_MODEL = 'claude-sonnet-4-20250514';

async function generateCode(
  apiKey: string,
  userPrompt: string,
  currentScript: string | undefined,
  loadedSamples: string[],
  conversationHistory: { role: string; content: string }[],
): Promise<{ code: string; error: string | null }> {
  // Step 1: Library check (local, instant)
  const libraryResult = checkLibrary(userPrompt, loadedSamples);

  // Step 2: Build prompts
  const systemPrompt = buildSystemPrompt(loadedSamples, libraryResult);
  const enrichedPrompt = buildEnrichedPrompt(userPrompt, currentScript, libraryResult);

  // Step 3: Generate code with Sonnet
  const apiMessages = [
    ...conversationHistory,
    { role: 'user', content: enrichedPrompt },
  ];

  const rawResponse = await callAnthropic(
    apiKey,
    ORCHESTRATOR_MODEL,
    systemPrompt,
    apiMessages,
    2048,
    0.7,
  );

  // Step 4: Clean response
  const cleanedCode = cleanGeneratedCode(rawResponse);

  // Step 5: Verify & repair (uses parser + Haiku)
  const verified = await verifyAndRepair(apiKey, cleanedCode);

  return {
    code: verified.code,
    error: verified.error,
  };
}

// ── React component ────────────────────────────────────────

export function AIPanel({ onGenerate, currentScript, loadedSamples = [] }: AIPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendPrompt = useCallback(async (prompt: string) => {
    if (!prompt.trim()) return;

    const newMessages: Message[] = [...messages, { role: 'user', content: prompt }];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    const apiKey = localStorage.getItem('satie-anthropic-key') ?? '';
    if (!apiKey) {
      setMessages([...newMessages, {
        role: 'assistant',
        content: 'Set your Anthropic key in dashboard settings first.',
      }]);
      setIsLoading(false);
      return;
    }

    try {
      const conversationHistory = newMessages.slice(0, -1).map(m => ({
        role: m.role,
        content: m.content,
      }));

      const result = await generateCode(
        apiKey,
        prompt,
        currentScript,
        loadedSamples,
        conversationHistory,
      );

      setMessages([...newMessages, { role: 'assistant', content: result.code }]);

      if (/\b(loop|oneshot)\b/.test(result.code)) {
        onGenerate(result.code);
      }
    } catch (e: any) {
      setMessages([...newMessages, {
        role: 'assistant',
        content: `error: ${e.message}`,
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, onGenerate, currentScript, loadedSamples]);

  const send = useCallback(() => {
    sendPrompt(input.trim());
  }, [input, sendPrompt]);

  // ASR: speech → text → auto-generate
  const handleTranscription = useCallback((text: string) => {
    sendPrompt(text);
  }, [sendPrompt]);

  const handleASRError = useCallback((msg: string) => {
    setMessages(prev => [...prev, { role: 'assistant', content: `mic: ${msg}` }]);
  }, []);

  const asr = useASR(handleTranscription, handleASRError);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '0 14px',
          fontSize: '12px',
        }}
      >
        {messages.length === 0 && (
          <div style={{ opacity: 0.2, fontSize: '11px', padding: '4px 0' }}>
            describe what you want to hear
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            padding: '4px 0',
            color: '#1a3a2a',
            opacity: m.role === 'user' ? 0.4 : 0.85,
          }}>
            {m.role === 'assistant' ? (
              <pre style={{
                fontFamily: "'SF Mono', 'Consolas', monospace",
                fontSize: '11px',
                whiteSpace: 'pre-wrap',
                margin: 0,
                lineHeight: 1.5,
              }}>
                {m.content}
              </pre>
            ) : (
              <span style={{ fontStyle: 'italic', fontSize: '11px' }}>{m.content}</span>
            )}
          </div>
        ))}
        {asr.recording && (
          <div style={{ opacity: 0.4, fontSize: '11px', padding: '4px 0', color: '#8b0000' }}>recording...</div>
        )}
        {asr.transcribing && (
          <div style={{ opacity: 0.3, fontSize: '11px', padding: '4px 0' }}>transcribing...</div>
        )}
        {isLoading && (
          <div style={{ opacity: 0.2, fontSize: '11px', padding: '4px 0' }}>...</div>
        )}
      </div>

      <div style={{ padding: '6px 14px 10px', flexShrink: 0, display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="make a rainstorm..."
          rows={2}
          style={{
            flex: 1,
            padding: '8px 10px',
            border: '1px solid #d0cdc4',
            borderRadius: 12,
            fontSize: '12px',
            fontFamily: "'Inter', system-ui, sans-serif",
            background: '#faf9f6',
            outline: 'none',
            resize: 'none',
            color: '#1a3a2a',
            lineHeight: 1.4,
          }}
        />
        {/* Push-to-talk mic button */}
        <button
          onMouseDown={asr.start}
          onMouseUp={asr.stop}
          onMouseLeave={asr.recording ? asr.stop : undefined}
          title={asr.recording ? 'Release to transcribe' : asr.transcribing ? 'Transcribing...' : 'Hold to speak'}
          disabled={isLoading || asr.transcribing}
          style={{
            width: 34,
            height: 34,
            background: asr.recording ? '#8b0000' : 'none',
            border: `1.5px solid ${asr.recording ? '#8b0000' : '#d0cdc4'}`,
            borderRadius: 10,
            cursor: isLoading || asr.transcribing ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            opacity: isLoading || asr.transcribing ? 0.3 : asr.recording ? 1 : 0.5,
            transition: 'all 0.15s',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={asr.recording ? '#faf9f6' : '#1a3a2a'} strokeWidth="1.3">
            <rect x="5" y="1" width="4" height="8" rx="2" strokeLinejoin="round"/>
            <path d="M3 7 C3 9.2 4.8 11 7 11 C9.2 11 11 9.2 11 7" strokeLinecap="round"/>
            <line x1="7" y1="11" x2="7" y2="13" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
