// ============================================================
// GET /api/history/leaderboard — Public leaderboard endpoint
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getLeaderboard } from '../../lib/supabase';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const channelId = req.query.channel_id as string | undefined;
    const data = await getLeaderboard(channelId);

    return res.status(200).json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('GET /api/history/leaderboard error:', message);
    return res.status(500).json({ error: message });
  }
}
