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

const DB_NAME = 'satie-audio-cache';
const DB_VERSION = 1;
const STORE_NAME = 'generated';

export interface GenOptions {
  duration?: number;
  influence?: number;
}

// In-flight requests — avoid duplicate generation for the same clip
const pending = new Map<string, Promise<ArrayBuffer>>();

// Rate limiting: max 3 concurrent ElevenLabs API calls
const MAX_CONCURRENT = 3;
let activeRequests = 0;
const requestQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT) {
    activeRequests++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    requestQueue.push(() => { activeRequests++; resolve(); });
  });
}

function releaseSlot(): void {
  activeRequests--;
  const next = requestQueue.shift();
  if (next) next();
}

// ── IndexedDB cache ──

function openCacheDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function cacheKey(prompt: string, duration: number, influence: number, clipName: string): string {
  return `${prompt}|${duration}|${influence}|${clipName}`;
}

async function getCached(key: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openCacheDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function setCache(key: string, data: ArrayBuffer): Promise<void> {
  try {
    const db = await openCacheDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data, key);
  } catch {
    // Cache write failure is non-fatal
  }
}

export async function clearAudioCache(): Promise<void> {
  try {
    const db = await openCacheDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
  } catch {
    // Ignore
  }
}

// ── Main API ──

export async function generateAudio(
  ctx: AudioContext,
  prompt: string,
  clipName: string,
  isLoop: boolean,
  options?: GenOptions,
): Promise<AudioBuffer> {
  const apiKey = localStorage.getItem('satie-elevenlabs-key') ?? '';
  if (!apiKey) {
    throw new Error('ElevenLabs API key not set. Add it in dashboard settings.');
  }

  const duration = options?.duration ?? (isLoop ? LOOP_DURATION : ONESHOT_DURATION);
  const influence = options?.influence ?? PROMPT_INFLUENCE;

  // Check IndexedDB cache first
  const ck = cacheKey(prompt, duration, influence, clipName);
  const cached = await getCached(ck);
  if (cached) {
    const wavBuffer = wrapPCMInWAV(cached, SAMPLE_RATE, 1, 16);
    return ctx.decodeAudioData(wavBuffer);
  }

  // Deduplicate concurrent requests for the same clip
  let rawPromise = pending.get(clipName);
  if (!rawPromise) {
    rawPromise = fetchSoundGenerationRateLimited(apiKey, prompt, duration, influence);
    pending.set(clipName, rawPromise);
  }

  try {
    const rawPCM = await rawPromise;

    // Store in IndexedDB cache
    await setCache(ck, rawPCM);

    // Wrap raw 16-bit PCM in a WAV container so decodeAudioData can handle it
    const wavBuffer = wrapPCMInWAV(rawPCM, SAMPLE_RATE, 1, 16);
    const audioBuffer = await ctx.decodeAudioData(wavBuffer);
    return audioBuffer;
  } finally {
    pending.delete(clipName);
  }
}

async function fetchSoundGenerationRateLimited(
  apiKey: string,
  prompt: string,
  duration: number,
  influence: number,
): Promise<ArrayBuffer> {
  await acquireSlot();
  try {
    return await fetchSoundGeneration(apiKey, prompt, duration, influence);
  } finally {
    releaseSlot();
  }
}

async function fetchSoundGeneration(
  apiKey: string,
  prompt: string,
  duration: number,
  influence: number,
): Promise<ArrayBuffer> {
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
        prompt_influence: influence,
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
