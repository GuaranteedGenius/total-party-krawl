import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockSupabase } from './mockSupabase.js';
import { BadRequest } from '../http.js';
import {
  handleClass,
  handleJoin,
  handleMove,
  handleState,
} from '../relay.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ViewerIdentity } from '../types.js';

const CH = 'chan-1';

function idFor(opaqueUserId: string): ViewerIdentity {
  return { channelId: CH, opaqueUserId, role: 'viewer' };
}

function seedMatch(): MockSupabase {
  return new MockSupabase({
    matches: [
      {
        channel_id: CH,
        status: 'active',
        current_round: 3,
        phase: 'choosing',
        boss_hp: 80,
        boss_max_hp: 100,
        boss_alive: true,
        ends_at_epoch_ms: 1700000000000,
        snapshot: null,
        updated_at: new Date().toISOString(),
      },
    ],
  });
}

// cast helper: the mock implements the slice of the client our code uses.
const asDb = (m: MockSupabase) => m as unknown as SupabaseClient;

// ---------------- join ----------------

test('join claims seat 0 for the first viewer', async () => {
  const m = seedMatch();
  const res = await handleJoin(asDb(m), idFor('alice'));
  assert.deepEqual(res, { seatIndex: 0, classId: null, alreadySeated: false });
  assert.equal(m.tables.seats.length, 1);
});

test('join is idempotent — returns existing seat', async () => {
  const m = seedMatch();
  const first = await handleJoin(asDb(m), idFor('alice'));
  const again = await handleJoin(asDb(m), idFor('alice'));
  assert.equal(first.seatIndex, again.seatIndex);
  assert.equal(again.alreadySeated, true);
  assert.equal(m.tables.seats.length, 1);
});

test('join assigns the lowest free seat index across viewers', async () => {
  const m = seedMatch();
  const a = await handleJoin(asDb(m), idFor('alice'));
  const b = await handleJoin(asDb(m), idFor('bob'));
  assert.equal(a.seatIndex, 0);
  assert.equal(b.seatIndex, 1);
});

test('join rejects when all 10 seats are full', async () => {
  const m = seedMatch();
  for (let i = 0; i < 10; i++) {
    await handleJoin(asDb(m), idFor(`u${i}`));
  }
  await assert.rejects(handleJoin(asDb(m), idFor('overflow')), /full/i);
});

// ---------------- class ----------------

test('class sets a valid class on the seat', async () => {
  const m = seedMatch();
  await handleJoin(asDb(m), idFor('alice'));
  const res = await handleClass(asDb(m), idFor('alice'), { classId: 'class.mage' });
  assert.deepEqual(res, { ok: true, classId: 'class.mage' });
  assert.equal(m.tables.seats[0].class_id, 'class.mage');
});

test('class rejects an unknown classId', async () => {
  const m = seedMatch();
  await handleJoin(asDb(m), idFor('alice'));
  await assert.rejects(
    handleClass(asDb(m), idFor('alice'), { classId: 'class.ninja' }),
    BadRequest,
  );
});

test('class rejects when the caller has no seat', async () => {
  const m = seedMatch();
  await assert.rejects(
    handleClass(asDb(m), idFor('nobody'), { classId: 'class.tank' }),
    /No seat/,
  );
});

// ---------------- move ----------------

test('move records the lock-in and broadcasts it', async () => {
  const m = seedMatch();
  await handleJoin(asDb(m), idFor('alice'));
  const res = await handleMove(asDb(m), idFor('alice'), {
    round: 3,
    moveId: 'mage.fireball',
    targetId: 'boss',
  });
  assert.deepEqual(res, { ok: true });

  // persisted
  assert.equal(m.tables.moves.length, 1);
  assert.equal(m.tables.moves[0].move_id, 'mage.fireball');

  // relayed on the right channel + event + payload
  assert.equal(m.broadcasts.length, 1);
  const b = m.broadcasts[0];
  assert.equal(b.channelName, `match:${CH}`);
  assert.equal(b.event, 'move');
  assert.deepEqual(b.payload, {
    seatIndex: 0,
    round: 3,
    moveId: 'mage.fireball',
    targetId: 'boss',
  });
  // channel cleaned up after send
  assert.deepEqual(m.removedChannels, [`match:${CH}`]);
});

