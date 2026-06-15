import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireHost } from '../http.ts';
import { mintHostToken } from '../hostAuth.ts';

const HOST_SECRET = 'host-http-test-secret-0123456789';

// Minimal req/res doubles for the handler glue.
function mkReq(headers: Record<string, string | string[] | undefined>): VercelRequest {
  return { headers, method: 'POST', query: {} } as unknown as VercelRequest;
}
function mkRes() {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
    end() {
      return this;
    },
  } as unknown as VercelResponse;
  return { res, captured };
}

test('requireHost returns the host identity for a valid Bearer host token', () => {
  process.env.HOST_SESSION_SECRET = HOST_SECRET;
  const { hostToken } = mintHostToken('chanA', HOST_SECRET);
  const { res, captured } = mkRes();
  const id = requireHost(mkReq({ authorization: `Bearer ${hostToken}` }), res);
  assert.ok(id);
  assert.equal(id!.channelId, 'chanA');
  assert.equal(captured.status, undefined); // no error written
});

test('requireHost responds 401 when no token is present', () => {
  process.env.HOST_SESSION_SECRET = HOST_SECRET;
  const { res, captured } = mkRes();
  const id = requireHost(mkReq({}), res);
  assert.equal(id, null);
  assert.equal(captured.status, 401);
});

test('requireHost responds 401 for a viewer JWT (wrong/foreign signature)', () => {
  process.env.HOST_SESSION_SECRET = HOST_SECRET;
  const { res, captured } = mkRes();
  // A token signed with a different secret should not authenticate as host.
  const foreign = mintHostToken('chanA', 'some-other-secret').hostToken;
  const id = requireHost(mkReq({ authorization: `Bearer ${foreign}` }), res);
  assert.equal(id, null);
  assert.equal(captured.status, 401);
});
