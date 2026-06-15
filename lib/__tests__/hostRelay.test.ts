import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockSupabase } from './mockSupabase.js';
import { BadRequest } from '../http.js';
import { AuthError } from '../hostAuth.js';
import {
  handleHostMoves,
  handleHostPublish,
  handleHostSession,
  parseHostPublish,
} from '../relay.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { HostIdentity, HostPublishPayload } from '../types.js';

const CH = 'chanA';
const asDb = (m: MockSupabase) => m as unknown as SupabaseClient;
const host = (channelId = CH): HostIdentity => ({ channelId });

function publishBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    round: 2,
    phase: 'lockin',
    endsAtEpochMs: 1700000000000,
    boss: { hp: 90, maxHp: 100, alive: true },
    seats: [{ seatIndex: 0, hp: 40, maxHp: 50, alive: true, classId: 'class.tank' }],
    ...over,
  };
}

function seededMatch(): MockSupabase {
  return new MockSupabase({
    matches: [
      {
        channel_id: CH,
        status: 'active',
        current_round: 0,
        phase: 'lobby',
        boss_hp: 0,
        boss_max_hp: 0,
        boss_alive: true,
        ends_at_epoch_ms: null,
        snapshot: null,
        updated_at: new Date().toISOString(),
      },
    ],
    // a seat the host can mirror onto (created earlier by a viewer /api/join)
    seats: [
      {
        channel_id: CH,
        seat_index: 0,
        opaque_user_id: 'alice',
        class_id: null,
        hp: 0,
        max_hp: 0,
        alive: true,
        joined_at: new Date().toISOString(),
      },
    ],
  });
}

// ---------------- session ----------------

test('host session: valid Twitch token mints a host token + ensures match row', async () => {
  const m = new MockSupabase(); // no match yet
  const res = await handleHostSession(asDb(m), 'tw-token', {
    validate: async () => ({
      userId: '44322889',
      login: 'joe',
      clientId: 'c',
      scopes: [],
      expiresIn: 1000,
    }),
    mint: (channelId) => ({ hostToken: `HT-${channelId}`, channelId, expiresAt: 999 }),
  });
  assert.equal(res.channelId, '44322889');
  assert.equal(res.hostToken, 'HT-44322889');
  // match row created for the derived channel
  assert.equal(m.tables.matches.length, 1);
  assert.equal(m.tables.matches[0].channel_id, '44322889');
});

test('host session: invalid Twitch token -> 401, no match created', async () => {
  const m = new MockSupabase();
  await assert.rejects(
    handleHostSession(asDb(m), 'bad', {
      validate: async () => {
        throw new AuthError('Twitch token invalid or expired', 401);
      },
    }),
    (e: unknown) => e instanceof AuthError && e.status === 401,
  );
  assert.equal(m.tables.matches.length, 0);
});

test('host session: ensureMatch is idempotent for an existing channel', async () => {
  const m = seededMatch();
  await handleHostSession(asDb(m), 'tw', {
    validate: async () => ({ userId: CH, login: '', clientId: '', scopes: [], expiresIn: 1 }),
    mint: (c) => ({ hostToken: 'HT', channelId: c, expiresAt: 1 }),
  });
  assert.equal(m.tables.matches.length, 1); // not duplicated
});

// ---------------- publish ----------------

test('publish writes match + seat mirrors and broadcasts state + prompt on lockin', async () => {
  const m = seededMatch();
  const res = await handleHostPublish(asDb(m), host(), publishBody());
  assert.deepEqual(res, { ok: true, broadcastPrompt: true });

  // match mirror updated (client-pushed values, verbatim)
  const match = m.tables.matches[0];
  assert.equal(match.current_round, 2);
  assert.equal(match.phase, 'lockin');
  assert.equal(match.boss_hp, 90);
  assert.equal(match.boss_max_hp, 100);
  assert.equal(match.ends_at_epoch_ms, 1700000000000);

  // seat mirror updated onto the existing seat (HP/class), opaque_user_id preserved
  const seat = m.tables.seats[0];
  assert.equal(seat.hp, 40);
  assert.equal(seat.max_hp, 50);
  assert.equal(seat.class_id, 'class.tank');
  assert.equal(seat.opaque_user_id, 'alice'); // host never overwrites viewer identity

  // broadcasts: a `state` and a `prompt` on the channel
  const events = m.broadcasts.map((b) => b.event);
  assert.deepEqual(events.sort(), ['prompt', 'state']);
  for (const b of m.broadcasts) assert.equal(b.channelName, `match:${CH}`);
  const prompt = m.broadcasts.find((b) => b.event === 'prompt');
  assert.deepEqual(prompt!.payload, { round: 2, endsAtEpochMs: 1700000000000 });
});

