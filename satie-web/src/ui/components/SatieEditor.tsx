import { useRef, useCallback } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';

interface SatieEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  errors: string | null;
}

const SATIE_LANG_ID = 'satie';

function registerSatieLanguage(monaco: any) {
  if (monaco.languages.getLanguages().some((l: any) => l.id === SATIE_LANG_ID)) return;

  monaco.languages.register({ id: SATIE_LANG_ID });

  monaco.languages.setMonarchTokensProvider(SATIE_LANG_ID, {
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/\b(comment)\b/, { token: 'comment', next: '@blockComment' }],
        [/\b(loop|oneshot)\b/, 'keyword'],
        [/\b(let)\b/, 'keyword.let'],
        [/\b(group|endgroup)\b/, 'keyword.control'],
        [/\b(gen)\b/, 'keyword.gen'],
        [/\b(every)\b/, 'keyword.every'],
        [/\b(goto|gobetween|interpolate)\s*\(/, 'function'],
        [/\b(walk|fly|fixed)\b/, 'type.move'],
        [/\b(volume|pitch|start|end|duration|fade_in|fade_out|move|color|alpha|visual|overlap|persistent|mute|solo|randomstart|random_start|prompt|influence|loopable)\b/, 'variable'],
        [/\b(reverb|delay|filter|distortion|eq)\b/, 'variable.dsp'],
        [/\b(wet|drywet|size|roomsize|damping|damp|time|feedback|pingpong|mode|cutoff|freq|resonance|drive|low|mid|high|speed)\b/, 'variable.param'],
        [/\b(lowpass|highpass|bandpass|notch|peak|softclip|hardclip|tanh|cubic|asymmetric)\b/, 'type.mode'],
        [/\b(linear|insine|outsine|inoutsine|inquad|outquad|inoutquad|incubic|outcubic|inoutcubic|inexpo|outexpo|inoutexpo)\b/, 'string.easing'],
        [/-?\d+\.?\d*to-?\d+\.?\d*/, 'number.range'],
        [/-?\d+\.?\d*/, 'number'],
        [/#[0-9A-Fa-f]{6}/, 'string.color'],
        [/\b(red|green|blue|white|black|yellow|cyan|magenta|gray|grey)\b/, 'string.color'],
        [/\b(and|in|as|for|ever)\b/, 'keyword.operator'],
        [/audio\/\S+/, 'string.path'],
      ],
      blockComment: [
        [/\b(endcomment)\b/, { token: 'comment', next: '@pop' }],
        [/.*/, 'comment'],
      ],
    },
  });

  monaco.editor.defineTheme('satie-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '1a3a2a', fontStyle: 'bold' },
      { token: 'keyword.control', foreground: '1a3a2a', fontStyle: 'bold' },
      { token: 'keyword.let', foreground: '6a4a8a', fontStyle: 'bold' },
      { token: 'keyword.gen', foreground: '8b4513', fontStyle: 'italic' },
      { token: 'keyword.every', foreground: '2b5a3a' },
      { token: 'keyword.operator', foreground: '999999' },
      { token: 'variable', foreground: '4a7a5a' },
      { token: 'variable.dsp', foreground: '8b0000' },
      { token: 'variable.param', foreground: '8b0000' },
      { token: 'number', foreground: '2b2b8a' },
      { token: 'number.range', foreground: '2b2b8a', fontStyle: 'italic' },
      { token: 'function', foreground: '6a4a8a' },
      { token: 'type.move', foreground: '2b5a8a' },
      { token: 'type.mode', foreground: '2b5a8a' },
      { token: 'string.easing', foreground: '8a6a3a' },
      { token: 'string.path', foreground: '8a6a3a' },
      { token: 'string.color', foreground: '8b4513' },
      { token: 'comment', foreground: 'aaaaaa' },
    ],
    colors: {
      'editor.background': '#faf9f6',
      'editor.foreground': '#1a1a1a',
      'editor.lineHighlightBackground': '#f0efe8',
      'editorLineNumber.foreground': '#cccccc',
      'editorLineNumber.activeForeground': '#999999',
      'editor.selectionBackground': '#d4e8d0',
      'editorCursor.foreground': '#1a3a2a',
      'editorIndentGuide.background': '#e8e8e0',
    },
  });
}

export function SatieEditor({ value, onChange, onRun, errors }: SatieEditorProps) {
  const editorRef = useRef<any>(null);
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    registerSatieLanguage(monaco);
    monaco.editor.setTheme('satie-light');

    // Cmd+Enter / Ctrl+Enter to run
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onRunRef.current?.();
    });
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Editor
        height="100%"
        language={SATIE_LANG_ID}
        theme="satie-light"
        value={value}
        onChange={(v) => onChange(v ?? '')}
        onMount={handleMount}
        options={{
          fontSize: 13,
          fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
          minimap: { enabled: false },
          lineNumbers: 'on',
          wordWrap: 'on',
          scrollBeyondLastLine: false,
          tabSize: 2,
          renderWhitespace: 'none',
          bracketPairColorization: { enabled: false },
          padding: { top: 8 },
          scrollbar: { vertical: 'hidden', horizontal: 'hidden' },
          overviewRulerBorder: false,
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          renderLineHighlight: 'line',
          lineDecorationsWidth: 8,
          lineNumbersMinChars: 3,
          glyphMargin: false,
          folding: false,
        }}
      />
      {errors && (
        <div style={{
          padding: '6px 12px',
          color: '#8b0000',
          fontSize: '11px',
          fontFamily: "'SF Mono', monospace",
          borderTop: '1px solid #e8e0d8',
          background: '#fdf6f0',
        }}>
          {errors}
        </div>
      )}
    </div>
  );
}
