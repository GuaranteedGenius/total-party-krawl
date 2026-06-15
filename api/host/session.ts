// POST /api/host/session — exchange a Twitch user access token for a host JWT.
// Header: Authorization: Bearer <twitch_user_access_token>. Body: {}.
// Validates ownership with Twitch (user_id == channelId), ensures the channel's
// match row, returns { hostToken, channelId, expiresAt }. Thin relay; no game logic.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { guard, handlePreflight, sendError, sendJson } from '../../lib/http.js';
import { extractToken } from '../../lib/twitchAuth.js';
import { getSupabase } from '../../lib/supabase.js';
import { handleHostSession } from '../../lib/relay.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res, ['POST'])) return;

  const twitchToken = extractToken(req.headers);
  if (!twitchToken) {
    sendError(res, 401, 'Missing Twitch user access token');
    return;
  }

  await guard(res, async () => {
    const result = await handleHostSession(getSupabase(), twitchToken);
    sendJson(res, 200, result);
  });
}
