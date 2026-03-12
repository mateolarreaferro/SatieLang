/**
 * Audio generation via ElevenLabs Sound Generation API.
 * Ported from Unity SatieAudioGen.cs.
 *
 * Endpoint: POST https://api.elevenlabs.io/v1/sound-generation
 * Returns MP3 audio, which we decode via AudioContext.decodeAudioData.
 */

const LOOP_DURATION = 10;
const ONESHOT_DURATION = 5;
const PROMPT_INFLUENCE = 0.3;

const DB_NAME = 'satie-audio-cache';
const DB_VERSION = 2; // bumped: cache now stores MP3 instead of raw PCM
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

  // Check IndexedDB cache first (cached as MP3 bytes)
  const ck = cacheKey(prompt, duration, influence, clipName);
  const cached = await getCached(ck);
  if (cached) {
    return ctx.decodeAudioData(cached.slice(0));
  }

  // Deduplicate concurrent requests for the same clip
  let rawPromise = pending.get(clipName);
  if (!rawPromise) {
    rawPromise = fetchSoundGenerationRateLimited(apiKey, prompt, duration, influence);
    pending.set(clipName, rawPromise);
  }

  try {
    const mp3Data = await rawPromise;

    // Store MP3 in IndexedDB cache
    await setCache(ck, mp3Data);

    // decodeAudioData consumes the buffer, so pass a copy
    const audioBuffer = await ctx.decodeAudioData(mp3Data.slice(0));
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
    'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128',
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
