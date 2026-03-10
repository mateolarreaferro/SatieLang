/**
 * Supabase Storage integration for audio samples.
 * Samples are stored in a `samples` bucket at: {user_id}/{sketch_id}/{filename}
 * A `sketch_samples` table tracks the manifest of files per sketch.
 */
import { supabase } from './supabase';
import { getCachedSample, cacheSample } from './sampleCache';

const BUCKET = 'samples';

export interface SketchSample {
  id: string;
  sketch_id: string;
  user_id: string;
  filename: string;       // clip name, e.g. "Audio/bird_6"
  storage_path: string;   // path in bucket
  size_bytes: number;
  created_at: string;
}

/** Upload a sample to Supabase Storage and register it in sketch_samples. */
export async function uploadSample(
  userId: string,
  sketchId: string,
  clipName: string,
  data: ArrayBuffer,
): Promise<void> {
  const storagePath = `${userId}/${sketchId}/${encodeURIComponent(clipName)}`;

  // Upload to storage bucket
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, data, {
      contentType: 'audio/wav',
      upsert: true,
    });

  if (uploadError) throw uploadError;

  // Upsert into sketch_samples table
  const { error: dbError } = await supabase
    .from('sketch_samples')
    .upsert(
      {
        sketch_id: sketchId,
        user_id: userId,
        filename: clipName,
        storage_path: storagePath,
        size_bytes: data.byteLength,
      },
      { onConflict: 'sketch_id,filename' },
    );

  if (dbError) throw dbError;
}

/** Upload all samples for a sketch. Skips samples that already exist in storage. */
export async function uploadSketchSamples(
  userId: string,
  sketchId: string,
  samples: Map<string, ArrayBuffer>,
): Promise<void> {
  // Get existing samples for this sketch
  const existing = await getSketchSamples(sketchId);
  const existingNames = new Set(existing.map((s) => s.filename));

  const uploads: Promise<void>[] = [];
  for (const [clipName, data] of samples) {
    if (existingNames.has(clipName)) continue;
    uploads.push(uploadSample(userId, sketchId, clipName, data));
  }

  await Promise.all(uploads);
}

/** Get the sample manifest for a sketch. */
export async function getSketchSamples(sketchId: string): Promise<SketchSample[]> {
  const { data, error } = await supabase
    .from('sketch_samples')
    .select('*')
    .eq('sketch_id', sketchId);

  if (error) throw error;
  return data ?? [];
}

/**
 * Download a sample's audio data.
 * Checks IndexedDB cache first, then falls back to Supabase Storage.
 */
export async function downloadSample(sample: SketchSample): Promise<ArrayBuffer> {
  // Check local cache first
  const cached = await getCachedSample(sample.filename);
  if (cached) return cached;

  // Download from Supabase Storage
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(sample.storage_path);

  if (error) throw error;
  if (!data) throw new Error(`No data returned for ${sample.filename}`);

  const arrayBuffer = await data.arrayBuffer();

  // Cache locally for next time
  await cacheSample(sample.filename, arrayBuffer);

  return arrayBuffer;
}

/**
 * Download and load all samples for a sketch into the engine.
 * Returns the list of clip names that were loaded.
 */
export async function loadSketchSamples(
  sketchId: string,
  loadBuffer: (name: string, data: ArrayBuffer) => Promise<void>,
): Promise<string[]> {
  const samples = await getSketchSamples(sketchId);
  if (samples.length === 0) return [];

  const loaded: string[] = [];

  await Promise.all(
    samples.map(async (sample) => {
      try {
        const data = await downloadSample(sample);
        await loadBuffer(sample.filename, data);
        loaded.push(sample.filename);
      } catch (e) {
        console.error(`[SampleStorage] Failed to load ${sample.filename}:`, e);
      }
    }),
  );

  return loaded;
}

/** Delete a sample from storage and the manifest. */
export async function deleteSample(sample: SketchSample): Promise<void> {
  await supabase.storage.from(BUCKET).remove([sample.storage_path]);
  await supabase.from('sketch_samples').delete().eq('id', sample.id);
}
