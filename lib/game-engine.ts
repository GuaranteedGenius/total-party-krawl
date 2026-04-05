// ============================================================
// Boss Battle MVP — Core Game Engine
// Pure functions for turn resolution, damage calculation, etc.
// ============================================================

import {
  BossAction, StreamerAction, GameState, PlayerState,
  TurnResult, VoteTally, StatusEffect, Cooldowns, GamePhase
} from './types';

// --- Constants ---

const BOSS_MAX_HP = 500;
const STREAMER_MAX_HP = 300;
const TURN_DURATION_MS = 15_000; // 15 seconds

// Boss attack damage/heal values
const BOSS_MOVES: Record<string, { damage: number; heal: number; cooldown: number; effect?: () => StatusEffect }> = {
  slash:    { damage: 40, heal: 0, cooldown: 0 },
  fireball: { damage: 60, heal: 0, cooldown: 3 },
  poison:   { damage: 0,  heal: 0, cooldown: 0, effect: () => ({ type: 'poison', remaining_turns: 3, value: 15 }) },
  heal:     { damage: 0,  heal: 50, cooldown: 4 },
  // Bits-powered moves
  ultimate_strike: { damage: 100, heal: 0, cooldown: 0 },
  full_heal:       { damage: 0,   heal: BOSS_MAX_HP, cooldown: 0 },
};

// Streamer attack damage/heal values
const STREAMER_MOVES: Record<string, { damage: number; heal: number; cooldown: number; effect?: () => StatusEffect }> = {
  strike:     { damage: 30, heal: 0, cooldown: 0 },
  heavy_blow: { damage: 50, heal: 0, cooldown: 2 },
  shield:     { damage: 0,  heal: 0, cooldown: 3, effect: () => ({ type: 'shield', remaining_turns: 1, value: 0.5 }) },
  potion:     { damage: 0,  heal: 40, cooldown: 3 },
};

// --- Factory: create a fresh game state ---

export function createGameState(matchId: string, channelId: string, bossName: string): GameState {
  return {
    match_id: matchId,
    channel_id: channelId,
    turn_number: 1,
    phase: 'voting',
    boss: {
      hp: BOSS_MAX_HP,
      max_hp: BOSS_MAX_HP,
      status_effects: [],
      cooldowns: {},
    },
    streamer: {
      hp: STREAMER_MAX_HP,
      max_hp: STREAMER_MAX_HP,
      status_effects: [],
      cooldowns: {},
    },
    votes: { slash: 0, fireball: 0, poison: 0, heal: 0 },
    total_voters: 0,
    streamer_action: null,
    last_turn_result: null,
    turn_deadline: Date.now() + TURN_DURATION_MS,
    turn_started_at: Date.now(),
    winner: null,
    boss_name: bossName,
  };
}

// --- Vote tallying ---

export function tallyVote(state: GameState, action: BossAction, viewerId: string): GameState {
  if (state.phase !== 'voting') return state;
  // Bits moves are triggered instantly, not voted on
  if (action === 'ultimate_strike' || action === 'full_heal') return state;
  // Check cooldown
  if ((state.boss.cooldowns[action] ?? 0) > 0) return state;

  const newVotes = { ...state.votes, [action]: (state.votes[action] ?? 0) + 1 };
  return { ...state, votes: newVotes, total_voters: state.total_voters + 1 };
}

// --- Determine winning vote ---

export function getWinningVote(votes: VoteTally, cooldowns: Cooldowns): BossAction {
  const eligible = (['slash', 'fireball', 'poison', 'heal'] as BossAction[])
    .filter(a => (cooldowns[a] ?? 0) === 0);

  if (eligible.length === 0) return 'slash'; // fallback

  let best: BossAction = eligible[0];
  for (const action of eligible) {
    if ((votes[action] ?? 0) > (votes[best] ?? 0)) {
      best = action;
    }
  }
  // If no votes were cast, default to slash
  if ((votes[best] ?? 0) === 0) return 'slash';
  return best;
}

// --- Resolve a turn ---

