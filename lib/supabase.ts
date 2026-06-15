// ============================================================
// Supabase service-role client + typed row helpers
// ------------------------------------------------------------
// THIN RELAY + PERSISTENCE. This module:
//   - builds the service-role client (server-side only, bypasses RLS)
//   - exposes small typed helpers for the per-viewer seat model
//   - publishes Realtime broadcasts on `match:<channelId>`
//
// It contains NO game logic. HP/alive/round are mirrors the Godot
// client pushes; nothing here computes combat outcomes.
//
// Testability: every helper takes a `SupabaseClient` argument so unit
// tests can inject a stub. `getSupabase()` is only used by the actual
// Vercel handlers at runtime.
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  ClassId,
  HostPublishPayload,
  MatchPhase,
  MatchRow,
  MoveRow,
  RealtimeMoveEvent,
  RealtimePromptEvent,
  SeatRow,
  StateSnapshot,
} from './types.js';

export const MAX_SEATS = 10;

let _client: SupabaseClient | null = null;

/**
 * Get the cached service-role Supabase client.
 * Reads SUPABASE_URL + SUPABASE_SECRET_KEY from env. Throws if unset —
 * a relay endpoint cannot function without persistence, so fail loud.
 */
export function getSupabase(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase not configured: set SUPABASE_URL and SUPABASE_SECRET_KEY',
    );
  }

  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return _client;
}

/** Test seam: reset the memoized client (used by unit tests). */
export function __resetSupabaseForTests(): void {
  _client = null;
}

// ------------------------------------------------------------
// Match
// ------------------------------------------------------------

/** Read the match row for a channel (the persisted mirror), or null if none. */
export async function getMatch(
  db: SupabaseClient,
  channelId: string,
): Promise<MatchRow | null> {
  const { data, error } = await db
    .from('matches')
    .select('*')
    .eq('channel_id', channelId)
    .maybeSingle();
  if (error) throw new Error(`getMatch: ${error.message}`);
  return (data as MatchRow | null) ?? null;
}

/**
 * Ensure a `matches` row exists for the channel (the host "owns" their channel
 * row). Idempotent: inserts a default row if absent, otherwise leaves it alone.
 * Defaults only — no combat values are computed here.
 */
export async function ensureMatch(
  db: SupabaseClient,
  channelId: string,
): Promise<void> {
  const existing = await getMatch(db, channelId);
  if (existing) return;
  const { error } = await db
    .from('matches')
    .insert({ channel_id: channelId, status: 'active' });
  if (error) throw new Error(`ensureMatch: ${error.message}`);
}

/**
 * Write the authoritative match-level mirrors the game client published.
 * Everything here is client-computed; the relay stores it verbatim.
 */
export async function writeMatchMirror(
  db: SupabaseClient,
  channelId: string,
  m: {
    round: number;
    phase: MatchPhase;
    endsAtEpochMs: number | null;
    bossHp: number;
    bossMaxHp: number;
    bossAlive: boolean;
    snapshot: StateSnapshot | null;
  },
): Promise<void> {
  const { error } = await db
    .from('matches')
    .update({
      current_round: m.round,
      phase: m.phase,
      ends_at_epoch_ms: m.endsAtEpochMs,
      boss_hp: m.bossHp,
      boss_max_hp: m.bossMaxHp,
      boss_alive: m.bossAlive,
      snapshot: m.snapshot,
      updated_at: new Date().toISOString(),
    })
    .eq('channel_id', channelId);
  if (error) throw new Error(`writeMatchMirror: ${error.message}`);
}

/**
 * Write the per-seat HP/alive/class mirrors the client published. Upserts on
 * (channel_id, seat_index) so existing seats update without clobbering the
 * viewer's opaque_user_id (which the client does not know and must not set).
 */
