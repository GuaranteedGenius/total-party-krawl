// ============================================================
// Relay logic — pure functions behind the Vercel endpoints
// ------------------------------------------------------------
// Separated from the HTTP layer so it is unit-testable with a stubbed
// SupabaseClient (no real DB, no real Twitch). These functions do ONLY
// relay + persistence: claim a seat, set a class, record+broadcast a
// move, read the published snapshot. NO HP/damage/turn computation.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { BadRequest } from './http.js';
import { AuthError } from './twitchAuth.js';
import {
  applyHostPublish,
  broadcastMove,
  claimSeat,
  ensureMatch,
  getSeatForUser,
  listMovesForRound,
  listSeats,
  readStateForUser,
  setSeatClass,
  upsertMove,
} from './supabase.js';
import { mintHostToken, validateTwitchUserToken } from './hostAuth.js';
import type {
  ClassId,
  HostIdentity,
  HostPublishBoss,
  HostPublishPayload,
  HostPublishSeat,
  MatchPhase,
  MoveRow,
  SeatRow,
  StateSnapshot,
  ViewerIdentity,
} from './types.js';

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

// ============================================================
// Host (broadcaster) handlers
// ============================================================

// ----- POST /api/host/session -----

export interface HostSessionResult {
  hostToken: string;
  channelId: string;
  expiresAt: number;
}

/**
 * Exchange a validated Twitch *user access token* for a host-session JWT.
 * Ownership = Twitch user_id, which IS the channelId. Ensures the channel's
 * `matches` row exists, then mints the token. The Twitch validation call is
 * injected so this is testable with no network (see hostAuth.validateTwitchUserToken).
 */
export async function handleHostSession(
  db: SupabaseClient,
  twitchUserToken: string | null | undefined,
  deps?: {
    validate?: typeof validateTwitchUserToken;
    mint?: typeof mintHostToken;
  },
): Promise<HostSessionResult> {
  const validate = deps?.validate ?? validateTwitchUserToken;
  const mint = deps?.mint ?? mintHostToken;

  const info = await validate(twitchUserToken);
  const channelId = info.userId;

  await ensureMatch(db, channelId);

  const minted = mint(channelId);
  return {
    hostToken: minted.hostToken,
    channelId: minted.channelId,
    expiresAt: minted.expiresAt,
  };
}

// ----- POST /api/host/publish -----

export interface HostPublishResult {
  ok: true;
  broadcastPrompt: boolean;
}

const VALID_CLASS_OR_NULL = (v: unknown): v is ClassId | null =>
  v === null || (typeof v === 'string' && VALID_CLASSES.has(v as ClassId));

function asFiniteNumber(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new BadRequest(`${field} must be a finite number`);
  }
  return v;
}

function parseBoss(raw: unknown): HostPublishBoss {
  if (typeof raw !== 'object' || raw === null) {
    throw new BadRequest('boss is required');
  }
  const b = raw as Record<string, unknown>;
  if (typeof b.alive !== 'boolean') throw new BadRequest('boss.alive must be a boolean');
  return {
    hp: asFiniteNumber(b.hp, 'boss.hp'),
    maxHp: asFiniteNumber(b.maxHp, 'boss.maxHp'),
    alive: b.alive,
  };
}

function parseSeats(raw: unknown): HostPublishSeat[] {
  if (!Array.isArray(raw)) throw new BadRequest('seats must be an array');
  return raw.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new BadRequest(`seats[${i}] must be an object`);
    }
    const s = entry as Record<string, unknown>;
    const seatIndex = s.seatIndex;
    if (typeof seatIndex !== 'number' || !Number.isInteger(seatIndex) || seatIndex < 0) {
      throw new BadRequest(`seats[${i}].seatIndex must be a non-negative integer`);
    }
    if (typeof s.alive !== 'boolean') throw new BadRequest(`seats[${i}].alive must be a boolean`);
    if (!VALID_CLASS_OR_NULL(s.classId)) {
      throw new BadRequest(`seats[${i}].classId must be a known class or null`);
    }
    return {
      seatIndex,
      hp: asFiniteNumber(s.hp, `seats[${i}].hp`),
      maxHp: asFiniteNumber(s.maxHp, `seats[${i}].maxHp`),
      alive: s.alive,
      classId: s.classId,
    };
  });
}

