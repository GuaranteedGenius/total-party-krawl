// ============================================================
// Shared types — per-viewer seat model (alpha "Fight Me")
// ------------------------------------------------------------
// THIN RELAY: these types describe rows the server persists and
// small JSON it relays. NO game logic / no combat math lives here.
// HP/alive fields are MIRRORS the Godot client pushes; the server
// never computes them.
// ============================================================

/** Verified identity extracted from a Twitch Extension Helper JWT. */
export interface ViewerIdentity {
  /** Twitch channel id — the match key (one active match per channel for alpha). */
  channelId: string;
  /** Stable-but-anonymous per-channel id (always present). */
  opaqueUserId: string;
  /** Real Twitch user id — only present if the viewer granted identity to the extension. */
  userId?: string;
  /** Twitch extension role: 'broadcaster' | 'moderator' | 'viewer' | 'external'. */
  role: string;
}

// Phase is authored by the game client (it owns the combat state machine); the
// relay only stores/echoes the string it is given. The union documents the
// values the client is known to send across the alpha modes — `lockin` is the
// submissions-open phase the host publish path uses to trigger a `prompt` event.
export type MatchPhase =
  | 'lobby'
  | 'choosing'
  | 'lockin'
  | 'resolving'
  | 'won'
  | 'lost'
  | 'ended';
export type ClassId = 'class.tank' | 'class.mage' | 'class.healer';

// ----- DB row shapes (mirror supabase/schema.sql) -----

export interface MatchRow {
  channel_id: string;
  status: string;
  current_round: number;
  phase: MatchPhase;
  boss_hp: number;
  boss_max_hp: number;
  boss_alive: boolean;
  ends_at_epoch_ms: number | null;
  /** Last full snapshot the game client published (the /api/state payload). */
  snapshot: StateSnapshot | null;
  updated_at: string;
}

export interface SeatRow {
  channel_id: string;
  seat_index: number;
  opaque_user_id: string;
  class_id: ClassId | null;
  hp: number;
  max_hp: number;
  alive: boolean;
  joined_at: string;
}

export interface MoveRow {
  channel_id: string;
  round: number;
  seat_index: number;
  move_id: string;
  target_id: string;
  created_at: string;
}

export interface PlayerRow {
  opaque_user_id: string;
  display_name: string | null;
  xp: number;
  level: number;
  created_at: string;
}

// ----- API payloads -----

/** The snapshot the game client publishes and /api/state returns. */
export interface StateSnapshot {
  matchPhase: MatchPhase;
  round: number;
  endsAtEpochMs: number | null;
  you: {
    seatIndex: number | null;
    classId: ClassId | null;
    hp: number;
    maxHp: number;
    alive: boolean;
    lockedMove: { moveId: string; targetId: string } | null;
  } | null;
  boss: { hp: number; maxHp: number; alive: boolean };
  seats: Array<{
    seatIndex: number;
    classId: ClassId | null;
    hp: number;
    maxHp: number;
    alive: boolean;
  }>;
}

/** Realtime broadcast events on `match:<channelId>`. */
export type RealtimeMoveEvent = {
  seatIndex: number;
  round: number;
  moveId: string;
  targetId: string;
};

// ----- Host (broadcaster) auth & publish -----

/**
 * Verified host (broadcaster) identity carried by a host-session JWT. A
 * broadcaster's channel id IS their Twitch user id, so `channelId` is the
 * authoritative match key the token is scoped to.
 */
export interface HostIdentity {
  channelId: string;
}

/** Result of validating a Twitch user access token against id.twitch.tv. */
export interface TwitchTokenInfo {
  userId: string;
  login: string;
  clientId: string;
  scopes: string[];
  expiresIn: number;
}

/** Boss mirror in a host publish (client-computed; relay stores verbatim). */
export interface HostPublishBoss {
  hp: number;
  maxHp: number;
  alive: boolean;
}

/** A seat mirror in a host publish (client-computed; relay stores verbatim). */
export interface HostPublishSeat {
  seatIndex: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  classId: ClassId | null;
}

/**
 * Authoritative state the game client publishes each round. Every field is a
 * MIRROR the client computed — the relay never derives or validates combat.
 */
export interface HostPublishPayload {
  /** Optional explicit channel; if present it MUST equal the token's channel. */
  channelId?: string;
  round: number;
  phase: MatchPhase;
  endsAtEpochMs?: number | null;
  boss: HostPublishBoss;
  seats: HostPublishSeat[];
  /** Optional full per-channel snapshot the client wants /api/state to serve. */
  snapshot?: StateSnapshot | null;
}

/** `prompt` Realtime event payload (non-sensitive; safe to broadcast). */
export type RealtimePromptEvent = {
  round: number;
  endsAtEpochMs: number | null;
};
