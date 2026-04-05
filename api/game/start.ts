// ============================================================
// POST /api/game/start — Start a new Boss Battle match
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../middleware/auth';
import { createGameState } from '../../lib/game-engine';
import { insertMatch, broadcastGameState } from '../../lib/supabase';
import { gameStates, pendingBitsActions } from '../_store';
import { StartGameRequest } from '../../lib/types';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = verifyToken(req);

    if (payload.role !== 'broadcaster') {
      return res.status(403).json({ error: 'Only the broadcaster can start a game' });
    }

    const body = req.body as StartGameRequest;
    if (!body.channel_id) {
      return res.status(400).json({ error: 'channel_id is required' });
    }

    const bossName = body.boss_name ?? 'The Dark One';

    // Check for existing active game
    const existing = gameStates.get(body.channel_id);
    if (existing && existing.phase !== 'game_over') {
      return res.status(409).json({ error: 'A game is already active on this channel' });
    }

    // Insert match record in DB
    const matchId = await insertMatch({
      channel_id: body.channel_id,
      boss_name: bossName,
    });

    // Create in-memory game state
    const state = createGameState(matchId, body.channel_id, bossName);
    gameStates.set(body.channel_id, state);
    pendingBitsActions.set(body.channel_id, []);

    // Broadcast initial state to all viewers
    await broadcastGameState(state);

    return res.status(200).json(state);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('POST /api/game/start error:', message);
    return res.status(500).json({ error: message });
  }
}
