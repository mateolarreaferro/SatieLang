-- ============================================================
-- MIGRATION: Sketch Samples + User Settings (API keys)
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================================

-- 1. Sketch Samples table
create table if not exists public.sketch_samples (
  id uuid default gen_random_uuid() primary key,
  sketch_id uuid references public.sketches(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  filename text not null,
  storage_path text not null,
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  unique(sketch_id, filename)
);

create index if not exists sketch_samples_sketch_id_idx on public.sketch_samples(sketch_id);

alter table public.sketch_samples enable row level security;

create policy "Users can read own sketch samples"
  on public.sketch_samples for select
  using (auth.uid() = user_id);

create policy "Users can insert own sketch samples"
  on public.sketch_samples for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own sketch samples"
  on public.sketch_samples for delete
  using (auth.uid() = user_id);

create policy "Anyone can read samples of public sketches"
  on public.sketch_samples for select
  using (
    exists (
      select 1 from public.sketches
      where sketches.id = sketch_samples.sketch_id
        and sketches.is_public = true
    )
  );

-- 2. User Settings table (API keys, preferences)
create table if not exists public.user_settings (
  user_id uuid references auth.users(id) on delete cascade primary key,
  anthropic_key text,
  elevenlabs_key text,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "Users can read own settings"
  on public.user_settings for select
  using (auth.uid() = user_id);

create policy "Users can upsert own settings"
  on public.user_settings for insert
  with check (auth.uid() = user_id);

create policy "Users can update own settings"
  on public.user_settings for update
  using (auth.uid() = user_id);

-- 3. Storage bucket for audio samples
insert into storage.buckets (id, name, public)
  values ('samples', 'samples', false)
  on conflict (id) do nothing;

-- Storage policies
create policy "Users can upload own samples"
  on storage.objects for insert
  with check (
    bucket_id = 'samples'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can read own samples"
  on storage.objects for select
  using (
    bucket_id = 'samples'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete own samples"
  on storage.objects for delete
  using (
    bucket_id = 'samples'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can update own samples"
  on storage.objects for update
  using (
    bucket_id = 'samples'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Anyone can read public sketch samples"
  on storage.objects for select
  using (
    bucket_id = 'samples'
    and exists (
      select 1 from public.sketch_samples ss
      join public.sketches s on s.id = ss.sketch_id
      where ss.storage_path = name
        and s.is_public = true
    )
  );