export async function writeSeatMirror(
  db: SupabaseClient,
  channelId: string,
  seatIndex: number,
  s: { hp: number; maxHp: number; alive: boolean; classId: ClassId | null },
): Promise<void> {
  const { error } = await db
    .from('seats')
    .update({
      hp: s.hp,
      max_hp: s.maxHp,
      alive: s.alive,
      class_id: s.classId,
    })
    .eq('channel_id', channelId)
    .eq('seat_index', seatIndex);
  if (error) throw new Error(`writeSeatMirror: ${error.message}`);
}

// ------------------------------------------------------------
// Seats
// ------------------------------------------------------------

/** All seats for a channel, ordered by seat_index. */
export async function listSeats(
  db: SupabaseClient,
  channelId: string,
): Promise<SeatRow[]> {
  const { data, error } = await db
    .from('seats')
    .select('*')
    .eq('channel_id', channelId)
    .order('seat_index', { ascending: true });
  if (error) throw new Error(`listSeats: ${error.message}`);
  return (data as SeatRow[]) ?? [];
}

/** Find the caller's existing seat for a channel, or null. */
export async function getSeatForUser(
  db: SupabaseClient,
  channelId: string,
  opaqueUserId: string,
): Promise<SeatRow | null> {
  const { data, error } = await db
    .from('seats')
    .select('*')
    .eq('channel_id', channelId)
    .eq('opaque_user_id', opaqueUserId)
    .maybeSingle();
  if (error) throw new Error(`getSeatForUser: ${error.message}`);
  return (data as SeatRow | null) ?? null;
}

/**
 * Claim the lowest free seat index (0..MAX_SEATS-1) for a user.
 * Relay-only: we pick a slot and write the row. We do NOT seed HP — the
 * game client owns and pushes HP/alive when it sets up the combatant.
 *
 * Returns the claimed seat. Throws { full: true } message if no seat free.
 * Note: a partial-unique race (two users grabbing the same index) is caught
 * by the DB unique(channel_id, seat_index) and surfaced as an error the
 * handler can retry; for alpha's 1-10 viewers contention is negligible.
 */
export async function claimSeat(
  db: SupabaseClient,
  channelId: string,
  opaqueUserId: string,
): Promise<SeatRow> {
  const seats = await listSeats(db, channelId);
  const taken = new Set(seats.map((s) => s.seat_index));
  let idx = -1;
  for (let i = 0; i < MAX_SEATS; i++) {
    if (!taken.has(i)) {
      idx = i;
      break;
    }
  }
  if (idx === -1) {
    throw new Error('No free seats (match is full)');
  }

  const { data, error } = await db
    .from('seats')
    .insert({
      channel_id: channelId,
      seat_index: idx,
      opaque_user_id: opaqueUserId,
      class_id: null,
    })
    .select('*')
    .single();
  if (error) throw new Error(`claimSeat: ${error.message}`);
  return data as SeatRow;
}

/** Set the class on the caller's seat. */
export async function setSeatClass(
  db: SupabaseClient,
  channelId: string,
  opaqueUserId: string,
  classId: ClassId,
): Promise<void> {
  const { error } = await db
    .from('seats')
    .update({ class_id: classId })
    .eq('channel_id', channelId)
    .eq('opaque_user_id', opaqueUserId);
  if (error) throw new Error(`setSeatClass: ${error.message}`);
}

// ------------------------------------------------------------
// Moves
// ------------------------------------------------------------

/**
 * Upsert the caller's move for (channel, round, seat). Re-submitting the
 * same round overwrites (conflict on the unique key). Persistence only —
 * the relay broadcast is a separate call (see broadcastMove).
 */
export async function upsertMove(
  db: SupabaseClient,
  move: Pick<MoveRow, 'channel_id' | 'round' | 'seat_index' | 'move_id' | 'target_id'>,
): Promise<void> {
  const { error } = await db
    .from('moves')
    .upsert(
      {
        channel_id: move.channel_id,
        round: move.round,
        seat_index: move.seat_index,
        move_id: move.move_id,
        target_id: move.target_id,
      },
      { onConflict: 'channel_id,round,seat_index' },
    );
  if (error) throw new Error(`upsertMove: ${error.message}`);
}

