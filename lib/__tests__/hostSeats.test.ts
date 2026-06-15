import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { MockSupabase } from './mockSupabase.js';
import { requireHost } from '../http.js';
import { mintHostToken } from '../hostAuth.js';
import { handleHostSeats } from '../relay.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { HostIdentity } from '../types.js';

const CH = 'chanA';
const HOST_SECRET = 'host-seats-test-secret-0123456789';
const asDb = (m: MockSupabase) => m as unknown as SupabaseClient;
const host = (channelId = CH): HostIdentity => ({ channelId });

function seat(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channel_id: CH,
    seat_index: 0,
    opaque_user_id: 'alice',
    class_id: 'class.tank',
    hp: 40,
    max_hp: 50,
    alive: true,
    joined_at: new Date().toISOString(),
    ...over,
  };
}

function seededSeats(): MockSupabase {
  return new MockSupabase({
    seats: [
      // Seeded out of order to prove the handler orders by seatIndex.
      seat({ seat_index: 1, opaque_user_id: 'bob', class_id: 'class.mage', hp: 30, max_hp: 30, alive: false }),
      seat({ seat_index: 0, opaque_user_id: 'alice', class_id: 'class.tank' }),
      // A DIFFERENT channel's seat must never leak.
      seat({ channel_id: 'chanB', seat_index: 0, opaque_user_id: 'mallory', class_id: 'class.healer' }),
    ],
  });
}

// Minimal req/res doubles for the auth glue (mirrors hostHttp.test.ts).
function mkReq(headers: Record<string, string | string[] | undefined>): VercelRequest {
  return { headers, method: 'GET', query: {} } as unknown as VercelRequest;
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

test('host seats: returns the channel roster, ordered by seatIndex, mapped to camelCase', async () => {
  const m = seededSeats();
  const res = await handleHostSeats(asDb(m), host(CH));
  assert.equal(res.seats.length, 2); // chanB's seat excluded
  assert.deepEqual(
    res.seats.map((s) => s.seatIndex),
    [0, 1],
  );
  assert.deepEqual(res.seats[0], {
    seatIndex: 0,
    opaqueUserId: 'alice',
    classId: 'class.tank',
    hp: 40,
    maxHp: 50,
    alive: true,
  });
  assert.deepEqual(res.seats[1], {
    seatIndex: 1,
    opaqueUserId: 'bob',
    classId: 'class.mage',
    hp: 30,
    maxHp: 30,
    alive: false,
  });
});

test('host seats: empty roster returns an empty array', async () => {
  const m = new MockSupabase();
  const res = await handleHostSeats(asDb(m), host(CH));
  assert.deepEqual(res.seats, []);
});

test('host seats: a host token for channel A cannot read channel B seats', async () => {
  const m = seededSeats();
  // Token scoped to chanB; only the lone chanB seat (mallory) should return.
  const res = await handleHostSeats(asDb(m), host('chanB'));
  assert.equal(res.seats.length, 1);
  assert.equal(res.seats[0].opaqueUserId, 'mallory');
  // chanA's seats did not leak.
  assert.equal(res.seats.find((s) => s.opaqueUserId === 'alice'), undefined);
});

// ---------------- auth gate (mirrors the thin handler's requireHost path) ----------------

test('host seats: a valid Bearer host token authenticates and is channel-scoped', () => {
  process.env.HOST_SESSION_SECRET = HOST_SECRET;
  const { hostToken } = mintHostToken('chanA', HOST_SECRET);
  const { res, captured } = mkRes();
  const id = requireHost(mkReq({ authorization: `Bearer ${hostToken}` }), res);
  assert.ok(id);
  assert.equal(id!.channelId, 'chanA');
  assert.equal(captured.status, undefined); // no error written
});

test('host seats: responds 401 when no token is present', () => {
  process.env.HOST_SESSION_SECRET = HOST_SECRET;
  const { res, captured } = mkRes();
  const id = requireHost(mkReq({}), res);
  assert.equal(id, null);
  assert.equal(captured.status, 401);
});
