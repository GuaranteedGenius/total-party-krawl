/* content.js — alpha combat content (ids + display labels) for the viewer panel.
 *
 * THIS MIRRORS THE GAME'S DefaultContent. The Godot client is the source of truth for
 * combat math; the extension only needs stable ids + UI labels so a viewer can pick.
 * Keep this in sync with docs/superpowers/specs/2026-06-14-combat-core-design.md.
 *
 * Ids confirmed from the combat-core design + docs/api-contract.md:
 *   classes : class.tank | class.mage | class.healer
 *   moves   : basic.attack (universal) | tank.taunt | tank.shield_bash |
 *             mage.fireball | mage.flame_burst | healer.heal | healer.mend
 *   targets : boss | seat.<index>
 *
 * The universal Basic Attack id is `basic.attack` — confirmed against the game's
 * DefaultContent (combat/DefaultContent.cs: BasicAttack = "basic.attack"). It is one
 * shared MoveDef every class references.
 */
(function (global) {
  'use strict';

  // Target rule vocabulary (mirrors spec §5.1 TargetRule). Drives the target picker UI.
  // SELF      — no target choice; resolves to the caller's own seat.
  // ALLY_ONE  — pick one living ally seat (self allowed).
  // ALLY_ALL  — hits all allies; no target choice.
  // ENEMY_ONE — single enemy; alpha has one enemy so resolves to `boss`.
  // ENEMY_ALL — all enemies; no target choice (alpha: just the boss).
  var TARGET = {
    SELF: 'SELF',
    ALLY_ONE: 'ALLY_ONE',
    ALLY_ALL: 'ALLY_ALL',
    ENEMY_ONE: 'ENEMY_ONE',
    ENEMY_ALL: 'ENEMY_ALL'
  };

  var MOVES = {
    'basic.attack': {
      id: 'basic.attack',
      label: 'Basic Attack',
      target: TARGET.ENEMY_ONE,
      cooldown: 0,
      blurb: 'A reliable hit on the boss. No cooldown.'
    },
    'tank.taunt': {
      id: 'tank.taunt',
      label: 'Taunt',
      target: TARGET.SELF,
      cooldown: 2,
      blurb: 'Force the boss to attack you for the next round.'
    },
    'tank.shield_bash': {
      id: 'tank.shield_bash',
      label: 'Shield Bash',
      target: TARGET.ENEMY_ONE,
      cooldown: 1,
      blurb: 'A heavier physical hit on the boss.'
    },
    'mage.fireball': {
      id: 'mage.fireball',
      label: 'Fireball',
      target: TARGET.ENEMY_ONE,
      cooldown: 0,
      blurb: 'Big single-target burst. Spammable.'
    },
    'mage.flame_burst': {
      id: 'mage.flame_burst',
      label: 'Flame Burst',
      target: TARGET.ENEMY_ALL,
      cooldown: 2,
      blurb: 'Hits all enemies. (Alpha: just the boss.)'
    },
    'healer.heal': {
      id: 'healer.heal',
      label: 'Heal',
      target: TARGET.ALLY_ONE,
      cooldown: 0,
      blurb: 'Restore HP to one ally (you can target yourself).'
    },
    'healer.mend': {
      id: 'healer.mend',
      label: 'Mend',
      target: TARGET.ALLY_ALL,
      cooldown: 3,
      blurb: 'Heal the whole party at once.'
    }
  };

  // Ordered move lists per class. Basic Attack first as the safe default.
  var CLASSES = {
    'class.tank': {
      id: 'class.tank',
      label: 'Tank',
      role: 'Soak + control',
      blurb: 'Highest HP. Taunt the boss to protect the party.',
      moveIds: ['basic.attack', 'tank.taunt', 'tank.shield_bash']
    },
    'class.mage': {
      id: 'class.mage',
      label: 'Mage',
      role: 'Burst damage',
      blurb: 'Glass cannon. Fireball melts the boss but you are fragile.',
      moveIds: ['basic.attack', 'mage.fireball', 'mage.flame_burst']
    },
    'class.healer': {
      id: 'class.healer',
      label: 'Healer',
      role: 'Party sustain',
      blurb: 'Keep the party alive. Heal often, Mend in emergencies.',
      moveIds: ['basic.attack', 'healer.heal', 'healer.mend']
    }
  };

  var ORDERED_CLASS_IDS = ['class.tank', 'class.mage', 'class.healer'];
  var MAX_SEATS = 10;

  function seatTargetId(seatIndex) {
    return 'seat.' + seatIndex;
  }

  function getClass(classId) {
    return CLASSES[classId] || null;
  }

  function getMove(moveId) {
    return MOVES[moveId] || null;
  }

  function movesForClass(classId) {
    var c = getClass(classId);
    if (!c) return [];
    return c.moveIds.map(function (id) { return MOVES[id]; }).filter(Boolean);
  }

  global.TPK_CONTENT = {
    TARGET: TARGET,
    MOVES: MOVES,
    CLASSES: CLASSES,
    ORDERED_CLASS_IDS: ORDERED_CLASS_IDS,
    MAX_SEATS: MAX_SEATS,
    seatTargetId: seatTargetId,
    getClass: getClass,
    getMove: getMove,
    movesForClass: movesForClass
  };
})(window);
