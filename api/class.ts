// POST /api/class — set the caller's class. Thin relay; no game logic.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { guard, handlePreflight, parseBody, requireAuth, sendJson } from '../lib/http.js';
import { getSupabase } from '../lib/supabase.js';
import { handleClass } from '../lib/relay.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res, ['POST'])) return;
  const id = requireAuth(req, res);
  if (!id) return;

  await guard(res, async () => {
    const result = await handleClass(getSupabase(), id, parseBody(req));
    sendJson(res, 200, result);
  });
}
