import { useState, useRef, useCallback, useEffect } from 'react';

interface AIPanelProps {
  onGenerate: (code: string) => void;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function AIPanel({ onGenerate }: AIPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const send = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt) return;

    const newMessages: Message[] = [...messages, { role: 'user', content: prompt }];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    const apiKey = localStorage.getItem('satie-anthropic-key') ?? '';
    if (!apiKey) {
      setMessages([...newMessages, {
        role: 'assistant',
        content: 'Set your Anthropic key in the sidebar first.',
      }]);
      setIsLoading(false);
      return;
    }

    try {
      const systemPrompt = `You are Satie, an AI assistant for spatial audio composition. You write code in the Satie DSL.

Satie syntax:
- Statements: [count*] (loop|oneshot) clipname [every range]
- Properties (indented): volume, pitch, start, end, duration, fade_in, fade_out, move, color, visual, overlap, persistent, mute, solo, randomstart
- Ranges: 0.5to1.0
- DSP: reverb wet 0.5 size 0.8 damping 0.6 | delay wet 0.5 time 0.375 feedback 0.6 | filter mode lowpass cutoff 1000 resonance 2 | distortion mode tanh drive 2 | eq low 3 mid -2 high 1
- Spatial: move fly x -5to5 y -2to2 z -5to5 speed 1.5 | move walk speed 2
- Interpolation: goto(0and1 in 5) | gobetween(0and255 as incubic in 20 for ever)
- Groups: group ... endgroup (properties inherited by children)
- Gen audio: loop gen description of sound every 2
- Comments: # line comment | comment ... endcomment

When the user asks you to compose, respond with ONLY the Satie code (no markdown fences). If they ask a question, explain briefly then show code.

Available audio clips are whatever the user has loaded. Use simple names like: bowl, rain, impact, pad, etc.`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: systemPrompt,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`${response.status}`);
      }

      const data = await response.json();
      const reply = data.content?.[0]?.text ?? '';

      setMessages([...newMessages, { role: 'assistant', content: reply }]);

      if (/\b(loop|oneshot)\b/.test(reply)) {
        onGenerate(reply);
      }
    } catch (e: any) {
      setMessages([...newMessages, {
        role: 'assistant',
        content: `error: ${e.message}`,
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, messages, onGenerate]);

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
      {/* Messages */}
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
        {isLoading && (
          <div style={{ opacity: 0.2, fontSize: '11px', padding: '4px 0' }}>...</div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: '6px 14px 10px', flexShrink: 0 }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="make a rainstorm..."
          rows={2}
          style={{
            width: '100%',
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
      </div>
    </div>
  );
}
