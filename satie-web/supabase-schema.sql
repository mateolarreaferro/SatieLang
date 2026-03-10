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
