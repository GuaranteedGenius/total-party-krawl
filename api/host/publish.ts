// POST /api/host/publish — persist client-computed mirrors + relay state/prompt.
// Auth: Authorization: Bearer <hostToken>. Writes to the TOKEN'S channel only.
// Thin relay; stores exactly what the client published. NO game logic.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { guard, handlePreflight, parseBody, requireHost, sendJson } from '../../lib/http.js';
import { getSupabase } from '../../lib/supabase.js';
import { handleHostPublish } from '../../lib/relay.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res, ['POST'])) return;
  const host = requireHost(req, res);
  if (!host) return;

  await guard(res, async () => {
    const result = await handleHostPublish(getSupabase(), host, parseBody(req));
    sendJson(res, 200, result);
  });
}
