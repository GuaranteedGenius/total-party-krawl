// POST /api/move — record + relay the caller's lock-in. Thin relay; no game logic.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { guard, handlePreflight, parseBody, requireAuth, sendJson } from '../lib/http.ts';
import { getSupabase } from '../lib/supabase.ts';
import { handleMove } from '../lib/relay.ts';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res, ['POST'])) return;
  const id = requireAuth(req, res);
  if (!id) return;

  await guard(res, async () => {
    const result = await handleMove(getSupabase(), id, parseBody(req));
    sendJson(res, 200, result);
  });
}
