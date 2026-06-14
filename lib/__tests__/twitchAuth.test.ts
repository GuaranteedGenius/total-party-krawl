import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  AuthError,
  authenticate,
  extractToken,
  verifyExtensionJwt,
} from '../twitchAuth.ts';

// Twitch stores the extension secret base64-encoded; it signs HS256 with the
// DECODED bytes. Mirror that exactly here.
const RAW_SECRET = Buffer.from('super-secret-bytes-for-tpk-tests-0123456789');
const BASE64_SECRET = RAW_SECRET.toString('base64');

function sign(claims: Record<string, unknown>, expiresIn = '1h'): string {
  const opts = { algorithm: 'HS256', expiresIn } as jwt.SignOptions;
  return jwt.sign(claims, RAW_SECRET, opts);
}

const baseClaims = {
  channel_id: '12345',
  opaque_user_id: 'U-abcdef',
  role: 'viewer',
};

test('verifies a valid token and returns identity', () => {
  const token = sign({ ...baseClaims, user_id: '99' });
  const id = verifyExtensionJwt(token, BASE64_SECRET);
  assert.equal(id.channelId, '12345');
  assert.equal(id.opaqueUserId, 'U-abcdef');
  assert.equal(id.userId, '99');
  assert.equal(id.role, 'viewer');
});

test('userId is undefined when the viewer did not share identity', () => {
  const id = verifyExtensionJwt(sign(baseClaims), BASE64_SECRET);
  assert.equal(id.userId, undefined);
});

test('rejects an expired token with 401', () => {
  const token = sign(baseClaims, '-10s'); // already expired
  assert.throws(
    () => verifyExtensionJwt(token, BASE64_SECRET),
    (e: unknown) => e instanceof AuthError && e.status === 401 && /expired|Invalid/i.test((e as Error).message),
  );
});

test('rejects a token signed with the wrong key (bad signature)', () => {
  const token = jwt.sign(baseClaims, Buffer.from('a-totally-different-key'), {
    algorithm: 'HS256',
  });
  assert.throws(
    () => verifyExtensionJwt(token, BASE64_SECRET),
    (e: unknown) => e instanceof AuthError && e.status === 401,
  );
});

test('rejects when required claims are missing', () => {
  const token = sign({ channel_id: '1' }); // no opaque_user_id / role
  assert.throws(
    () => verifyExtensionJwt(token, BASE64_SECRET),
    (e: unknown) => e instanceof AuthError && /missing required claims/.test((e as Error).message),
  );
});

test('rejects a missing token with 401', () => {
  assert.throws(
    () => verifyExtensionJwt(null, BASE64_SECRET),
    (e: unknown) => e instanceof AuthError && e.status === 401,
  );
});

test('500 when the server secret is not configured', () => {
  assert.throws(
    () => verifyExtensionJwt(sign(baseClaims), undefined),
    (e: unknown) => e instanceof AuthError && e.status === 500,
  );
});

test('rejects an unsigned (alg=none) token', () => {
  // Attacker-style token with no signature; must not be accepted.
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(baseClaims)).toString('base64url');
  const token = `${header}.${payload}.`;
  assert.throws(
    () => verifyExtensionJwt(token, BASE64_SECRET),
    (e: unknown) => e instanceof AuthError && e.status === 401,
  );
});

// ---- header extraction ----

test('extractToken reads Authorization: Bearer (case-insensitive)', () => {
  assert.equal(extractToken({ authorization: 'Bearer abc.def.ghi' }), 'abc.def.ghi');
  assert.equal(extractToken({ Authorization: 'bearer xyz' }), 'xyz');
});

test('extractToken reads X-Extension-JWT fallback', () => {
  assert.equal(extractToken({ 'x-extension-jwt': 'tok123' }), 'tok123');
});

test('extractToken handles array-valued headers and missing headers', () => {
  assert.equal(extractToken({ authorization: ['Bearer arr'] as string[] }), 'arr');
  assert.equal(extractToken({}), null);
});

test('authenticate() composes extract + verify from headers', () => {
  const token = sign(baseClaims);
  const id = authenticate({ authorization: `Bearer ${token}` }, BASE64_SECRET);
  assert.equal(id.channelId, '12345');
});
