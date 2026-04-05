// ============================================================
// JWT verification middleware for Twitch Extension tokens
// ============================================================

import type { VercelRequest } from '@vercel/node';
import jwt from 'jsonwebtoken';
import { TwitchJWTPayload } from '../../lib/types';

/**
 * Extract and verify the Twitch Extension JWT from the request.
 * Returns the decoded payload or throws on failure.
 */
export function verifyToken(req: VercelRequest): TwitchJWTPayload {
  const authHeader = req.headers['authorization'] as string | undefined;
  const extensionHeader = req.headers['x-extension-jwt'] as string | undefined;

  let token: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (extensionHeader) {
    token = extensionHeader;
  }

  if (!token) {
    throw new Error('Missing JWT: provide Authorization Bearer token or X-Extension-JWT header');
  }

  const testingMode = process.env.TESTING_MODE === 'true';

  // SAFETY: never allow testing mode in production
  if (testingMode && process.env.NODE_ENV === 'production') {
    throw new Error('TESTING_MODE cannot be enabled in production');
  }

  if (testingMode) {
    console.warn('\u26a0\ufe0f TESTING_MODE: JWT signature verification skipped');
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT structure');
    }
    const payloadJson = Buffer.from(parts[1], 'base64').toString('utf-8');
    const payload = JSON.parse(payloadJson) as TwitchJWTPayload;
    return payload;
  }

  // Production verification
  const secret = process.env.TWITCH_EXTENSION_SECRET;
  if (!secret) {
    throw new Error('Missing TWITCH_EXTENSION_SECRET environment variable');
  }

  const decoded = jwt.verify(token, Buffer.from(secret, 'base64')) as TwitchJWTPayload;
  return decoded;
}
