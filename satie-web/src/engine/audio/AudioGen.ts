/**
 * Audio generation via ElevenLabs Sound Generation API.
 * Ported from Unity SatieAudioGen.cs.
 *
 * Endpoint: POST https://api.elevenlabs.io/v1/sound-generation
 * Returns raw PCM audio, which we decode via AudioContext.
 */

const SAMPLE_RATE = 44100;
const LOOP_DURATION = 10;
const ONESHOT_DURATION = 5;
const PROMPT_INFLUENCE = 0.3;

// In-flight requests — avoid duplicate generation for the same clip
const pending = new Map<string, Promise<ArrayBuffer>>();

export async function generateAudio(
  ctx: AudioContext,
  prompt: string,
  clipName: string,
  isLoop: boolean,
): Promise<AudioBuffer> {
  const apiKey = localStorage.getItem('satie-elevenlabs-key') ?? '';
  if (!apiKey) {
    throw new Error('ElevenLabs API key not set. Add it in dashboard settings.');
  }

  // Deduplicate concurrent requests for the same clip
  let rawPromise = pending.get(clipName);
  if (!rawPromise) {
    rawPromise = fetchSoundGeneration(apiKey, prompt, isLoop);
    pending.set(clipName, rawPromise);
  }

  try {
    const rawPCM = await rawPromise;

    // Wrap raw 16-bit PCM in a WAV container so decodeAudioData can handle it
    const wavBuffer = wrapPCMInWAV(rawPCM, SAMPLE_RATE, 1, 16);
    const audioBuffer = await ctx.decodeAudioData(wavBuffer);
    return audioBuffer;
  } finally {
    pending.delete(clipName);
  }
}

async function fetchSoundGeneration(
  apiKey: string,
  prompt: string,
  isLoop: boolean,
): Promise<ArrayBuffer> {
  const duration = isLoop ? LOOP_DURATION : ONESHOT_DURATION;

  const res = await fetch(
    `https://api.elevenlabs.io/v1/sound-generation?output_format=pcm_${SAMPLE_RATE}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text: prompt,
        duration_seconds: duration,
        prompt_influence: PROMPT_INFLUENCE,
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs API ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.arrayBuffer();
}

/**
 * Wraps raw PCM samples in a minimal WAV container.
 * Mirrors the Unity WrapInWavContainer method from SatieAudioGen.cs.
 */
function wrapPCMInWAV(
  pcmData: ArrayBuffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): ArrayBuffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmData.byteLength;
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);           // chunk size
  view.setUint16(20, 1, true);            // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Copy PCM data
  new Uint8Array(buffer, headerSize).set(new Uint8Array(pcmData));

  return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
