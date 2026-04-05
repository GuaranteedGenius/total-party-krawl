// ============================================================
// POST /api/game/action — Streamer locks in their action
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../middleware/auth';
import { gameStates } from '../_store';
import { ActionRequest } from '../../lib/types';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = verifyToken(req);

    if (payload.role !== 'broadcaster') {
      return res.status(403).json({ error: 'Only the broadcaster can set an action' });
    }

    const body = req.body as ActionRequest;
    if (!body.channel_id || !body.action) {
      return res.status(400).json({ error: 'channel_id and action are required' });
    }

    const state = gameStates.get(body.channel_id);
    if (!state) {
      return res.status(404).json({ error: 'No active game on this channel' });
    }

    if (state.match_id !== body.match_id) {
      return res.status(400).json({ error: 'match_id does not match the active game' });
    }

    if (state.phase !== 'voting') {
      return res.status(400).json({ error: 'Cannot set action outside of the voting phase' });
    }

    state.streamer_action = body.action;
    gameStates.set(body.channel_id, state);

    return res.status(200).json({ streamer_action: state.streamer_action });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('POST /api/game/action error:', message);
    return res.status(500).json({ error: message });
  }
}
