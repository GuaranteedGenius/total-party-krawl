// ============================================================
// GET /api/game/state — Return current game state for a channel
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../middleware/auth';
import { gameStates } from '../_store';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    verifyToken(req);

    const channelId = req.query.channel_id as string | undefined;
    if (!channelId) {
      return res.status(400).json({ error: 'channel_id query parameter is required' });
    }

    const state = gameStates.get(channelId);
    if (!state) {
      return res.status(404).json({ error: 'No active game on this channel' });
    }

    return res.status(200).json(state);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('GET /api/game/state error:', message);
    return res.status(500).json({ error: message });
  }
}
