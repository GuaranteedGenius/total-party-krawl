// ============================================================
// Tiny HTTP helpers for the Vercel handlers
// ------------------------------------------------------------
// CORS headers also come from vercel.json; we set them here too so
// OPTIONS preflight and error paths are covered before any handler logic.
// No game logic.
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AuthError, authenticate, extractToken } from './twitchAuth.js';
import { verifyHostToken } from './hostAuth.js';
import type { HostIdentity, ViewerIdentity } from './types.js';

export function sendJson(res: VercelResponse, status: number, body: unknown): void {
  res.status(status).json(body);
}

export function sendError(res: VercelResponse, status: number, message: string): void {
  res.status(status).json({ error: message });
}

/**
 * Handle CORS preflight + method gating. Returns true if the request was
 * already answered (caller should return immediately).
 */
export function handlePreflight(
  req: VercelRequest,
  res: VercelResponse,
  allowed: string[],
): boolean {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  if (!allowed.includes(req.method ?? '')) {
    sendError(res, 405, `Method not allowed; expected ${allowed.join(', ')}`);
    return true;
  }
  return false;
}

/** Authenticate or send the appropriate error; returns identity or null (already responded). */
export function requireAuth(
  req: VercelRequest,
  res: VercelResponse,
): ViewerIdentity | null {
  try {
    return authenticate(req.headers);
  } catch (err) {
    if (err instanceof AuthError) {
      sendError(res, err.status, err.message);
    } else {
      sendError(res, 401, 'Unauthorized');
    }
    return null;
  }
}

/**
 * Authenticate a HOST (broadcaster) request via its host-session JWT in
 * `Authorization: Bearer <hostToken>`. Returns the host identity (channel
 * scope) or null (already responded with the right error status).
 */
export function requireHost(
  req: VercelRequest,
  res: VercelResponse,
): HostIdentity | null {
  try {
    return verifyHostToken(extractToken(req.headers));
  } catch (err) {
    if (err instanceof AuthError) {
      sendError(res, err.status, err.message);
    } else {
      sendError(res, 401, 'Unauthorized');
    }
    return null;
  }
}

/**
 * Parse the JSON body. Vercel populates req.body for application/json, but it
 * may be a string if no content-type was sent. Returns {} for empty bodies.
 */
export function parseBody(req: VercelRequest): Record<string, unknown> {
  const b = req.body;
  if (b == null) return {};
  if (typeof b === 'string') {
    if (b.trim() === '') return {};
    try {
      return JSON.parse(b) as Record<string, unknown>;
    } catch {
      throw new BadRequest('Body is not valid JSON');
    }
  }
  if (typeof b === 'object') return b as Record<string, unknown>;
  throw new BadRequest('Unexpected body type');
}

export class BadRequest extends Error {
  status = 400;
}

/** Wrap a handler body: maps BadRequest -> 400 and anything else -> 500. */
export async function guard(
  res: VercelResponse,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof BadRequest) {
      sendError(res, err.status, err.message);
      return;
    }
    // AuthError carries its own HTTP status (e.g. 403 cross-channel publish, 401).
    if (err instanceof AuthError) {
      sendError(res, err.status, err.message);
      return;
    }
    const msg = err instanceof Error ? err.message : 'Internal error';
    sendError(res, 500, msg);
  }
}
