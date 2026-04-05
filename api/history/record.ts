// ============================================================
// POST /api/history/record — Manually finalize a match record
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyToken } from '../middleware/auth';
import { finalizeMatch, updateLeaderboard } from '../../lib/supabase';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = verifyToken(req);

    if (payload.role !== 'broadcaster') {
      return res.status(403).json({ error: 'Only the broadcaster can record match history' });
    }

    const { match_id, channel_id, winner, turns_played } = req.body as {
      match_id: string;
      channel_id: string;
      winner: 'streamer' | 'chat';
      turns_played: number;
    };

    if (!match_id || !channel_id || !winner || turns_played == null) {
      return res.status(400).json({ error: 'match_id, channel_id, winner, and turns_played are required' });
    }

    if (winner !== 'streamer' && winner !== 'chat') {
      return res.status(400).json({ error: 'winner must be "streamer" or "chat"' });
    }

    await finalizeMatch(match_id, winner, turns_played);
    await updateLeaderboard(channel_id, winner);

    return res.status(200).json({ finalized: true, match_id, winner });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('POST /api/history/record error:', message);
    return res.status(500).json({ error: message });
  }
}
