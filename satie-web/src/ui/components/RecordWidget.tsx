import { useState, useRef, useCallback, useEffect } from 'react';

interface RecordWidgetProps {
  onSave: (name: string, buffer: ArrayBuffer) => Promise<void>;
}

export function RecordWidget({ onSave }: RecordWidgetProps) {
  const [state, setState] = useState<'idle' | 'recording' | 'preview'>('idle');
  const [duration, setDuration] = useState(0);
  const [name, setName] = useState('');
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(1);
  const [saving, setSaving] = useState(false);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startTime = useRef(0);
  const timerRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCtx = useRef<AudioContext | null>(null);
  const previewSource = useRef<AudioBufferSourceNode | null>(null);
  const dragging = useRef<'start' | 'end' | null>(null);

  // Update duration timer during recording
  useEffect(() => {
    if (state === 'recording') {
      const tick = () => {
        setDuration((Date.now() - startTime.current) / 1000);
        timerRef.current = requestAnimationFrame(tick);
      };
      timerRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(timerRef.current);
    }
  }, [state]);

  // Draw waveform on canvas
  useEffect(() => {
    if (!audioBuffer || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / w);

    ctx.clearRect(0, 0, w, h);

    // Draw dimmed out-of-trim regions
    const startPx = trimStart * w;
    const endPx = trimEnd * w;

    ctx.fillStyle = 'rgba(26, 58, 42, 0.03)';
    ctx.fillRect(0, 0, startPx, h);
    ctx.fillRect(endPx, 0, w - endPx, h);

    // Draw waveform
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(26, 58, 42, 0.3)';
    ctx.lineWidth = 1;
    for (let i = 0; i < w; i++) {
      let min = 1, max = -1;
      for (let j = 0; j < step; j++) {
        const val = data[(i * step) + j] ?? 0;
        if (val < min) min = val;
        if (val > max) max = val;
      }
      const yMin = (1 + min) * h / 2;
      const yMax = (1 + max) * h / 2;
      ctx.moveTo(i, yMin);
      ctx.lineTo(i, yMax);
    }
    ctx.stroke();

    // Draw trim handles
    ctx.fillStyle = '#1a3a2a';
    ctx.fillRect(startPx - 1, 0, 2, h);
    ctx.fillRect(endPx - 1, 0, 2, h);

  }, [audioBuffer, trimStart, trimEnd]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });
      chunks.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        const arrayBuffer = await blob.arrayBuffer();
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        setAudioBuffer(decoded);
        setTrimStart(0);
        setTrimEnd(1);
        setName(`recording_${Date.now().toString(36).slice(-4)}`);
        setState('preview');
        previewCtx.current = ctx;
      };

      mediaRecorder.current = recorder;
      startTime.current = Date.now();
      recorder.start();
      setState('recording');
      setDuration(0);
    } catch {
      // Mic access denied — stay idle
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorder.current?.state === 'recording') {
      mediaRecorder.current.stop();
    }
  }, []);

  const handlePreviewPlay = useCallback(() => {
    if (!audioBuffer || !previewCtx.current) return;
    previewSource.current?.stop();
    const source = previewCtx.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(previewCtx.current.destination);
    const startOffset = trimStart * audioBuffer.duration;
    const dur = (trimEnd - trimStart) * audioBuffer.duration;
    source.start(0, startOffset, dur);
    previewSource.current = source;
  }, [audioBuffer, trimStart, trimEnd]);

  const handleSave = useCallback(async () => {
    if (!audioBuffer || !name.trim()) return;
    setSaving(true);

    // Trim the audio buffer
    const sampleRate = audioBuffer.sampleRate;
    const channels = audioBuffer.numberOfChannels;
    const startSample = Math.floor(trimStart * audioBuffer.length);
    const endSample = Math.floor(trimEnd * audioBuffer.length);
    const length = endSample - startSample;

    // Encode as WAV
    const bitsPerSample = 16;
    const dataSize = length * channels * (bitsPerSample / 8);
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeStr = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
    view.setUint16(32, channels * (bitsPerSample / 8), true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[startSample + i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }

    const clipName = `Audio/${name.trim().replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    await onSave(clipName, buffer);

    // Reset
    setAudioBuffer(null);
    setState('idle');
    setName('');
    setDuration(0);
    setSaving(false);
    previewCtx.current?.close();
    previewCtx.current = null;
  }, [audioBuffer, name, trimStart, trimEnd, onSave]);

  const handleDiscard = useCallback(() => {
    setAudioBuffer(null);
    setState('idle');
    setName('');
    setDuration(0);
    previewSource.current?.stop();
    previewCtx.current?.close();
    previewCtx.current = null;
  }, []);

  // Trim drag handling
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const distToStart = Math.abs(x - trimStart);
    const distToEnd = Math.abs(x - trimEnd);
    if (distToStart < 0.03) dragging.current = 'start';
    else if (distToEnd < 0.03) dragging.current = 'end';
    else dragging.current = null;
  }, [trimStart, trimEnd]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragging.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (dragging.current === 'start') {
      setTrimStart(Math.min(x, trimEnd - 0.02));
    } else {
      setTrimEnd(Math.max(x, trimStart + 0.02));
    }
  }, [trimStart, trimEnd]);

  const handleCanvasMouseUp = useCallback(() => {
    dragging.current = null;
  }, []);

  if (state === 'preview' && audioBuffer) {
    return (
      <div style={{ padding: '8px 0', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {/* Waveform with trim */}
        <canvas
          ref={canvasRef}
          width={300}
          height={40}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          style={{
            width: '100%',
            height: 40,
            cursor: 'col-resize',
            borderRadius: 4,
            background: 'rgba(26, 58, 42, 0.02)',
          }}
        />
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="name"
            style={{
              flex: 1,
              padding: '3px 6px',
              border: '1px solid #d0cdc4',
              borderRadius: 6,
              fontSize: '10px',
              fontFamily: "'SF Mono', monospace",
              background: 'transparent',
              color: '#1a3a2a',
              outline: 'none',
            }}
          />
          <button
            onClick={handlePreviewPlay}
            title="Preview"
            style={{
              background: 'none',
              border: '1px solid #d0cdc4',
              borderRadius: 6,
              cursor: 'pointer',
              padding: '2px 6px',
              fontSize: '10px',
              color: '#1a3a2a',
              fontFamily: 'inherit',
            }}
          >
            play
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            style={{
              background: '#1a3a2a',
              color: '#faf9f6',
              border: 'none',
              borderRadius: 6,
              cursor: saving ? 'default' : 'pointer',
              padding: '2px 8px',
              fontSize: '10px',
              fontFamily: 'inherit',
              opacity: saving || !name.trim() ? 0.4 : 1,
            }}
          >
            {saving ? '...' : 'save'}
          </button>
          <button
            onClick={handleDiscard}
            style={{
              background: 'none',
              border: '1px solid #d0cdc4',
              borderRadius: 6,
              cursor: 'pointer',
              padding: '2px 6px',
              fontSize: '10px',
              color: '#8b0000',
              fontFamily: 'inherit',
            }}
          >
            discard
          </button>
        </div>
        <div style={{ fontSize: '9px', opacity: 0.3, fontFamily: "'SF Mono', monospace" }}>
          {((trimEnd - trimStart) * audioBuffer.duration).toFixed(1)}s
          {' '}(drag handles to trim)
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '6px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
      <button
        onMouseDown={state === 'idle' ? startRecording : undefined}
        onMouseUp={state === 'recording' ? stopRecording : undefined}
        onMouseLeave={state === 'recording' ? stopRecording : undefined}
        title={state === 'recording' ? 'Release to stop' : 'Hold to record'}
        style={{
          width: 28,
          height: 28,
          background: state === 'recording' ? '#8b0000' : 'none',
          border: `1.5px solid ${state === 'recording' ? '#8b0000' : '#d0cdc4'}`,
          borderRadius: 14,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'all 0.15s',
        }}
      >
        <div style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          background: state === 'recording' ? '#faf9f6' : '#8b0000',
          animation: state === 'recording' ? 'pulse 1s infinite' : undefined,
        }} />
      </button>
      {state === 'recording' && (
        <span style={{
          fontSize: '10px',
          fontFamily: "'SF Mono', monospace",
          color: '#8b0000',
          opacity: 0.7,
        }}>
          {duration.toFixed(1)}s
        </span>
      )}
      {state === 'idle' && (
        <span style={{ fontSize: '10px', opacity: 0.2, fontStyle: 'italic' }}>
          hold to record
        </span>
      )}
    </div>
  );
}