/**
 * All moves for a (channel, round), ordered by seat_index. This is the SECURE
 * read path for the game client (service-role, host-token-gated) — viewer
 * lock-ins are never anon-readable or broadcast before resolution.
 */
export async function listMovesForRound(
  db: SupabaseClient,
  channelId: string,
  round: number,
): Promise<MoveRow[]> {
  const { data, error } = await db
    .from('moves')
    .select('*')
    .eq('channel_id', channelId)
    .eq('round', round)
    .order('seat_index', { ascending: true });
  if (error) throw new Error(`listMovesForRound: ${error.message}`);
  return (data as MoveRow[]) ?? [];
}

/** The caller's move for a given round, or null (used to hydrate lockedMove). */
export async function getMove(
  db: SupabaseClient,
  channelId: string,
  round: number,
  seatIndex: number,
): Promise<MoveRow | null> {
  const { data, error } = await db
    .from('moves')
    .select('*')
    .eq('channel_id', channelId)
    .eq('round', round)
    .eq('seat_index', seatIndex)
    .maybeSingle();
  if (error) throw new Error(`getMove: ${error.message}`);
  return (data as MoveRow | null) ?? null;
}

// ------------------------------------------------------------
// Realtime relay
// ------------------------------------------------------------

/**
 * Relay a viewer's move to the game client over Supabase Realtime on
 * `match:<channelId>`, event `move`. The game client subscribes and
 * resolves the round in its own engine. We send-and-forget, then clean up.
 */
export async function broadcastMove(
  db: SupabaseClient,
  channelId: string,
  event: RealtimeMoveEvent,
): Promise<void> {
  const channel = db.channel(`match:${channelId}`);
  await channel.send({ type: 'broadcast', event: 'move', payload: event });
  await db.removeChannel(channel);
}

/**
 * Broadcast the NON-SENSITIVE authoritative state snapshot the client published
 * on `match:<channelId>`, event `state`. The extension subscribes to push HP /
 * round / phase updates. Never carries viewer lock-ins.
 */
export async function broadcastState(
  db: SupabaseClient,
  channelId: string,
  snapshot: StateSnapshot,
): Promise<void> {
  const channel = db.channel(`match:${channelId}`);
  await channel.send({ type: 'broadcast', event: 'state', payload: snapshot });
  await db.removeChannel(channel);
}

/**
 * Broadcast a turn `prompt` (round + soft-timer hint) on `match:<channelId>`.
 * Non-sensitive; tells viewers to choose an action.
 */
export async function broadcastPrompt(
  db: SupabaseClient,
  channelId: string,
  event: RealtimePromptEvent,
): Promise<void> {
  const channel = db.channel(`match:${channelId}`);
  await channel.send({ type: 'broadcast', event: 'prompt', payload: event });
  await db.removeChannel(channel);
}

/**
 * Apply a full host publish atomically-enough for alpha: write the match-level
 * mirror, the per-seat mirrors, then broadcast `state` (+ `prompt` when the
 * client says the phase is `lockin`). No combat computation — pure persistence
 * + relay of what the client already decided.
 */
