-- ============================================================
-- Total Party Krawl — per-viewer seat schema (alpha "Fight Me")
-- ------------------------------------------------------------
-- Replaces the abandoned chat-voting model (single boss_hp/votes_json).
-- Run this in the Supabase SQL Editor.
--
-- THIN RELAY model: HP / alive / round / phase columns are MIRRORS the
-- Godot game client pushes. The server never computes combat outcomes.
--
-- RLS posture:
--   * matches, seats  -> public SELECT (extension reads channel state),
--                        all writes service-role only.
--   * moves           -> NO public read (viewers must not see each other's
--                        lock-ins before resolution); service-role only.
--   * players         -> owner can read their own row; writes service-role.
-- The service-role key bypasses RLS entirely; these policies govern the
-- anon/authenticated keys the extension or a browser might ever hold.
-- ============================================================

-- ---------- matches: one active match per channel (alpha) ----------
create table if not exists public.matches (
  channel_id        text primary key,
  status            text        not null default 'active',     -- active | ended
  current_round     integer     not null default 0,
  phase             text        not null default 'lobby',      -- lobby | choosing | resolving | ended
  boss_hp           integer     not null default 0,            -- mirror, client-pushed
  boss_max_hp       integer     not null default 0,            -- mirror, client-pushed
  boss_alive        boolean     not null default true,         -- mirror, client-pushed
  ends_at_epoch_ms  bigint,                                    -- soft-timer hint from client
  snapshot          jsonb,                                     -- last full /api/state payload the client published
  updated_at        timestamptz not null default now()
);

-- ---------- seats: up to 10 viewer slots per channel ----------
create table if not exists public.seats (
  channel_id      text        not null references public.matches(channel_id) on delete cascade,
  seat_index      integer     not null check (seat_index >= 0 and seat_index < 10),
  opaque_user_id  text        not null,
  class_id        text,                                        -- class.tank | class.mage | class.healer | null
  hp              integer     not null default 0,              -- mirror, client-pushed
  max_hp          integer     not null default 0,              -- mirror, client-pushed
  alive           boolean     not null default true,           -- mirror, client-pushed
  joined_at       timestamptz not null default now(),
  primary key (channel_id, seat_index),
  unique (channel_id, opaque_user_id)                          -- one seat per viewer per channel
);

create index if not exists idx_seats_channel on public.seats (channel_id);

-- ---------- moves: one lock-in per (channel, round, seat) ----------
create table if not exists public.moves (
  channel_id   text        not null,
  round        integer     not null,
  seat_index   integer     not null,
  move_id      text        not null,
  target_id    text        not null,
  created_at   timestamptz not null default now(),
  primary key (channel_id, round, seat_index),                 -- re-submit upserts
  foreign key (channel_id, seat_index)
    references public.seats(channel_id, seat_index) on delete cascade
);

create index if not exists idx_moves_channel_round on public.moves (channel_id, round);

-- ---------- players: persistent per-viewer progression stub ----------
create table if not exists public.players (
  opaque_user_id  text        primary key,
  display_name    text,
  xp              integer     not null default 0,
  level           integer     not null default 1,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.matches enable row level security;
alter table public.seats   enable row level security;
alter table public.moves   enable row level security;
alter table public.players enable row level security;

-- matches: public read, service-role write
drop policy if exists "matches public read"      on public.matches;
drop policy if exists "matches service write"     on public.matches;
create policy "matches public read"  on public.matches
  for select using (true);
create policy "matches service write" on public.matches
  for all to service_role using (true) with check (true);

-- seats: public read, service-role write
drop policy if exists "seats public read"   on public.seats;
drop policy if exists "seats service write"  on public.seats;
create policy "seats public read"  on public.seats
  for select using (true);
create policy "seats service write" on public.seats
  for all to service_role using (true) with check (true);

-- moves: NO public read; service-role only (read + write)
drop policy if exists "moves service all" on public.moves;
create policy "moves service all" on public.moves
  for all to service_role using (true) with check (true);

-- players: owner reads own row, service-role writes.
-- "owner" = a request whose JWT 'sub' equals opaque_user_id. The extension
-- never holds such a JWT today (all reads go through service-role functions),
-- but this future-proofs a direct owner read if we ever add one.
drop policy if exists "players owner read"   on public.players;
drop policy if exists "players service write" on public.players;
create policy "players owner read" on public.players
  for select using (auth.jwt() ->> 'sub' = opaque_user_id);
create policy "players service write" on public.players
  for all to service_role using (true) with check (true);
