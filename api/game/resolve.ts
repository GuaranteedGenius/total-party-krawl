// ============================================================
// POST /api/game/resolve — Resolve the current turn
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../middleware/auth';
import { resolveTurn } from '../../lib/game-engine';
import {
  broadcastGameState,
  insertTurn,
  finalizeMatch,
  updateLeaderboard,
} from '../../lib/supabase';
import { gameStates, pendingBitsActions } from '../_store';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = verifyToken(req);

    // Allow broadcaster or a special testing header
    const testingResolve = req.headers['x-testing-resolve'] === 'true';
    if (payload.role !== 'broadcaster' && !testingResolve) {
      return res.status(403).json({ error: 'Only the broadcaster can resolve a turn' });
    }

    const { channel_id } = req.body as { channel_id: string };
    if (!channel_id) {
      return res.status(400).json({ error: 'channel_id is required' });
    }

    const state = gameStates.get(channel_id);
    if (!state) {
      return res.status(404).json({ error: 'No active game on this channel' });
    }

    if (state.phase === 'game_over') {
      return res.status(400).json({ error: 'Game is already over' });
    }

    // Gather pending bits actions
    const bitsActions = pendingBitsActions.get(channel_id) ?? [];
    pendingBitsActions.set(channel_id, []);

    // Resolve the turn
    const { newState, result } = resolveTurn(state, bitsActions);
    gameStates.set(channel_id, newState);

    // Persist turn record
    await insertTurn({
      match_id: newState.match_id,
      turn_number: result.turn_number,
      boss_action: result.boss_action,
      streamer_action: result.streamer_action,
      boss_hp_after: result.boss_hp_after,
      streamer_hp_after: result.streamer_hp_after,
      votes_json: state.votes as Record<string, number>,
      bits_used: result.bits_used,
    });

    // If game over, finalize match and update leaderboard
    if (newState.phase === 'game_over' && newState.winner) {
      await finalizeMatch(newState.match_id, newState.winner, result.turn_number);
      await updateLeaderboard(channel_id, newState.winner);
    }

    // Broadcast updated state to all viewers
    await broadcastGameState(newState);

    return res.status(200).json({ state: newState, result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('POST /api/game/resolve error:', message);
    return res.status(500).json({ error: message });
  }
}