export function resolveTurn(state: GameState, bitsActions: BossAction[]): { newState: GameState; result: TurnResult } {
  const bossAction = getWinningVote(state.votes, state.boss.cooldowns);
  const streamerAction = state.streamer_action ?? 'strike'; // default if streamer didn't pick

  const events: string[] = [];
  let bossHp = state.boss.hp;
  let streamerHp = state.streamer.hp;
  let bossDamageDealt = 0;
  let streamerDamageDealt = 0;
  let bossHealing = 0;
  let streamerHealing = 0;
  let bitsUsed = 0;

  // Clone status effects
  let bossEffects = [...state.boss.status_effects.map(e => ({ ...e }))];
  let streamerEffects = [...state.streamer.status_effects.map(e => ({ ...e }))];
  const bossCooldowns = { ...state.boss.cooldowns };
  const streamerCooldowns = { ...state.streamer.cooldowns };

  // --- Apply streamer's shield BEFORE damage (if chosen this turn) ---
  const streamerMove = STREAMER_MOVES[streamerAction];
  if (streamerMove.effect) {
    const eff = streamerMove.effect();
    streamerEffects.push(eff);
    events.push(`Streamer activates ${eff.type}!`);
  }

  // --- Boss action ---
  const bossMove = BOSS_MOVES[bossAction];
  if (bossMove.damage > 0) {
    let dmg = bossMove.damage;
    // Check streamer shield
    const shield = streamerEffects.find(e => e.type === 'shield');
    if (shield) {
      dmg = Math.round(dmg * shield.value);
      events.push(`Streamer's shield reduces damage to ${dmg}!`);
    }
    streamerHp = Math.max(0, streamerHp - dmg);
    bossDamageDealt = dmg;
    events.push(`Boss uses ${bossAction} for ${dmg} damage!`);
  }
  if (bossMove.heal > 0) {
    const healAmt = Math.min(bossMove.heal, state.boss.max_hp - bossHp);
    bossHp += healAmt;
    bossHealing = healAmt;
    events.push(`Boss heals for ${healAmt} HP!`);
  }
  if (bossMove.effect) {
    const eff = bossMove.effect();
    streamerEffects.push(eff);
    events.push(`Boss inflicts ${eff.type} on streamer!`);
  }
  if (bossMove.cooldown > 0) {
    bossCooldowns[bossAction] = bossMove.cooldown;
  }

  // --- Streamer action ---
  if (streamerMove.damage > 0) {
    bossHp = Math.max(0, bossHp - streamerMove.damage);
    streamerDamageDealt = streamerMove.damage;
    events.push(`Streamer uses ${streamerAction} for ${streamerMove.damage} damage!`);
  }
  if (streamerMove.heal > 0) {
    const healAmt = Math.min(streamerMove.heal, state.streamer.max_hp - streamerHp);
    streamerHp += healAmt;
    streamerHealing = healAmt;
    events.push(`Streamer heals for ${healAmt} HP!`);
  }
  if (streamerMove.cooldown > 0) {
    streamerCooldowns[streamerAction] = streamerMove.cooldown;
  }

  // --- Apply bits actions (immediate, outside normal flow) ---
  for (const bitsAct of bitsActions) {
    const bm = BOSS_MOVES[bitsAct];
    if (bm.damage > 0) {
      streamerHp = Math.max(0, streamerHp - bm.damage);
      bossDamageDealt += bm.damage;
      bitsUsed += bitsAct === 'ultimate_strike' ? 100 : 0;
      events.push(`💎 Bits Ultimate Strike hits streamer for ${bm.damage} damage!`);
    }
    if (bm.heal > 0) {
      bossHp = Math.min(state.boss.max_hp, bossHp + bm.heal);
      bossHealing += bm.heal;
      bitsUsed += bitsAct === 'full_heal' ? 500 : 0;
      events.push(`💎 Bits Full Heal restores boss to max HP!`);
    }
  }

  // --- Tick status effects (poison damage, remove expired) ---
  for (const eff of streamerEffects) {
    if (eff.type === 'poison' && eff.remaining_turns > 0) {
      streamerHp = Math.max(0, streamerHp - eff.value);
      bossDamageDealt += eff.value;
      events.push(`Poison deals ${eff.value} damage to streamer!`);
    }
  }
  for (const eff of bossEffects) {
    if (eff.type === 'poison' && eff.remaining_turns > 0) {
      bossHp = Math.max(0, bossHp - eff.value);
      streamerDamageDealt += eff.value;
      events.push(`Poison deals ${eff.value} damage to boss!`);
    }
  }

  // Decrement remaining turns and remove expired effects
  streamerEffects = streamerEffects
    .map(e => ({ ...e, remaining_turns: e.remaining_turns - 1 }))
    .filter(e => e.remaining_turns > 0);
  bossEffects = bossEffects
    .map(e => ({ ...e, remaining_turns: e.remaining_turns - 1 }))
    .filter(e => e.remaining_turns > 0);

  // Decrement cooldowns
  for (const key of Object.keys(bossCooldowns)) {
    bossCooldowns[key] = Math.max(0, bossCooldowns[key] - 1);
  }
  for (const key of Object.keys(streamerCooldowns)) {
    streamerCooldowns[key] = Math.max(0, streamerCooldowns[key] - 1);
  }

  // --- Check win condition ---
  let winner: 'streamer' | 'chat' | null = null;
  let phase: GamePhase = 'voting';
  if (streamerHp <= 0 && bossHp <= 0) {
    winner = 'chat'; // tie goes to chat
    phase = 'game_over';
    events.push('Both sides fall — Chat wins by default!');
  } else if (streamerHp <= 0) {
    winner = 'chat';
    phase = 'game_over';
    events.push('Streamer is defeated — Chat wins!');
  } else if (bossHp <= 0) {
    winner = 'streamer';
    phase = 'game_over';
    events.push('Boss is defeated — Streamer wins!');
  }

  const result: TurnResult = {
    turn_number: state.turn_number,
    boss_action: bossAction,
    streamer_action: streamerAction,
    boss_damage_dealt: bossDamageDealt,
    streamer_damage_dealt: streamerDamageDealt,
    boss_healing: bossHealing,
    streamer_healing: streamerHealing,
    boss_hp_after: bossHp,
    streamer_hp_after: streamerHp,
    bits_used: bitsUsed,
    events,
  };

  const newState: GameState = {
    ...state,
    turn_number: phase === 'game_over' ? state.turn_number : state.turn_number + 1,
    phase,
    boss: {
      hp: bossHp,
      max_hp: state.boss.max_hp,
      status_effects: bossEffects,
      cooldowns: bossCooldowns,
    },
    streamer: {
      hp: streamerHp,
      max_hp: state.streamer.max_hp,
      status_effects: streamerEffects,
      cooldowns: streamerCooldowns,
    },
    votes: { slash: 0, fireball: 0, poison: 0, heal: 0 },
    total_voters: 0,
    streamer_action: null,
    last_turn_result: result,
    turn_deadline: phase === 'game_over' ? 0 : Date.now() + TURN_DURATION_MS,
    turn_started_at: Date.now(),
    winner,
  };

  return { newState, result };
}

// --- Utility: check if an action is available (not on cooldown) ---

export function isActionAvailable(cooldowns: Cooldowns, action: string): boolean {
  return (cooldowns[action] ?? 0) === 0;
}

// --- Utility: get available actions for a side ---

export function getAvailableBossActions(cooldowns: Cooldowns): BossAction[] {
  return (['slash', 'fireball', 'poison', 'heal'] as BossAction[])
    .filter(a => isActionAvailable(cooldowns, a));
}

export function getAvailableStreamerActions(cooldowns: Cooldowns): StreamerAction[] {
  return (['strike', 'heavy_blow', 'shield', 'potion'] as StreamerAction[])
    .filter(a => isActionAvailable(cooldowns, a));
}

export { TURN_DURATION_MS, BOSS_MAX_HP, STREAMER_MAX_HP };
