-- Run this in your Supabase SQL editor to set up the database

-- Sketches table
create table public.sketches (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null default 'Untitled',
  script text not null default '# satie
',
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for fast user lookups
create index sketches_user_id_idx on public.sketches(user_id);
create index sketches_public_idx on public.sketches(is_public) where is_public = true;

-- Row Level Security: users can only access their own sketches
alter table public.sketches enable row level security;

-- Users can read their own sketches
create policy "Users can read own sketches"
  on public.sketches for select
  using (auth.uid() = user_id);

-- Users can insert their own sketches
create policy "Users can insert own sketches"
  on public.sketches for insert
  with check (auth.uid() = user_id);

-- Users can update their own sketches
create policy "Users can update own sketches"
  on public.sketches for update
  using (auth.uid() = user_id);

-- Users can delete their own sketches
create policy "Users can delete own sketches"
  on public.sketches for delete
  using (auth.uid() = user_id);

-- Anyone can read public sketches
create policy "Anyone can read public sketches"
  on public.sketches for select
  using (is_public = true);

-- ============================================================
-- Sketch Samples — manifest of audio files attached to sketches
-- ============================================================

create table public.sketch_samples (
  id uuid default gen_random_uuid() primary key,
  sketch_id uuid references public.sketches(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  filename text not null,
  storage_path text not null,
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  unique(sketch_id, filename)
);

create index sketch_samples_sketch_id_idx on public.sketch_samples(sketch_id);

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

-- Allow reading samples for public sketches
create policy "Anyone can read samples of public sketches"
  on public.sketch_samples for select
  using (
    exists (
      select 1 from public.sketches
      where sketches.id = sketch_samples.sketch_id
        and sketches.is_public = true
    )
  );

-- ============================================================
-- Storage bucket for audio samples
-- Run this separately in Supabase Dashboard > Storage, or via SQL:
-- ============================================================

insert into storage.buckets (id, name, public)
  values ('samples', 'samples', false)
  on conflict (id) do nothing;

-- Storage RLS: users can upload to their own folder
create policy "Users can upload own samples"
  on storage.objects for insert
  with check (
    bucket_id = 'samples'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Users can read their own samples
create policy "Users can read own samples"
  on storage.objects for select
  using (
    bucket_id = 'samples'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Users can delete their own samples
create policy "Users can delete own samples"
  on storage.objects for delete
  using (
    bucket_id = 'samples'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Anyone can read samples that belong to public sketches
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

-- Allow upsert (update existing files)
create policy "Users can update own samples"
  on storage.objects for update
  using (
    bucket_id = 'samples'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