test('re-submitting the same round overwrites (upsert), not duplicates', async () => {
  const m = seedMatch();
  await handleJoin(asDb(m), idFor('alice'));
  await handleMove(asDb(m), idFor('alice'), { round: 3, moveId: 'mage.fireball', targetId: 'boss' });
  await handleMove(asDb(m), idFor('alice'), { round: 3, moveId: 'healer.heal', targetId: 'seat.0' });
  assert.equal(m.tables.moves.length, 1);
  assert.equal(m.tables.moves[0].move_id, 'healer.heal');
  assert.equal(m.tables.moves[0].target_id, 'seat.0');
});

test('move validation: bad round / missing fields', async () => {
  const m = seedMatch();
  await handleJoin(asDb(m), idFor('alice'));
  await assert.rejects(handleMove(asDb(m), idFor('alice'), { round: -1, moveId: 'x', targetId: 'boss' }), BadRequest);
  await assert.rejects(handleMove(asDb(m), idFor('alice'), { round: 1.5, moveId: 'x', targetId: 'boss' }), BadRequest);
  await assert.rejects(handleMove(asDb(m), idFor('alice'), { round: 1, moveId: '', targetId: 'boss' }), BadRequest);
  await assert.rejects(handleMove(asDb(m), idFor('alice'), { round: 1, moveId: 'x', targetId: '' }), BadRequest);
  // nothing persisted or broadcast on validation failure
  assert.equal(m.tables.moves.length, 0);
  assert.equal(m.broadcasts.length, 0);
});

test('move rejects when the caller has no seat', async () => {
  const m = seedMatch();
  await assert.rejects(
    handleMove(asDb(m), idFor('nobody'), { round: 1, moveId: 'x', targetId: 'boss' }),
    /No seat/,
  );
});

// ---------------- state ----------------

test('state projects the caller seat, others, boss mirror, and locked move', async () => {
  const m = seedMatch();
  await handleJoin(asDb(m), idFor('alice'));
  await handleJoin(asDb(m), idFor('bob'));
  await handleClass(asDb(m), idFor('alice'), { classId: 'class.tank' });
  await handleMove(asDb(m), idFor('alice'), { round: 3, moveId: 'tank.taunt', targetId: 'boss' });

  const snap = await handleState(asDb(m), idFor('alice'));
  assert.equal(snap.matchPhase, 'choosing');
  assert.equal(snap.round, 3);
  assert.equal(snap.endsAtEpochMs, 1700000000000);
  assert.equal(snap.boss.hp, 80);
  assert.equal(snap.boss.maxHp, 100);
  assert.equal(snap.seats.length, 2);

  assert.ok(snap.you);
  assert.equal(snap.you!.seatIndex, 0);
  assert.equal(snap.you!.classId, 'class.tank');
  assert.deepEqual(snap.you!.lockedMove, { moveId: 'tank.taunt', targetId: 'boss' });
});

test('state for a viewer with no seat returns you=null but still channel state', async () => {
  const m = seedMatch();
  await handleJoin(asDb(m), idFor('alice'));
  const snap = await handleState(asDb(m), idFor('spectator'));
  assert.equal(snap.you, null);
  assert.equal(snap.seats.length, 1);
  assert.equal(snap.boss.maxHp, 100);
});

test('state with no match row falls back to lobby defaults', async () => {
  const m = new MockSupabase(); // no match seeded
  const snap = await handleState(asDb(m), idFor('alice'));
  assert.equal(snap.matchPhase, 'lobby');
  assert.equal(snap.round, 0);
  assert.equal(snap.you, null);
  assert.deepEqual(snap.seats, []);
});

test('state prefers a published snapshot but overlays the caller view', async () => {
  const m = seedMatch();
  // simulate the game client having published a full snapshot
  m.tables.matches[0].snapshot = {
    matchPhase: 'resolving',
    round: 3,
    endsAtEpochMs: null,
    you: null,
    boss: { hp: 10, maxHp: 100, alive: true },
    seats: [{ seatIndex: 0, classId: 'class.tank', hp: 50, maxHp: 50, alive: true }],
  };
  await handleJoin(asDb(m), idFor('alice'));
  await handleMove(asDb(m), idFor('alice'), { round: 3, moveId: 'tank.taunt', targetId: 'boss' });

  const snap = await handleState(asDb(m), idFor('alice'));
  assert.equal(snap.matchPhase, 'resolving'); // from published snapshot
  assert.equal(snap.boss.hp, 10); // from published snapshot
  assert.ok(snap.you); // overlaid from caller's seat
  assert.deepEqual(snap.you!.lockedMove, { moveId: 'tank.taunt', targetId: 'boss' });
});
