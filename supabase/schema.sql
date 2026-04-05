-- Boss Battle MVP — Supabase PostgreSQL Schema
-- Run this in the Supabase SQL Editor to set up your database

-- Matches table: one row per game
CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id TEXT NOT NULL,
  boss_name TEXT NOT NULL DEFAULT 'Chat Boss',
  streamer_hp_start INTEGER NOT NULL DEFAULT 300,
  boss_hp_start INTEGER NOT NULL DEFAULT 500,
  winner TEXT CHECK (winner IN ('streamer', 'chat')),
  turns_played INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

-- Index for fetching a channel's match history
CREATE INDEX IF NOT EXISTS idx_matches_channel ON matches (channel_id, started_at DESC);

-- Turns table: one row per resolved turn
CREATE TABLE IF NOT EXISTS turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  turn_number INTEGER NOT NULL,
  boss_action TEXT NOT NULL,
  streamer_action TEXT NOT NULL,
  boss_hp_after INTEGER NOT NULL,
  streamer_hp_after INTEGER NOT NULL,
  votes_json JSONB NOT NULL DEFAULT '{}',
  bits_used INTEGER NOT NULL DEFAULT 0,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_turns_match ON turns (match_id, turn_number);

-- Leaderboard table: aggregate win/loss per channel
CREATE TABLE IF NOT EXISTS leaderboard (
  channel_id TEXT PRIMARY KEY,
  streamer_wins INTEGER NOT NULL DEFAULT 0,
  chat_wins INTEGER NOT NULL DEFAULT 0,
  total_matches INTEGER NOT NULL DEFAULT 0,
  last_played TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Row Level Security (RLS) — public read, service-key write
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read (viewers need to see leaderboard)
CREATE POLICY "Public read matches" ON matches FOR SELECT USING (true);
CREATE POLICY "Public read turns" ON turns FOR SELECT USING (true);
CREATE POLICY "Public read leaderboard" ON leaderboard FOR SELECT USING (true);

-- Only service role can insert/update (backend writes via SUPABASE_SECRET_KEY)
CREATE POLICY "Service insert matches" ON matches FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service update matches" ON matches FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY "Service insert turns" ON turns FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service insert leaderboard" ON leaderboard FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service update leaderboard" ON leaderboard FOR UPDATE USING (auth.role() = 'service_role');
