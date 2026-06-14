// ============================================================
// Relay logic — pure functions behind the Vercel endpoints
// ------------------------------------------------------------
// Separated from the HTTP layer so it is unit-testable with a stubbed
// SupabaseClient (no real DB, no real Twitch). These functions do ONLY
// relay + persistence: claim a seat, set a class, record+broadcast a
// move, read the published snapshot. NO HP/damage/turn computation.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { BadRequest } from './http.ts';
import {
  broadcastMove,
  claimSeat,
  getSeatForUser,
  readStateForUser,
  setSeatClass,
  upsertMove,
} from './supabase.ts';
import type { ClassId, StateSnapshot, ViewerIdentity } from './types.ts';

const VALID_CLASSES: ReadonlySet<ClassId> = new Set<ClassId>([
  'class.tank',
  'class.mage',
  'class.healer',
]);

// ----- /api/join -----

export interface JoinResult {
  seatIndex: number;
  classId: ClassId | null;
  alreadySeated: boolean;
}

/** Claim/return the caller's seat for the channel. Idempotent. */
export async function handleJoin(
  db: SupabaseClient,
  id: ViewerIdentity,
): Promise<JoinResult> {
  const existing = await getSeatForUser(db, id.channelId, id.opaqueUserId);
  if (existing) {
    return {
      seatIndex: existing.seat_index,
      classId: existing.class_id,
      alreadySeated: true,
    };
  }
  const seat = await claimSeat(db, id.channelId, id.opaqueUserId);
  return { seatIndex: seat.seat_index, classId: seat.class_id, alreadySeated: false };
}

// ----- /api/class -----

export interface ClassResult {
  ok: true;
  classId: ClassId;
}

/** Set the caller's class. Requires the caller to already hold a seat. */
export async function handleClass(
  db: SupabaseClient,
  id: ViewerIdentity,
  body: Record<string, unknown>,
): Promise<ClassResult> {
  const classId = body.classId;
  if (typeof classId !== 'string' || !VALID_CLASSES.has(classId as ClassId)) {
    throw new BadRequest(
      `Invalid classId; expected one of ${[...VALID_CLASSES].join(', ')}`,
    );
  }
  const seat = await getSeatForUser(db, id.channelId, id.opaqueUserId);
  if (!seat) {
    throw new BadRequest('No seat claimed; call /api/join first');
  }
  await setSeatClass(db, id.channelId, id.opaqueUserId, classId as ClassId);
  return { ok: true, classId: classId as ClassId };
}

// ----- /api/move -----

export interface MoveResult {
  ok: true;
}

/**
 * Record the caller's lock-in for `round` and relay it to the game client.
 * Re-submitting the same round overwrites (upsert). The server does NOT
 * validate move legality or resolve anything — the game engine owns that.
 */
export async function handleMove(
  db: SupabaseClient,
  id: ViewerIdentity,
  body: Record<string, unknown>,
): Promise<MoveResult> {
  const round = body.round;
  const moveId = body.moveId;
  const targetId = body.targetId;

  if (typeof round !== 'number' || !Number.isInteger(round) || round < 0) {
    throw new BadRequest('round must be a non-negative integer');
  }
  if (typeof moveId !== 'string' || moveId.length === 0) {
    throw new BadRequest('moveId is required');
  }
  if (typeof targetId !== 'string' || targetId.length === 0) {
    throw new BadRequest('targetId is required');
  }

  const seat = await getSeatForUser(db, id.channelId, id.opaqueUserId);
  if (!seat) {
    throw new BadRequest('No seat claimed; call /api/join first');
  }

  await upsertMove(db, {
    channel_id: id.channelId,
    round,
    seat_index: seat.seat_index,
    move_id: moveId,
    target_id: targetId,
  });

  await broadcastMove(db, id.channelId, {
    seatIndex: seat.seat_index,
    round,
    moveId,
    targetId,
  });

  return { ok: true };
}

// ----- /api/state -----

/** Read the caller-relevant snapshot (pure projection of stored mirrors). */
export async function handleState(
  db: SupabaseClient,
  id: ViewerIdentity,
): Promise<StateSnapshot> {
  return readStateForUser(db, id.channelId, id.opaqueUserId);
}