export async function applyHostPublish(
  db: SupabaseClient,
  channelId: string,
  payload: HostPublishPayload,
): Promise<{ broadcastPrompt: boolean }> {
  const endsAt = payload.endsAtEpochMs ?? null;
  const snapshot = payload.snapshot ?? null;

  await writeMatchMirror(db, channelId, {
    round: payload.round,
    phase: payload.phase,
    endsAtEpochMs: endsAt,
    bossHp: payload.boss.hp,
    bossMaxHp: payload.boss.maxHp,
    bossAlive: payload.boss.alive,
    snapshot,
  });

  for (const s of payload.seats) {
    await writeSeatMirror(db, channelId, s.seatIndex, {
      hp: s.hp,
      maxHp: s.maxHp,
      alive: s.alive,
      classId: s.classId,
    });
  }

  // Build the non-sensitive state snapshot to broadcast. Prefer the client's
  // own snapshot if it supplied one; otherwise assemble from the publish.
  const stateEvent: StateSnapshot =
    snapshot ?? {
      matchPhase: payload.phase,
      round: payload.round,
      endsAtEpochMs: endsAt,
      you: null, // broadcast is channel-wide; per-viewer overlay is /api/state's job
      boss: { hp: payload.boss.hp, maxHp: payload.boss.maxHp, alive: payload.boss.alive },
      seats: payload.seats.map((s) => ({
        seatIndex: s.seatIndex,
        classId: s.classId,
        hp: s.hp,
        maxHp: s.maxHp,
        alive: s.alive,
      })),
    };

  await broadcastState(db, channelId, stateEvent);

  const emitPrompt = payload.phase === 'lockin';
  if (emitPrompt) {
    await broadcastPrompt(db, channelId, { round: payload.round, endsAtEpochMs: endsAt });
  }

  return { broadcastPrompt: emitPrompt };
}

// ------------------------------------------------------------
// Snapshot helper (read of the last-published state)
// ------------------------------------------------------------

/**
 * Build the caller-relevant /api/state snapshot from persisted mirrors.
 * Pure projection of stored data — no computation of HP/damage/turns.
 * Prefers the full snapshot the client published; falls back to assembling
 * one from match + seat rows so /api/state still works pre-first-publish.
 */
export async function readStateForUser(
  db: SupabaseClient,
  channelId: string,
  opaqueUserId: string,
): Promise<StateSnapshot> {
  const [match, seats] = await Promise.all([
    getMatch(db, channelId),
    listSeats(db, channelId),
  ]);

  const mySeat = seats.find((s) => s.opaque_user_id === opaqueUserId) ?? null;
  const round = match?.current_round ?? 0;

  // If the client published a full snapshot, return it but overlay the
  // caller's own seat view (the published snapshot is per-channel, not per-viewer).
  if (match?.snapshot) {
    const base = match.snapshot;
    let lockedMove: { moveId: string; targetId: string } | null = null;
    if (mySeat) {
      const mv = await getMove(db, channelId, round, mySeat.seat_index);
      lockedMove = mv ? { moveId: mv.move_id, targetId: mv.target_id } : null;
    }
    return {
      ...base,
      you: mySeat
        ? {
            seatIndex: mySeat.seat_index,
            classId: mySeat.class_id,
            hp: mySeat.hp,
            maxHp: mySeat.max_hp,
            alive: mySeat.alive,
            lockedMove,
          }
        : null,
    };
  }

  // Fallback: assemble from rows.
  let lockedMove: { moveId: string; targetId: string } | null = null;
  if (mySeat) {
    const mv = await getMove(db, channelId, round, mySeat.seat_index);
    lockedMove = mv ? { moveId: mv.move_id, targetId: mv.target_id } : null;
  }

  return {
    matchPhase: match?.phase ?? 'lobby',
    round,
    endsAtEpochMs: match?.ends_at_epoch_ms ?? null,
    you: mySeat
      ? {
          seatIndex: mySeat.seat_index,
          classId: mySeat.class_id,
          hp: mySeat.hp,
          maxHp: mySeat.max_hp,
          alive: mySeat.alive,
          lockedMove,
        }
      : null,
    boss: {
      hp: match?.boss_hp ?? 0,
      maxHp: match?.boss_max_hp ?? 0,
      alive: match?.boss_alive ?? true,
    },
    seats: seats.map((s) => ({
      seatIndex: s.seat_index,
      classId: s.class_id,
      hp: s.hp,
      maxHp: s.max_hp,
      alive: s.alive,
    })),
  };
}

export type { SupabaseClient };
