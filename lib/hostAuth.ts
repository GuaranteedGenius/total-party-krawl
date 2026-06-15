// ============================================================
// Host (broadcaster) authentication
// ------------------------------------------------------------
// The game client (broadcaster) links the streamer's Twitch account in-game
// via OAuth device-code flow (a later Godot task). It hands us the resulting
// Twitch *user access token*; we prove channel ownership by validating that
// token with Twitch and treating the returned user_id as the authoritative
// channelId (a broadcaster's channel id == their Twitch user id).
//
// Once ownership is proven we mint a short-lived *host session JWT* (HS256,
// our own HOST_SESSION_SECRET) that the client presents on subsequent calls,
// so we don't re-hit Twitch on every publish.
//
// No game logic. Pure auth. Twitch's network call is INJECTED (deps.fetch)
// so tests run with no network.
// ============================================================

import jwt from 'jsonwebtoken';
import { AuthError } from './twitchAuth.js';
import type { HostIdentity, TwitchTokenInfo } from './types.js';

export { AuthError };

/** Twitch's OAuth token-validation endpoint (per Twitch docs). */
const TWITCH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';

/** Minimal shape of a `fetch` Response we depend on (keeps tests tiny). */
interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<FetchResponse>;

export interface ValidateDeps {
  /** Injected fetch — defaults to the global. Tests pass a mock (no network). */
  fetch?: FetchLike;
  /**
   * Expected extension/client id. If provided (and not disabled) the token's
   * `client_id` must match — defense in depth. Defaults to the env var.
   */
  expectedClientId?: string;
  /** Soft-disable the client_id check (tests, or when no client id is set). */
  enforceClientId?: boolean;
}

/** Raw success body Twitch returns from GET /oauth2/validate. */
interface TwitchValidateBody {
  client_id?: string;
  login?: string;
  user_id?: string;
  scopes?: string[];
  expires_in?: number;
}

/**
 * Validate a Twitch *user access token* with Twitch and return its info.
 *
 * Calls `GET https://id.twitch.tv/oauth2/validate` with the header
 * `Authorization: OAuth <token>` (Twitch requires the literal scheme "OAuth",
 * NOT "Bearer", for this endpoint).
 *
 * @throws AuthError(401) on a missing/invalid/expired token or client_id mismatch.
 */
export async function validateTwitchUserToken(
  token: string | null | undefined,
  deps: ValidateDeps = {},
): Promise<TwitchTokenInfo> {
  if (!token) {
    throw new AuthError('Missing Twitch user access token', 401);
  }

  const doFetch: FetchLike =
    deps.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined) ?? rejectNoFetch;

  let resp: FetchResponse;
  try {
    resp = await doFetch(TWITCH_VALIDATE_URL, {
      headers: { Authorization: `OAuth ${token}` },
    });
  } catch (err) {
    // Network/transport failure validating with Twitch — treat as unauthorized
    // rather than 500 so we never accept an unvalidated token.
    const msg = err instanceof Error ? err.message : 'validation request failed';
    throw new AuthError(`Could not validate Twitch token: ${msg}`, 401);
  }

  if (!resp.ok) {
    // 401 from Twitch == invalid/expired token. Anything else, stay 401: we
    // could not affirmatively prove ownership.
    throw new AuthError('Twitch token invalid or expired', 401);
  }

  let body: TwitchValidateBody;
  try {
    body = (await resp.json()) as TwitchValidateBody;
  } catch {
    throw new AuthError('Malformed Twitch validate response', 401);
  }

  if (!body.user_id) {
    throw new AuthError('Twitch token has no user_id (not a user access token)', 401);
  }

  // Defense in depth: optionally bind the token to our extension/client id.
  const expected = deps.expectedClientId ?? process.env.TWITCH_EXTENSION_CLIENT_ID;
  const enforce = deps.enforceClientId ?? Boolean(expected);
  if (enforce && expected && body.client_id !== expected) {
    throw new AuthError('Twitch token client_id mismatch', 401);
  }

  return {
    userId: body.user_id,
    login: body.login ?? '',
    clientId: body.client_id ?? '',
    scopes: body.scopes ?? [],
    expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 0,
  };
}

function rejectNoFetch(): Promise<FetchResponse> {
  return Promise.reject(new Error('no fetch implementation available'));
}

// ------------------------------------------------------------
// Host session JWT (our own short-lived token)
// ------------------------------------------------------------

/** Default host-session lifetime: 2 hours. */
export const HOST_TOKEN_TTL_SECONDS = 2 * 60 * 60;

interface HostClaims {
  sub: string; // channelId
  role: 'host';
  iat?: number;
  exp?: number;
}

/** Result of minting a host session token. */
export interface MintedHostToken {
  hostToken: string;
  channelId: string;
  /** Epoch ms when the token expires (for the client to schedule a refresh). */
  expiresAt: number;
}

/**
 * Mint a short-lived host-session JWT for `channelId`.
 * HS256-signed with HOST_SESSION_SECRET. Claims: { sub, role:'host', iat, exp }.
 */
export function mintHostToken(
  channelId: string,
  secret: string | undefined = process.env.HOST_SESSION_SECRET,
  ttlSeconds: number = HOST_TOKEN_TTL_SECONDS,
): MintedHostToken {
  if (!secret) {
    throw new AuthError('Server auth not configured', 500);
  }
  if (!channelId) {
    throw new AuthError('channelId required to mint host token', 401);
  }
  const claims: HostClaims = { sub: channelId, role: 'host' };
  const token = jwt.sign(claims, secret, { algorithm: 'HS256', expiresIn: ttlSeconds });
  return {
    hostToken: token,
    channelId,
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
}

/**
 * Verify a host-session JWT and return its channel scope.
 * @throws AuthError(401) on missing/invalid/expired token or wrong role.
 */
export function verifyHostToken(
  token: string | null | undefined,
  secret: string | undefined = process.env.HOST_SESSION_SECRET,
): HostIdentity {
  if (!secret) {
    throw new AuthError('Server auth not configured', 500);
  }
  if (!token) {
    throw new AuthError('Missing host token', 401);
  }

  let claims: HostClaims;
  try {
    claims = jwt.verify(token, secret, { algorithms: ['HS256'] }) as HostClaims;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'invalid token';
    throw new AuthError(`Invalid host token: ${msg}`, 401);
  }

  if (claims.role !== 'host' || !claims.sub) {
    throw new AuthError('Host token missing required claims', 401);
  }

  return { channelId: claims.sub };
}