test('publish in a non-lockin phase broadcasts state but NOT prompt', async () => {
  const m = seededMatch();
  const res = await handleHostPublish(asDb(m), host(), publishBody({ phase: 'resolving' }));
  assert.equal(res.broadcastPrompt, false);
  const events = m.broadcasts.map((b) => b.event);
  assert.deepEqual(events, ['state']);
});

test('publish broadcasts the supplied snapshot when present (and never leaks moves)', async () => {
  const m = seededMatch();
  const snapshot = {
    matchPhase: 'lockin',
    round: 2,
    endsAtEpochMs: null,
    you: null,
    boss: { hp: 90, maxHp: 100, alive: true },
    seats: [{ seatIndex: 0, classId: 'class.tank', hp: 40, maxHp: 50, alive: true }],
  };
  await handleHostPublish(asDb(m), host(), publishBody({ snapshot }));
  const state = m.broadcasts.find((b) => b.event === 'state');
  assert.deepEqual(state!.payload, snapshot);
  // no broadcast event ever carries lock-in move data
  for (const b of m.broadcasts) {
    assert.equal(JSON.stringify(b.payload).includes('moveId'), false);
  }
});

test('publish validation rejects a bad body (BadRequest), writes nothing', async () => {
  const m = seededMatch();
  await assert.rejects(handleHostPublish(asDb(m), host(), publishBody({ round: -1 })), BadRequest);
  await assert.rejects(handleHostPublish(asDb(m), host(), publishBody({ boss: null })), BadRequest);
  await assert.rejects(handleHostPublish(asDb(m), host(), publishBody({ seats: 'nope' })), BadRequest);
  await assert.rejects(
    handleHostPublish(asDb(m), host(), publishBody({ seats: [{ seatIndex: 0, hp: 1, maxHp: 1, alive: true, classId: 'class.ninja' }] })),
    BadRequest,
  );
  assert.equal(m.broadcasts.length, 0);
});

// ---------------- cross-channel guard ----------------

test('a host token for channel A cannot publish to channel B (403)', () => {
  assert.throws(
    () => parseHostPublish(publishBody({ channelId: 'chanB' }), 'chanA'),
    (e: unknown) => e instanceof AuthError && e.status === 403,
  );
});

test('publish accepts a body channelId that matches the token channel', () => {
  const payload: HostPublishPayload = parseHostPublish(publishBody({ channelId: 'chanA' }), 'chanA');
  assert.equal(payload.round, 2);
});

test('handleHostPublish writes ONLY to the token channel, not another channel', async () => {
  // Seed two channels; host token is for CH. Publish must not touch chanB.
  const m = seededMatch();
  m.tables.matches.push({
    channel_id: 'chanB',
    status: 'active',
    current_round: 5,
    phase: 'lobby',
    boss_hp: 1,
    boss_max_hp: 1,
    boss_alive: true,
    ends_at_epoch_ms: null,
    snapshot: null,
    updated_at: new Date().toISOString(),
  });
  await handleHostPublish(asDb(m), host('chanA'), publishBody());
  const b = m.tables.matches.find((r) => r.channel_id === 'chanB');
  assert.equal(b!.current_round, 5); // untouched
  for (const ev of m.broadcasts) assert.equal(ev.channelName, 'match:chanA');
});

// ---------------- moves (secure read) ----------------

function seededMoves(): MockSupabase {
  const m = seededMatch();
  m.tables.moves = [
    { channel_id: CH, round: 2, seat_index: 0, move_id: 'tank.taunt', target_id: 'boss', created_at: '' },
    { channel_id: CH, round: 2, seat_index: 1, move_id: 'mage.fireball', target_id: 'boss', created_at: '' },
    { channel_id: CH, round: 3, seat_index: 0, move_id: 'basic.attack', target_id: 'boss', created_at: '' },
    // a DIFFERENT channel's move must never leak
    { channel_id: 'chanB', round: 2, seat_index: 0, move_id: 'secret', target_id: 'boss', created_at: '' },
  ];
  return m;
}

test('host moves returns all lock-ins for the round, scoped to the token channel', async () => {
  const m = seededMoves();
  const res = await handleHostMoves(asDb(m), host(CH), '2');
  assert.equal(res.round, 2);
  assert.equal(res.moves.length, 2);
  assert.deepEqual(
    res.moves.map((x) => x.moveId).sort(),
    ['mage.fireball', 'tank.taunt'],
  );
  // chanB's move did not leak
  assert.equal(res.moves.find((x) => x.moveId === 'secret'), undefined);
});

test('host moves only returns the requested round', async () => {
  const m = seededMoves();
  const res = await handleHostMoves(asDb(m), host(CH), 3);
  assert.equal(res.moves.length, 1);
  assert.equal(res.moves[0].moveId, 'basic.attack');
});

test('host moves rejects a bad round param', async () => {
  const m = seededMoves();
  await assert.rejects(handleHostMoves(asDb(m), host(CH), 'abc'), BadRequest);
  await assert.rejects(handleHostMoves(asDb(m), host(CH), -1), BadRequest);
});
