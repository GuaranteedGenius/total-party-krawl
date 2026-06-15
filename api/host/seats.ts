// GET /api/host/seats — secure read of the channel's seat roster.
// Auth: Authorization: Bearer <hostToken>. Scoped to the TOKEN'S channel only.
// Lets the game client learn who joined and which class they picked so it can
// build the party. Thin relay; no game logic.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { guard, handlePreflight, requireHost, sendJson } from '../../lib/http.js';
import { getSupabase } from '../../lib/supabase.js';
import { handleHostSeats } from '../../lib/relay.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res, ['GET'])) return;
  const host = requireHost(req, res);
  if (!host) return;

  await guard(res, async () => {
    const result = await handleHostSeats(getSupabase(), host);
    sendJson(res, 200, result);
  });
}
