// POST /api/join — claim/return the caller's seat. Thin relay; no game logic.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { guard, handlePreflight, requireAuth, sendJson } from '../lib/http.js';
import { getSupabase } from '../lib/supabase.js';
import { handleJoin } from '../lib/relay.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res, ['POST'])) return;
  const id = requireAuth(req, res);
  if (!id) return;

  await guard(res, async () => {
    const result = await handleJoin(getSupabase(), id);
    sendJson(res, 200, result);
  });
}
