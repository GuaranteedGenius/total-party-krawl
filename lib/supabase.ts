// ============================================================
// Supabase Client — database + realtime publish helper
// ============================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { GameState } from './types';

let _client: SupabaseClient | null = null;

/** Get the Supabase service-role client (backend use only). Returns null if not configured. */
export function getSupabase(): SupabaseClient | null {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    console.warn('Supabase not configured — running without database persistence');
    return null;
  }

  _client = createClient(url, key, {
    auth: { persistSession: false },
  });

  return _client;
}

/** Broadcast game state to all subscribers on the channel */
export async function broadcastGameState(state: GameState): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const channelName = `game:${state.channel_id}`;
  const channel = supabase.channel(channelName);

  await channel.send({
    type: 'broadcast',
    event: 'game_state',
    payload: state as unknown as Record<string, unknown>,
  });

  // Clean up — unsubscribe server-side after sending
  await supabase.removeChannel(channel);
}

/** Insert a match record */
export async function insertMatch(data: {
  channel_id: string;
  boss_name: string;
}): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) {
    // Generate a local match ID when Supabase isn't configured
    return crypto.randomUUID();
  }

  const { data: row, error } = await supabase
    .from('matches')
    .insert({
      channel_id: data.channel_id,
      boss_name: data.boss_name,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to insert match: ${error.message}`);
  return row.id;
}

/** Finalize a match with winner and turn count */
export async function finalizeMatch(matchId: string, winner: 'streamer' | 'chat', turnsPlayed: number): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const { error } = await supabase
    .from('matches')
    .update({
      winner,
      turns_played: turnsPlayed,
      ended_at: new Date().toISOString(),
    })
    .eq('id', matchId);

  if (error) throw new Error(`Failed to finalize match: ${error.message}`);
}

/** Insert a turn record */
export async function insertTurn(data: {
  match_id: string;
  turn_number: number;
  boss_action: string;
  streamer_action: string;
  boss_hp_after: number;
  streamer_hp_after: number;
  votes_json: Record<string, number>;
  bits_used: number;
}): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const { error } = await supabase.from('turns').insert(data);
  if (error) throw new Error(`Failed to insert turn: ${error.message}`);
}

/** Upsert leaderboard entry */
export async function updateLeaderboard(channelId: string, winner: 'streamer' | 'chat'): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  // Try to get existing entry
  const { data: existing } = await supabase
    .from('leaderboard')
    .select('*')
    .eq('channel_id', channelId)
    .single();

  if (existing) {
    const { error } = await supabase
      .from('leaderboard')
      .update({
        streamer_wins: existing.streamer_wins + (winner === 'streamer' ? 1 : 0),
        chat_wins: existing.chat_wins + (winner === 'chat' ? 1 : 0),
        total_matches: existing.total_matches + 1,
        last_played: new Date().toISOString(),
      })
      .eq('channel_id', channelId);
    if (error) throw new Error(`Failed to update leaderboard: ${error.message}`);
  } else {
    const { error } = await supabase
      .from('leaderboard')
      .insert({
        channel_id: channelId,
        streamer_wins: winner === 'streamer' ? 1 : 0,
        chat_wins: winner === 'chat' ? 1 : 0,
        total_matches: 1,
        last_played: new Date().toISOString(),
      });
    if (error) throw new Error(`Failed to insert leaderboard: ${error.message}`);
  }
}

/** Fetch leaderboard */
export async function getLeaderboard(channelId?: string) {
  const supabase = getSupabase();
  if (!supabase) return [];

  let query = supabase.from('leaderboard').select('*').order('total_matches', { ascending: false }).limit(50);
  if (channelId) {
    query = query.eq('channel_id', channelId);
  }
  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch leaderboard: ${error.message}`);
  return data;
}