/**
 * Validate + normalize a host publish body. SHAPE validation only — never a
 * judgement of combat legality. The host token's channel is authoritative; a
 * body that names a DIFFERENT channelId is rejected (cross-channel guard).
 */
export function parseHostPublish(
  body: Record<string, unknown>,
  tokenChannelId: string,
): HostPublishPayload {
  if (body.channelId !== undefined) {
    if (typeof body.channelId !== 'string') {
      throw new BadRequest('channelId must be a string');
    }
    if (body.channelId !== tokenChannelId) {
      // A host token for channel A must not publish to channel B.
      throw new AuthError('Host token channel does not match body channelId', 403);
    }
  }

  const round = body.round;
  if (typeof round !== 'number' || !Number.isInteger(round) || round < 0) {
    throw new BadRequest('round must be a non-negative integer');
  }
  const phase = body.phase;
  if (typeof phase !== 'string' || phase.length === 0) {
    throw new BadRequest('phase is required');
  }

  let endsAtEpochMs: number | null = null;
  if (body.endsAtEpochMs !== undefined && body.endsAtEpochMs !== null) {
    endsAtEpochMs = asFiniteNumber(body.endsAtEpochMs, 'endsAtEpochMs');
  }

  const snapshot =
    body.snapshot === undefined || body.snapshot === null
      ? null
      : (body.snapshot as StateSnapshot);

  return {
    round,
    phase: phase as MatchPhase,
    endsAtEpochMs,
    boss: parseBoss(body.boss),
    seats: parseSeats(body.seats),
    snapshot,
  };
}

/**
 * Persist the client-computed mirrors for the TOKEN'S channel only and relay
 * `state` (+ `prompt` on lockin). NO game logic — stores exactly what the
 * client published.
 */
export async function handleHostPublish(
  db: SupabaseClient,
  host: HostIdentity,
  body: Record<string, unknown>,
): Promise<HostPublishResult> {
  const payload = parseHostPublish(body, host.channelId);
  const { broadcastPrompt } = await applyHostPublish(db, host.channelId, payload);
  return { ok: true, broadcastPrompt };
}

// ----- GET /api/host/moves?round=N -----

export interface HostMovesResult {
  round: number;
  moves: Array<{
    seatIndex: number;
    moveId: string;
    targetId: string;
  }>;
}

/**
 * Secure read of all viewer lock-ins for (token's channel, round). This is the
 * ONLY path that exposes pre-resolution moves, and only to the verified host.
 */
export async function handleHostMoves(
  db: SupabaseClient,
  host: HostIdentity,
  roundRaw: unknown,
): Promise<HostMovesResult> {
  const round = typeof roundRaw === 'string' ? Number(roundRaw) : roundRaw;
  if (typeof round !== 'number' || !Number.isInteger(round) || round < 0) {
    throw new BadRequest('round query param must be a non-negative integer');
  }
  const rows: MoveRow[] = await listMovesForRound(db, host.channelId, round);
  return {
    round,
    moves: rows.map((r) => ({
      seatIndex: r.seat_index,
      moveId: r.move_id,
      targetId: r.target_id,
    })),
  };
}

// ----- GET /api/host/seats -----

export interface HostSeatsResult {
  seats: Array<{
    seatIndex: number;
    opaqueUserId: string;
    classId: ClassId | null;
    hp: number;
    maxHp: number;
    alive: boolean;
  }>;
}

/**
 * Read the current seat roster for the TOKEN'S channel only — who joined and
 * which class they picked — so the game client can build the party. Pure
 * projection of the persisted seat mirrors (service-role read, scoped to the
 * host token's channel, ordered by seatIndex). NO game logic.
 */
export async function handleHostSeats(
  db: SupabaseClient,
  host: HostIdentity,
): Promise<HostSeatsResult> {
  const rows: SeatRow[] = await listSeats(db, host.channelId);
  return {
    seats: rows.map((r) => ({
      seatIndex: r.seat_index,
      opaqueUserId: r.opaque_user_id,
      classId: r.class_id,
      hp: r.hp,
      maxHp: r.max_hp,
      alive: r.alive,
    })),
  };
}
