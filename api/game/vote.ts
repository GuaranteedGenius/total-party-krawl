// ============================================================
// POST /api/game/vote — Chat viewers vote for the boss action
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../middleware/auth';
import { tallyVote } from '../../lib/game-engine';
import { gameStates } from '../_store';
import { VoteRequest } from '../../lib/types';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    verifyToken(req);

    const body = req.body as VoteRequest;
    if (!body.channel_id || !body.action || !body.viewer_id) {
      return res.status(400).json({ error: 'channel_id, action, and viewer_id are required' });
    }

    const state = gameStates.get(body.channel_id);
    if (!state) {
      return res.status(404).json({ error: 'No active game on this channel' });
    }

    if (state.match_id !== body.match_id) {
      return res.status(400).json({ error: 'match_id does not match the active game' });
    }

    const updated = tallyVote(state, body.action, body.viewer_id);
    gameStates.set(body.channel_id, updated);

    return res.status(200).json({ votes: updated.votes, total_voters: updated.total_voters });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('POST /api/game/vote error:', message);
    return res.status(500).json({ error: message });
  }
}
