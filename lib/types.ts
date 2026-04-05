// ============================================================
// Boss Battle MVP — Shared TypeScript Types
// ============================================================

// --- Actions ---

export type BossAction = 'slash' | 'fireball' | 'poison' | 'heal' | 'ultimate_strike' | 'full_heal';
export type StreamerAction = 'strike' | 'heavy_blow' | 'shield' | 'potion';

// --- Status Effects ---

export interface StatusEffect {
  type: 'poison' | 'shield';
  remaining_turns: number;
  /** damage-per-turn for poison, damage reduction multiplier for shield */
  value: number;
}

// --- Cooldowns ---

export interface Cooldowns {
  [action: string]: number; // turns remaining until usable (0 = ready)
}

// --- Player State ---

export interface PlayerState {
  hp: number;
  max_hp: number;
  status_effects: StatusEffect[];
  cooldowns: Cooldowns;
}

// --- Vote Tally ---

export interface VoteTally {
  slash: number;
  fireball: number;
  poison: number;
  heal: number;
  [key: string]: number;
}

// --- Game State (the full snapshot pushed to all viewers) ---

export type GamePhase = 'waiting' | 'voting' | 'resolving' | 'game_over';

export interface GameState {
  match_id: string;
  channel_id: string;
  turn_number: number;
  phase: GamePhase;

  boss: PlayerState;
  streamer: PlayerState;

  votes: VoteTally;
  total_voters: number;

  /** The action the streamer locked in for this turn (null if not yet chosen) */
  streamer_action: StreamerAction | null;

  /** Results from the most recently resolved turn */
  last_turn_result: TurnResult | null;

  /** Unix timestamp (ms) when the current turn's voting window expires */
  turn_deadline: number;

  /** Unix timestamp (ms) when the current turn started */
  turn_started_at: number;

  /** Who won — only set when phase === 'game_over' */
  winner: 'streamer' | 'chat' | null;

  boss_name: string;
}

// --- Turn Resolution Result ---

export interface TurnResult {
  turn_number: number;
  boss_action: BossAction;
  streamer_action: StreamerAction;
  boss_damage_dealt: number;
  streamer_damage_dealt: number;
  boss_healing: number;
  streamer_healing: number;
  boss_hp_after: number;
  streamer_hp_after: number;
  bits_used: number;
  events: string[]; // human-readable log lines for the turn
}

// --- API Request / Response types ---

export interface StartGameRequest {
  channel_id: string;
  boss_name?: string;
}

export interface ActionRequest {
  match_id: string;
  channel_id: string;
  action: StreamerAction;
}

export interface VoteRequest {
  match_id: string;
  channel_id: string;
  action: BossAction;
  viewer_id: string;
}

export interface BitsTransactionRequest {
  match_id: string;
  channel_id: string;
  product: 'ultimate_strike' | 'full_heal';
  transaction_id: string;
  bits_amount: number;
  viewer_id: string;
}

export interface MatchRecord {
  id: string;
  channel_id: string;
  boss_name: string;
  streamer_hp_start: number;
  boss_hp_start: number;
  winner: 'streamer' | 'chat';
  turns_played: number;
  started_at: string;
  ended_at: string;
}

export interface LeaderboardEntry {
  channel_id: string;
  streamer_wins: number;
  chat_wins: number;
  total_matches: number;
  last_played: string;
}

// --- JWT Payload from Twitch ---

export interface TwitchJWTPayload {
  exp: number;
  opaque_user_id: string;
  user_id?: string;
  channel_id: string;
  role: 'broadcaster' | 'moderator' | 'viewer' | 'external';
  pubsub_perms?: {
    listen?: string[];
    send?: string[];
  };
}
