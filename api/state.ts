// GET /api/state — read the caller-relevant snapshot. Pure read; no game logic.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { guard, handlePreflight, requireAuth, sendJson } from '../lib/http.js';
import { getSupabase } from '../lib/supabase.js';
import { handleState } from '../lib/relay.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res, ['GET'])) return;
  const id = requireAuth(req, res);
  if (!id) return;

  await guard(res, async () => {
    const snapshot = await handleState(getSupabase(), id);
    sendJson(res, 200, snapshot);
  });
}
