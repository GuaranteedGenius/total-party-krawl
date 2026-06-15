// GET /api/host/moves?round=N — secure read of viewer lock-ins for a round.
// Auth: Authorization: Bearer <hostToken>. Scoped to the TOKEN'S channel only.
// This is the ONLY path that exposes pre-resolution moves (never anon/broadcast).
// Thin relay; no game logic.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { guard, handlePreflight, requireHost, sendJson } from '../../lib/http.ts';
import { getSupabase } from '../../lib/supabase.ts';
import { handleHostMoves } from '../../lib/relay.ts';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res, ['GET'])) return;
  const host = requireHost(req, res);
  if (!host) return;

  await guard(res, async () => {
    const round = req.query?.round;
    const roundRaw = Array.isArray(round) ? round[0] : round;
    const result = await handleHostMoves(getSupabase(), host, roundRaw);
    sendJson(res, 200, result);
  });
}
