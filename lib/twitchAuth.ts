// ============================================================
// Twitch Extension JWT verification
// ------------------------------------------------------------
// Verifies the Twitch Extension Helper JWT that every viewer->server
// call carries. The extension secret is base64-encoded in the Twitch
// developer console; Twitch signs the JWT HS256 with the DECODED bytes.
//
// No game logic. Pure auth.
// ============================================================

import jwt from 'jsonwebtoken';
import type { ViewerIdentity } from './types.ts';

/** Thrown for any auth failure. `status` is the HTTP code the handler should return. */
export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/** Shape of the claims Twitch puts in the Extension JWT we care about. */
interface TwitchExtClaims {
  channel_id?: string;
  opaque_user_id?: string;
  user_id?: string;
  role?: string;
  exp?: number;
}

/**
 * Pull the raw JWT from request headers.
 * Accepts `Authorization: Bearer <jwt>` (preferred) or `X-Extension-JWT: <jwt>`.
 * Header lookup is case-insensitive; values may be string | string[].
 */
export function extractToken(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const get = (name: string): string | undefined => {
    const lower = name.toLowerCase();
    // Node/Vercel lower-cases incoming header keys, but scan case-insensitively
    // so the helper is robust to any caller (e.g. tests, other runtimes).
    let v = headers[lower] ?? headers[name];
    if (v === undefined) {
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === lower) {
          v = headers[k];
          break;
        }
      }
    }
    if (Array.isArray(v)) return v[0];
    return v;
  };

  const auth = get('authorization');
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }

  const x = get('x-extension-jwt');
  if (x) return x.trim();

  return null;
}

/**
 * Verify an Extension JWT against the (base64) extension secret and return identity.
 *
 * @param token       the raw JWT string
 * @param base64Secret the extension secret exactly as shown in the Twitch console
 *                     (base64). Defaults to process.env.TWITCH_EXTENSION_SECRET.
 * @throws AuthError(401) on missing secret/token, bad signature, expiry, or missing claims.
 */
export function verifyExtensionJwt(
  token: string | null | undefined,
  base64Secret: string | undefined = process.env.TWITCH_EXTENSION_SECRET,
): ViewerIdentity {
  if (!base64Secret) {
    // Misconfiguration, not the caller's fault — but never leak that we accept anything.
    throw new AuthError('Server auth not configured', 500);
  }
  if (!token) {
    throw new AuthError('Missing extension JWT', 401);
  }

  const key = Buffer.from(base64Secret, 'base64');

  let claims: TwitchExtClaims;
  try {
    claims = jwt.verify(token, key, { algorithms: ['HS256'] }) as TwitchExtClaims;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'invalid token';
    // jsonwebtoken throws TokenExpiredError / JsonWebTokenError — all map to 401.
    throw new AuthError(`Invalid extension JWT: ${msg}`, 401);
  }

  if (!claims.channel_id || !claims.opaque_user_id || !claims.role) {
    throw new AuthError('Extension JWT missing required claims', 401);
  }

  return {
    channelId: claims.channel_id,
    opaqueUserId: claims.opaque_user_id,
    userId: claims.user_id,
    role: claims.role,
  };
}

/** Convenience: extract + verify directly from request headers. */
export function authenticate(
  headers: Record<string, string | string[] | undefined>,
  base64Secret?: string,
): ViewerIdentity {
  return verifyExtensionJwt(extractToken(headers), base64Secret);
}
