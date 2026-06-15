import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  AuthError,
  HOST_TOKEN_TTL_SECONDS,
  mintHostToken,
  validateTwitchUserToken,
  verifyHostToken,
} from '../hostAuth.js';

const HOST_SECRET = 'host-session-secret-for-tpk-tests-0123456789';

// ---- a tiny injectable fetch mock (no network) ----
function fetchOk(body: Record<string, unknown>) {
  return async (_url: string, _init?: unknown) => ({
    ok: true,
    status: 200,
    json: async () => body,
  });
}
function fetchStatus(status: number) {
  return async (_url: string, _init?: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
  });
}

const VALID_BODY = {
  client_id: 'ext-client-id',
  login: 'streamerjoe',
  user_id: '44322889',
  scopes: ['user:read:email'],
  expires_in: 5000,
};

// ---------------- validateTwitchUserToken ----------------

test('validates a good Twitch token and returns info (user_id == channel)', async () => {
  const info = await validateTwitchUserToken('tw-token', { fetch: fetchOk(VALID_BODY) });
  assert.equal(info.userId, '44322889');
  assert.equal(info.login, 'streamerjoe');
  assert.equal(info.clientId, 'ext-client-id');
  assert.deepEqual(info.scopes, ['user:read:email']);
  assert.equal(info.expiresIn, 5000);
});

test('sends the OAuth (not Bearer) scheme to the validate endpoint', async () => {
  let seenAuth: string | undefined;
  const spyFetch = async (_url: string, init?: { headers?: Record<string, string> }) => {
    seenAuth = init?.headers?.Authorization;
    return { ok: true, status: 200, json: async () => VALID_BODY };
  };
  await validateTwitchUserToken('tw-token', { fetch: spyFetch });
  assert.equal(seenAuth, 'OAuth tw-token');
});

test('rejects a missing token with 401', async () => {
  await assert.rejects(
    validateTwitchUserToken(null, { fetch: fetchOk(VALID_BODY) }),
    (e: unknown) => e instanceof AuthError && e.status === 401,
  );
});

test('rejects an invalid/expired token (Twitch 401) with 401', async () => {
  await assert.rejects(
    validateTwitchUserToken('bad', { fetch: fetchStatus(401) }),
    (e: unknown) => e instanceof AuthError && e.status === 401,
  );
});

test('rejects when Twitch returns no user_id (not a user access token)', async () => {
  await assert.rejects(
    validateTwitchUserToken('app-token', { fetch: fetchOk({ client_id: 'x' }) }),
    (e: unknown) => e instanceof AuthError && e.status === 401 && /user_id/.test((e as Error).message),
  );
});

test('treats a network failure as 401 (never accept an unvalidated token)', async () => {
  const throwingFetch = async () => {
    throw new Error('ECONNRESET');
  };
  await assert.rejects(
    validateTwitchUserToken('tok', { fetch: throwingFetch }),
    (e: unknown) => e instanceof AuthError && e.status === 401,
  );
});

test('client_id check passes when it matches the expected id', async () => {
  const info = await validateTwitchUserToken('tok', {
    fetch: fetchOk(VALID_BODY),
    expectedClientId: 'ext-client-id',
    enforceClientId: true,
  });
  assert.equal(info.userId, '44322889');
});

test('client_id mismatch is rejected with 401 when enforced', async () => {
  await assert.rejects(
    validateTwitchUserToken('tok', {
      fetch: fetchOk(VALID_BODY),
      expectedClientId: 'a-different-client',
      enforceClientId: true,
    }),
    (e: unknown) => e instanceof AuthError && e.status === 401 && /client_id/.test((e as Error).message),
  );
});

test('client_id check is a soft no-op when disabled', async () => {
  const info = await validateTwitchUserToken('tok', {
    fetch: fetchOk(VALID_BODY),
    expectedClientId: 'a-different-client',
    enforceClientId: false,
  });
  assert.equal(info.userId, '44322889');
});

// ---------------- host session JWT round-trip ----------------

test('mint + verify host token round-trips the channel id', () => {
  const minted = mintHostToken('44322889', HOST_SECRET);
  assert.equal(minted.channelId, '44322889');
  assert.ok(minted.hostToken.length > 0);
  assert.ok(minted.expiresAt > Date.now());

  const id = verifyHostToken(minted.hostToken, HOST_SECRET);
  assert.equal(id.channelId, '44322889');
});

test('verifyHostToken rejects a token signed with the wrong secret', () => {
  const minted = mintHostToken('chanA', HOST_SECRET);
  assert.throws(
    () => verifyHostToken(minted.hostToken, 'a-totally-different-secret'),
    (e: unknown) => e instanceof AuthError && e.status === 401,
  );
});

test('verifyHostToken rejects an expired host token with 401', () => {
  const minted = mintHostToken('chanA', HOST_SECRET, -10); // already expired
  assert.throws(
    () => verifyHostToken(minted.hostToken, HOST_SECRET),
    (e: unknown) => e instanceof AuthError && e.status === 401,
  );
});

test('verifyHostToken rejects a missing token with 401', () => {
  assert.throws(
    () => verifyHostToken(null, HOST_SECRET),
    (e: unknown) => e instanceof AuthError && e.status === 401,
  );
});

test('verifyHostToken rejects a non-host-role token with 401', () => {
  // Sign a token with the right secret but the wrong role; verify must reject.
  const forged = jwt.sign({ sub: 'chanA', role: 'viewer' }, HOST_SECRET, { algorithm: 'HS256' });
  assert.throws(
    () => verifyHostToken(forged, HOST_SECRET),
    (e: unknown) => e instanceof AuthError && e.status === 401,
  );
});

test('mint/verify 500 when the host secret is not configured', () => {
  assert.throws(
    () => mintHostToken('chanA', undefined),
    (e: unknown) => e instanceof AuthError && e.status === 500,
  );
  assert.throws(
    () => verifyHostToken('whatever', undefined),
    (e: unknown) => e instanceof AuthError && e.status === 500,
  );
});

test('TTL default is two hours', () => {
  assert.equal(HOST_TOKEN_TTL_SECONDS, 7200);
});
