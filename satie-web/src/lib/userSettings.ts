/**
 * User settings (API keys, preferences) — stored in Supabase for logged-in users,
 * with localStorage fallback for guests and as a cache.
 */
import { supabase } from './supabase';

export interface UserSettings {
  anthropic_key: string;
  elevenlabs_key: string;
  openai_key: string;
}

const LS_ANTHROPIC = 'satie-anthropic-key';
const LS_ELEVENLABS = 'satie-elevenlabs-key';
const LS_OPENAI = 'satie-openai-key';

/** Load settings: tries Supabase first (logged in), falls back to localStorage. */
export async function loadSettings(userId: string | null): Promise<UserSettings> {
  const local: UserSettings = {
    anthropic_key: localStorage.getItem(LS_ANTHROPIC) ?? '',
    elevenlabs_key: localStorage.getItem(LS_ELEVENLABS) ?? '',
    openai_key: localStorage.getItem(LS_OPENAI) ?? '',
  };

  if (!userId) return local;

  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('anthropic_key, elevenlabs_key, openai_key')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found

    if (data) {
      // Sync to localStorage as cache
      const settings: UserSettings = {
        anthropic_key: data.anthropic_key ?? '',
        elevenlabs_key: data.elevenlabs_key ?? '',
        openai_key: data.openai_key ?? '',
      };
      localStorage.setItem(LS_ANTHROPIC, settings.anthropic_key);
      localStorage.setItem(LS_ELEVENLABS, settings.elevenlabs_key);
      localStorage.setItem(LS_OPENAI, settings.openai_key);
      return settings;
    }

    // No remote settings yet — if we have local keys, push them up
    if (local.anthropic_key || local.elevenlabs_key) {
      await saveSettings(userId, local);
    }
    return local;
  } catch (e) {
    console.error('[UserSettings] Failed to load from Supabase:', e);
    return local;
  }
}

/** Save a single key. Updates both localStorage and Supabase. */
export async function saveKey(
  userId: string | null,
  field: keyof UserSettings,
  value: string,
): Promise<void> {
  // Always save locally (cache + guest fallback)
  const lsKey = field === 'anthropic_key' ? LS_ANTHROPIC : field === 'openai_key' ? LS_OPENAI : LS_ELEVENLABS;
  localStorage.setItem(lsKey, value);

  if (!userId) return;

  try {
    await supabase
      .from('user_settings')
      .upsert(
        { user_id: userId, [field]: value, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
  } catch (e) {
    console.error('[UserSettings] Failed to save to Supabase:', e);
  }
}

/** Save all settings at once. */
export async function saveSettings(
  userId: string,
  settings: UserSettings,
): Promise<void> {
  localStorage.setItem(LS_ANTHROPIC, settings.anthropic_key);
  localStorage.setItem(LS_ELEVENLABS, settings.elevenlabs_key);
  localStorage.setItem(LS_OPENAI, settings.openai_key);

  try {
    await supabase
      .from('user_settings')
      .upsert(
        {
          user_id: userId,
          anthropic_key: settings.anthropic_key,
          elevenlabs_key: settings.elevenlabs_key,
          openai_key: settings.openai_key,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
  } catch (e) {
    console.error('[UserSettings] Failed to save to Supabase:', e);
  }
}
