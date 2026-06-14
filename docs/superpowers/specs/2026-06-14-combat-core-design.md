# Design: Combat Core (Milestone A — "Fight Me", offline vs bots)

**Date:** 2026-06-14
**Status:** Draft (design phase) — implementation-ready
**Owner:** game-designer · **Consumer:** godot-gameplay-engineer
**Scope lock:** "Fight Me" mode only. Streamer controls a single boss; up to 10 viewers join as
individual characters; party wipe = streamer wins, boss dies = viewers win. Co-op/AI mode is out of
scope. Balance is tuned assuming **2–4 active party members** for the first playtest, but the model
scales to 10 seats. Must run fully offline with bot "viewers".

> This is a DESIGN deliverable: exact numbers and schemas, no game code. Where a number is a
> deliberate tuning guess, it is flagged. Progression / XP / loot / gear are **deferred** — only
> forward-compatible hooks are noted, not designed.

---

## 0. Design pillars for the math

1. **Simple, integer-friendly, tunable.** Every formula is linear or a small bounded curve. A
   designer can re-tune by editing one constant. No exponentials, no lookup tables for alpha.
2. **Stats matter but never dominate.** A stat advantage shifts outcomes ~20–40%, it does not make
   a character unkillable or a move whiff every time. Hard caps on dodge and resistance.
3. **Determinism where it counts.** Damage/heal are deterministic (no damage variance for alpha) so
   playtesters and unit tests get a clean oracle. The *only* RNG in the core is dodge, and dodge is
   computed from a single `Randf()` per attack so it is easy to seed in tests.
4. **Round is the atom.** All cooldowns, durations, and effects are measured in **rounds**, never
   seconds. The 20-second timer governs *input*, not game time.

All constants below live in one tunables block (`CombatTuning`, see §5) so balance is data, not code.

---

## 1. The 4 stats and exact formulas

Stat values for alpha live in the small-integer range **5–20** (class bases are 6–14; see §3). The
formulas are designed around that range.

### 1.1 Tunable constants (the balance knobs)

| Constant | Value | Meaning |
|---|---|---|
| `HP_BASE` | 40 | flat HP every combatant starts with |
| `HP_PER_CON` | 8 | max HP gained per point of CON |
| `STR_DMG_PER` | 1.5 | physical damage per point of STR |
| `INT_DMG_PER` | 1.5 | magic damage / healing per point of INT |
| `DODGE_PER_DEX` | 1.5 | % dodge per point of *net* DEX (attacker vs defender) |
| `DODGE_BASE` | 5 | floor dodge % before DEX delta |
| `DODGE_CAP` | 40 | max dodge % (hard cap) |
| `DODGE_FLOOR` | 0 | min dodge % (hard floor) |
| `RESIST_PER_CON` | 0.8 | % damage reduction per point of CON |
| `RESIST_CAP` | 50 | max resistance % (hard cap) |
| `INIT_TIE_JITTER` | — | tie-break rule, see §1.6 |

These are the only numbers a balance pass touches. They are flagged in §8 by confidence.

### 1.2 Max HP from CON

```
MaxHP = HP_BASE + (CON * HP_PER_CON)
```
Example: CON 14 → 40 + 112 = **152 HP**. CON 6 → 40 + 48 = **88 HP**.

Rationale for a flat base + linear term: guarantees even a 0-CON build is not one-shot, and keeps the
tank-vs-mage HP ratio readable (Tank CON 14 = 152, Mage CON 6 = 88, ~1.7x — meaningful but not absurd).

### 1.3 Physical damage from STR

```
RawPhysical = MoveBasePower + (STR * STR_DMG_PER)
```
`MoveBasePower` is per-move (see move tables). STR scales every physical move equally; differentiation
between moves comes from `MoveBasePower` and cooldown, not from per-move scaling multipliers (keep it
simple for alpha). Damage is floored to an integer **after** resistance (§1.5).

### 1.4 Magic damage and healing from INT

```
RawMagic = MoveBasePower + (INT * INT_DMG_PER)
RawHeal  = MoveBasePower + (INT * INT_DMG_PER)
```
Magic and healing share one scaling rule so INT is a clean "spellcasting" stat. Healing is **not**
reduced by resistance (resistance is damage-only). Magic damage **is** reduced by resistance.

> Hook (deferred): a later `school` field on moves could let resistance be typed (physical/magic).
> For alpha, resistance reduces *all incoming damage* uniformly — one number, one mental model.

### 1.5 Resistance from CON (damage taken)

```
ResistPct = min(RESIST_CAP, CON * RESIST_PER_CON)
FinalDamage = floor( RawDamage * (1 - ResistPct/100) )
FinalDamage = max(1, FinalDamage)   // a connecting hit always does ≥1
```
Tank CON 14 → 11.2% reduction. The cap (50% at CON 62.5, unreachable in alpha range) exists only as a
guard rail for future high-CON gear. In the alpha stat range resistance tops out near ~11% — it is a
*minor* mitigation layer; the tank's real durability comes from HP and taunt, not resistance. This is
intentional: resistance that is too strong makes fights swingy and hard to reason about.

### 1.6 Dodge from DEX (attacker DEX vs defender DEX)

Dodge is the only RNG in the core. It is a **contested** check: the defender's DEX is compared to the
attacker's DEX, so a fast attacker partially negates a fast defender.

```
DexDelta   = DefenderDEX - AttackerDEX
DodgePct   = clamp( DODGE_BASE + (DexDelta * DODGE_PER_DEX), DODGE_FLOOR, DODGE_CAP )
roll       = Randf() * 100        // [0,100)
isDodged   = roll < DodgePct
```
Worked feel: defender DEX 12 vs attacker DEX 8 → delta +4 → 5 + 6 = **11% dodge**. Defender DEX 12 vs
attacker DEX 16 → delta −4 → 5 − 6 = clamp to **0%** (floor). A defender who is much faster than the
attacker tops out at 40%. Dodge is a binary: a dodged attack deals **0** and applies **no** secondary
effects (see §6 for the guaranteed-effect exception).

> Why contested and capped: an uncontested flat dodge lets a stacked-DEX build become untouchable,
> which is unfun in a co-op-vs-boss format. Contesting + a 40% cap keeps dodge a *texture*, not a
> wall.

### 1.7 Attack order (initiative) from DEX

Each round, all combatants who have a locked action are sorted into an **initiative order**:

```
Sort descending by DEX.
Tie-break 1: lower seat index acts first   (boss is seat -1 → boss wins ties vs viewers? NO, see below)
Tie-break 2: stable by combatant id
```

Decision on the boss tie: the **boss acts on ties as if it had +0.5 DEX is wrong** — instead we use an
explicit rule: **on a DEX tie, players act before the boss** (defenders' agency first feels better and
is the kinder default for the small-stream party). So:

```
Initiative key = (DEX desc, isBoss asc [players before boss on tie], seatIndex asc, id asc)
```

Initiative is recomputed every round (DEX can change if buffs are added later; for alpha it is static
but recomputing is free and future-proof). Actions resolve strictly in this order; each resolution is
fully applied (including death) before the next begins (§6 covers simultaneous-death edge).

---

## 2. Turn structure

### 2.1 Definition of a "round"

A **round** is one complete cycle:

```
1. PROMPT      — client enters "Choose your action", broadcasts prompt. Cooldowns are already
                 ticked from the previous round's END (see 2.4).
2. LOCK-IN     — 20.000 s window. Each combatant (boss + each seated viewer/bot) submits one
                 (moveId, targetId) pair. Re-submitting overwrites the previous lock.
3. RESOLVE     — timer expires (client is the clock authority). Build initiative order (§1.7).
                 Resolve each locked action in order, applying effects immediately.
4. END         — check win/lose (§6). Decrement all cooldowns by 1 (min 0). Decrement all active
                 effect durations (e.g., taunt) by 1; expire those that hit 0. Round counter += 1.
```

One round = one prompt + one 20s lock-in + one ordered resolution. Everything time-based is counted in
rounds, never wall-clock seconds.

### 2.2 The 20-second lock-in

The 20s timer is purely an **input** window. The client owns the clock (per CLAUDE.md). For offline
bot testing, the timer can be set to a short value (e.g., 0.5s) or skipped entirely — bots lock in
instantly and resolution proceeds. The bot harness must produce the *same data shape* a real viewer
would (a `(moveId, targetId)` submission), so the resolve path is identical online and offline.

### 2.3 Players who don't lock in (default action)

If a combatant has no valid locked action when the timer expires:

- **Viewer/bot:** default to a free, no-cooldown **Basic Attack** (every class has one, see §3.0)
  targeting the boss. Rationale: a non-responding viewer still contributes and the fight keeps moving;
  defaulting to "do nothing" makes absent seats dead weight and stalls the party.
- **If the default action is itself invalid** (e.g., its only legal target is dead): the combatant
  **skips** (acts, does nothing). This only happens in degenerate states.
- **Boss:** the streamer is expected to always pick, but if the boss has no locked action it defaults
  to its single-target attack on the **lowest-current-HP non-dead** viewer (keeps the streamer-side
  bot honest in offline tests).

### 2.4 Cooldown ticking — precise rule

- A move with `cooldown = N` becomes unavailable the moment it is used and counts down **at END of
  each round** (step 4). It is usable again once its remaining cooldown reaches 0.
- A move used this round has its cooldown **set to N at RESOLVE**, then the END decrement brings it to
  `N-1`. So a `cooldown = 1` move is unusable the very next round and available the round after that.
  A `cooldown = 0` move is usable every round.
- Cooldowns are per-combatant, per-move. Stored in runtime state (§5), never in content.

> There is no mana/energy resource for alpha. Cost is expressed purely as cooldown. (`costType`/
> `costAmount` fields exist in the schema as a deferred hook but are unused — set to `None`/`0`.)

---

## 3. The 3 launch classes

### 3.0 Universal Basic Attack

Every class has an implicit **Basic Attack** (the default / no-cooldown filler). It is a physical
single-target hit on the boss. It is defined as a normal `MoveDef` and referenced by each class so it
is still data, not hardcoded:

| Field | Value |
|---|---|
| name | Basic Attack |
| target | Enemy (single) |
| effect | physical damage |
| basePower | 4 |
| scaling | STR |
| cooldown | 0 |

So Basic Attack damage = `4 + STR*1.5` before resistance.

### 3.1 Stat blocks and HP

| Class  | STR | INT | DEX | CON | MaxHP (= 40 + CON*8) |
|--------|----:|----:|----:|----:|---------------------:|
| Tank   | 10  | 6   | 7   | 14  | **152** |
| Mage   | 6   | 14  | 9   | 7   | **96**  |
| Healer | 7   | 12  | 8   | 9   | **112** |

Design intent: Tank = highest HP + lowest INT, slowest (acts late — fine, it taunts/soaks). Mage =
glass cannon, fastest (bursts before the boss), lowest HP. Healer = middle HP, second-highest INT,
mid DEX.

### 3.2 Tank — role: soak + control (the taunt class)

| Move | Target | Effect | basePower | Scaling | Cooldown | Notes |
|---|---|---|---|---|---|---|
| Basic Attack | Enemy | phys dmg | 4 | STR | 0 | universal filler |
| **Taunt** | Self | apply *Taunted* to boss | — | — | 2 | core mechanic, see below |
| Shield Bash | Enemy | phys dmg | 10 | STR | 1 | 10 + STR*1.5 = **25** dmg |

**Taunt mechanic (exact):** When the Tank resolves Taunt, the **boss** gains the status
`Taunted{ by = <tank id>, rounds = 1 }`. While `Taunted` is active:

- Any boss move that targets a **single enemy** is **force-retargeted onto the taunting Tank**,
  regardless of what the streamer picked.
- Boss **AOE / all-enemies** moves are **unaffected** (they already hit everyone, including the Tank).
  This is the explicit taunt-vs-AOE interaction (see §6).
- If the taunting Tank is **dead** at the moment a boss single-target move resolves, the taunt is
  ignored for that move (boss hits its original target). The status is cleared on Tank death.

Duration & timing: Taunt sets `rounds = 1`. Because the Tank's status is applied during RESOLVE and
durations tick down at END, a Taunt cast in round R protects against the boss for **the remainder of
round R's resolution and is consumed at end of R**. Practically, since initiative often has the Tank
acting before or after the boss, we define it cleanly: **Taunt applied this round affects the boss's
action this same round if the boss has not yet resolved, AND persists through the next round's boss
action** — i.e. set `rounds = 2` at apply, tick at END. **Decision: `Taunt.rounds = 2` at apply.**
This guarantees one full round of protection even if the boss already acted before the Tank this round.
Cooldown 2 means the Tank can keep ~100% uptime by re-casting every other round (taunt round, gap
round, taunt round…), with one exposed round in between — a deliberate window, not permanent immunity.

> Tradeoff flagged (§8): `rounds = 2` + `cooldown = 2` gives a 1-round protection / 1-round gap
> rhythm. If playtest shows the boss trivially blows up the party on the gap round, drop taunt
> cooldown to 1 (near-permanent uptime). Starting conservative on the boss's side.

### 3.3 Mage — role: burst (+ light AOE)

| Move | Target | Effect | basePower | Scaling | Cooldown | Notes |
|---|---|---|---|---|---|---|
| Basic Attack | Enemy | phys dmg | 4 | STR | 0 | weak (low STR) |
| **Fireball** | Enemy | magic dmg | 20 | INT | 0 | burst: 20 + INT*1.5 = **41** dmg |
| Flame Burst (AOE) | All enemies | magic dmg | 14 | INT | 2 | 14 + INT*1.5 = **35** to all enemies |

In "Fight Me" there is one enemy (the boss), so Flame Burst hits only the boss for alpha — but it is
authored as `All enemies` so it is correct the day multi-enemy content exists. Fireball is the
single-target burst and is the Mage's bread-and-butter (no cooldown = spammable burst, which is fine
because the Mage is fragile and dies to AOE). Flame Burst exists to satisfy the AOE requirement and
to be future-proof; in single-boss fights it is a lower-DPS option, so a Mage will mostly Fireball.

> Note: with only the boss as a target, Flame Burst (35, cd2) is strictly worse than Fireball (41,
> cd0) in "Fight Me". That is acceptable for alpha — the AOE is a forward-compatibility hook and a
> chance to test the all-enemies targeting path. Do **not** balance Flame Burst for single-target.

### 3.4 Healer — role: party sustain

| Move | Target | Effect | basePower | Scaling | Cooldown | Notes |
|---|---|---|---|---|---|---|
| Basic Attack | Enemy | phys dmg | 4 | STR | 0 | filler |
| **Heal** | Ally (single) | heal | 16 | INT | 0 | 16 + INT*1.5 = **34** HP, single target |
| **Mend (AOE)** | All allies | heal | 8 | INT | 3 | 8 + INT*1.5 = **26** HP to every ally (incl. self) |

Heal is the reliable spot-heal (no cooldown — sustain is the Healer's job and gating it feels bad).
Mend is the party-wide emergency button on a 3-round cooldown. Healing cannot exceed MaxHP (overheal
is discarded, §6). A Healer can target **self** with Heal (self counts as an ally). The Healer can
also Basic Attack the boss if the party is topped off — a small DPS contribution.

### 3.5 Net DPS sanity (single Mage + single Healer + Tank, ignoring dodge)

- Tank/round: Shield Bash 25 (cd1) alternating with Basic 19 → avg ~22/round to boss when not taunting.
  Realistically the Tank taunts every other round, so its boss DPS is lower (~11/round avg). Call it
  **~12/round**.
- Mage/round: Fireball **41**/round sustained.
- Healer/round: mostly heals; when free, Basic **~14**/round. Assume it attacks ~40% of rounds →
  **~6/round**.
- **Party boss-damage ≈ 12 + 41 + 6 ≈ ~59/round** for a 3-person Tank/Mage/Healer party. This drives
  the boss HP target in §4.

---

## 4. The boss (1 archetype: "The Warden")

### 4.1 Stat block

| STR | INT | DEX | CON |
|----:|----:|----:|----:|
| 14  | 8   | 6   | 18  |

- Boss DEX 6 is **deliberately low** so the party (DEX 7–9) usually acts first — players get to react
  (heal/taunt) before the boss swings most rounds. This makes the boss feel like a slow heavy hitter,
  which fits "Warden", and gives the small party agency.
- Boss CON feeds resistance (`18 * 0.8 = 14.4%` damage reduction) and HP base — but boss HP is set
  explicitly (§4.3), not by the CON formula, so it can scale with party size.

### 4.2 Boss move set (streamer picks one each turn)

| Move | Target | Effect | basePower | Scaling | Cooldown | Damage (vs 0-resist) |
|---|---|---|---|---|---|---|
| **Crushing Blow** | Enemy (single) | phys dmg | 18 | STR | 0 | 18 + 14*1.5 = **39** |
| **Quake (AOE)** | All enemies | phys dmg | 10 | STR | 2 | 10 + 14*1.5 = **31** to everyone |
| **Brace** | Self | self-heal + small | 12 | INT | 3 | heals 12 + 8*1.5 = **24**, see note |

- **Crushing Blow** is the single-target hammer. It is the move that **Taunt redirects** (§3.2). 39 raw
  vs Tank's 11.2% resist ≈ **35** to the Tank — the Tank's 152 HP eats ~4–5 of these, exactly the soak
  fantasy. 39 vs the Mage's 0% resist = 39 → would gut the 96-HP Mage in ~2 hits if untaunted, which is
  why taunt matters.
- **Quake** is the AOE that **ignores taunt** — the streamer's answer to a turtling party. 31 raw to
  everyone; the Mage takes 31 (no resist), the Healer 26 (CON9 → 7.2% resist → ~28). cd2 so it is a
  periodic threat, not every round.
- **Brace** is the boss's sustain / stall — heals the boss for ~24 and represents the third
  non-damage option (so the streamer has a real choice, not just two attacks). cd3 keeps it from being
  a stall-lock. (Damage moves still progress the fight; Brace trades a turn of pressure for survival.)

> The streamer chooses freely among available (off-cooldown) boss moves each round — that is the
> "Fight Me" agency. Offline, a boss bot picks: Quake when ≥2 viewers alive and Quake is up, else
> Crushing Blow on lowest-HP target, else Brace when boss < 40% HP and Brace is up.

### 4.3 Boss HP and party-size scaling

**Target:** a 3-person Tank/Mage/Healer fight should last **~10–14 rounds** — long enough to feel like
a fight and to use cooldowns/taunt rhythm, short enough to fit a stream segment (~10 rounds × ~25s
real-time ≈ 4–5 minutes).

From §3.5, a 3-person party deals **~59/round** to the boss. Boss resistance (14.4%) reduces that to
≈ **~50 effective/round**. For ~12 rounds: `50 * 12 = 600`. Round to a clean base.

**Scaling rule (linear per active seat, with a 1-member floor):**

```
BossMaxHP = BOSS_HP_BASE + BOSS_HP_PER_MEMBER * activeMembers
  where BOSS_HP_BASE       = 120
        BOSS_HP_PER_MEMBER = 160
        activeMembers      = number of seated, non-spectator viewers at fight start (min 1)
```

| Active members | Boss HP | Approx party DPS (eff.) | Approx rounds |
|---:|---:|---:|---:|
| 1 (e.g. lone Mage) | 280 | ~35 | ~8 |
| 2 | 440 | ~42 | ~10–11 |
| 3 | 600 | ~50 | ~12 |
| 4 | 760 | ~58 | ~13 |

`activeMembers` is **locked at fight start** (boss HP does not change mid-fight if a viewer rage-quits;
that would feel arbitrary). For alpha the value is the count of bots/viewers seated when the match
begins.

> Why per-member scaling and not a flat boss: a flat boss either melts to a 4-stack or walls a solo
> player. Linear-per-member keeps round count roughly constant (8→13) across 1–4 players, which is the
> right "every viewer is a character" feel. The slight upward drift in round count at higher counts is
> intentional headroom for the boss's AOE to matter more with a bigger party. Flagged §8.

### 4.4 Edge: 0 viewers

If `activeMembers == 0` at fight start, **the match does not start** (there is no party to fight). The
client should refuse to begin / show "waiting for players". `activeMembers` is floored to 1 only for
the HP formula's safety, never to fabricate a phantom player.

---

## 5. Data schema (Godot consumption)

**Representation decision:** content entities are Godot `[GlobalClass]` `Resource` subclasses authored
as `.tres` files (designer-editable in the Godot inspector, hot-swappable, diff-friendly). The combat
**math** lives in **plain C# classes** (no Godot dependency) so it is unit-testable headless (per
Milestone A's "unit tests for resolution order + damage formulas"). The Resource classes are thin DTOs;
they are converted to/read by the pure-C# combat layer. Tunables live in one Resource (`CombatTuning`).

> Engineer note: keep `MoveDef`/`ClassDef`/`BossDef`/`StatBlock`/`CombatTuning` as Resources (content).
> Keep `Combatant`, `BossStatus`, `MoveCooldownTable`, the initiative sorter, and the damage/heal/dodge
> functions as pure C# (runtime + math). The runtime never mutates a Resource.

### 5.1 Enum / type vocabulary

```
TargetRule   : SelfOnly | AllyOne | AllyAll | EnemyOne | EnemyAll
EffectKind   : PhysicalDamage | MagicDamage | Heal | ApplyTaunt | SelfHeal
ScalingStat  : None | STR | INT | DEX | CON
CostType     : None | (deferred: Mana | Energy)        // alpha: always None
```

### 5.2 `StatBlock`  (content; embedded in ClassDef/BossDef)

| Field | Type | Notes |
|---|---|---|
| Str | int | physical scaling |
| Int | int | magic/heal scaling |
| Dex | int | order + dodge |
| Con | int | HP + resist |

### 5.3 `MoveDef`  (content — one `.tres` per move)

| Field | Type | Content/Runtime | Notes |
|---|---|---|---|
| Id | StringName | content | stable key, e.g. `mage.fireball` |
| DisplayName | string | content | UI |
| Target | TargetRule | content | see §5.1 |
| Effect | EffectKind | content | what it does |
| BasePower | int | content | flat term in the formula |
| Scaling | ScalingStat | content | which stat multiplies |
| Cooldown | int | content | rounds; 0 = every round |
| CostType | CostType | content | alpha: None |
| CostAmount | int | content | alpha: 0 |
| StatusRounds | int | content | for ApplyTaunt etc. (Taunt = 2); else 0 |
| Description | string | content | UI/tooltip |

### 5.4 `ClassDef`  (content — one `.tres` per class)

| Field | Type | Notes |
|---|---|---|
| Id | StringName | e.g. `class.tank` |
| DisplayName | string | "Tank" |
| BaseStats | StatBlock | §3.1 |
| MoveIds | StringName[] | ordered list incl. the universal Basic Attack |
| Role | string | flavor/UI only |

### 5.5 `BossDef`  (content — one `.tres` per boss archetype)

| Field | Type | Notes |
|---|---|---|
| Id | StringName | `boss.warden` |
| DisplayName | string | "The Warden" |
| BaseStats | StatBlock | §4.1 |
| HpBase | int | 120 |
| HpPerMember | int | 160 |
| MoveIds | StringName[] | the boss's selectable moves |

### 5.6 `CombatTuning`  (content — single global `.tres`)

Holds every constant from §1.1 (HP_BASE, HP_PER_CON, STR_DMG_PER, INT_DMG_PER, DODGE_BASE,
DODGE_PER_DEX, DODGE_CAP, DODGE_FLOOR, RESIST_PER_CON, RESIST_CAP). One file = the whole balance pass.

### 5.7 Runtime state (pure C#, NOT content, never serialized to `.tres`)

`Combatant` (one per boss + per seated viewer):

| Field | Type | Notes |
|---|---|---|
| Id | string | unique (seat id / `boss`) |
| IsBoss | bool | tie-break + targeting |
| SeatIndex | int | tie-break; boss = -1 |
| ClassId / BossId | StringName | which def |
| Stats | StatBlock | copied from def at fight start (future: + gear) |
| MaxHp | int | computed once at fight start |
| CurrentHp | int | mutates |
| IsAlive | bool | CurrentHp > 0 |
| Cooldowns | Dictionary<StringName,int> | remaining rounds per move |
| LockedMoveId | StringName? | this round's submission |
| LockedTargetId | string? | this round's submission |

`BossStatus` (on the boss only): `TauntedByTankId : string?`, `TauntRoundsRemaining : int`.

`CombatState`: `List<Combatant>`, `int RoundNumber`, `enum Phase {Prompt,LockIn,Resolve,End,Won,Lost}`,
`int ActiveMembersAtStart`, RNG seed.

### 5.8 Pure-math API surface (the unit-test target)

These are the functions to test against the §7 oracle (signatures illustrative, not code to write now):

```
int  MaxHp(StatBlock s, CombatTuning t)
int  PhysicalDamage(MoveDef m, Combatant attacker, Combatant defender, CombatTuning t)
int  MagicDamage   (MoveDef m, Combatant attacker, Combatant defender, CombatTuning t)
int  HealAmount    (MoveDef m, Combatant caster, CombatTuning t)
int  ResistPct     (Combatant defender, CombatTuning t)
int  DodgePct      (Combatant attacker, Combatant defender, CombatTuning t)
bool RollDodge     (int dodgePct, Random rng)
List<Combatant> InitiativeOrder(IEnumerable<Combatant> living)   // §1.7
```

---

## 6. Win / lose and edge cases

**Win/lose check** runs at END (step 4), after all resolutions:

- **Boss CurrentHp ≤ 0** → `Won` (viewers win).
- **All living viewers' CurrentHp ≤ 0** (no viewer alive) → `Lost` (streamer/boss wins).
- Both true in the same round → see *simultaneous death* below.

Edge cases, decided:

1. **Simultaneous death (boss and last viewer die same round).** Resolution is strictly ordered
   (§1.7), so deaths happen at distinct moments, not literally simultaneously. We check win/lose
   **once, at END, after the full ordered resolution**. If by END both the boss is dead and no viewer
   is alive, **viewers win** (boss dying is the victory condition; we resolve the ambiguity in the
   players' favor — kinder for the small-stream party, and "you killed the boss" reads better than "you
   both lost"). Decision: **boss-death wins ties.**

2. **A combatant dies mid-round before acting.** If a combatant is killed by an earlier-initiative
   action, it does **not** get to act when its turn comes — its locked action is discarded. (Dead men
   cast no Fireballs.)

3. **Taunt + AOE.** Single-target boss moves redirect to the Tank; **AOE (EnemyAll) boss moves ignore
   taunt** and hit everyone including the Tank (§3.2). This is the intended counter-play: taunt walls
   single-target, AOE punishes stacking.

4. **Taunting Tank dies.** Taunt status is cleared the instant the Tank dies; a boss single-target
   move resolving after that hits its original target (or, if the boss had no other valid target,
   the boss's default-target rule applies, §2.3).

5. **Overheal.** Healing is clamped: `CurrentHp = min(MaxHp, CurrentHp + HealAmount)`. Excess is
   discarded (no shields/temp HP for alpha). Healing a full-HP ally is legal but wasteful; healing a
   **dead** ally does nothing (no resurrection in alpha — dead is dead; flag in UI so viewers don't
   waste a heal). Decision: **Heal cannot target a dead ally** (it is an invalid target; the move
   defaults per §2.3 if it was the only target).

6. **Dodge vs guaranteed effects.** Dodge only applies to moves whose `Effect` is
   `PhysicalDamage` / `MagicDamage` (attacks). Moves with `Heal`, `ApplyTaunt`, `SelfHeal` are
   **guaranteed** — they cannot be dodged (you cannot dodge a heal or a self-buff). A dodged attack
   deals 0 and applies no rider. (Alpha has no damage-move riders, but the rule is stated for when
   they exist.)

7. **0 viewers.** Match does not start (§4.4).

8. **Self-targeting.** `SelfOnly` (Brace, Taunt) and `AllyOne` targeting self (Healer self-heal) are
   legal. The boss is never a valid `Ally` target for viewers and viewers are never `Ally` for the
   boss.

9. **Targeting a dead enemy/ally at resolve.** If the locked target died earlier this round, the
   action re-targets per its rule: single-target attacks → boss (for viewers) or boss's default victim
   (for boss); if no valid target, the action is skipped.

---

## 7. Worked example — one full round (3-person party vs The Warden)

**Setup (fight start, activeMembers = 3 → Boss HP = 120 + 160*3 = 600):**

| Combatant | STR/INT/DEX/CON | MaxHP | CurrentHP (start of this round) |
|---|---|---:|---:|
| Boss "Warden" | 14/8/6/18 | 600 | 600 |
| Tank (seat 0) | 10/6/7/14 | 152 | 152 |
| Mage (seat 1) | 6/14/9/7 | 96 | 96 |
| Healer (seat 2) | 7/12/8/9 | 112 | 100 (took chip earlier) |

Precomputed resist: Boss 14.4%, Tank 11.2%, Mage 0% (5.6→ but RESIST_PER_CON*7=5.6%, so Mage = 5.6%),
Healer 7.2%. (Correction: Mage CON 7 → 5.6% resist, not 0 — using the formula honestly.)

**LOCK-IN (everyone submits):**
- Tank → **Taunt** (Self)
- Mage → **Fireball** → Boss
- Healer → **Heal** → Healer (self, 100/112)
- Boss (streamer) → **Crushing Blow** → Mage  *(streamer wants the squishy Mage dead)*

**INITIATIVE (DEX desc; players before boss on tie):**
Mage DEX 9 → Healer DEX 8 → Tank DEX 7 → Boss DEX 6.
Order: **Mage, Healer, Tank, Boss.**

**RESOLVE, in order:**

1. **Mage — Fireball → Boss.** Magic dmg = `20 + 14*1.5 = 41` raw. Boss resist 14.4% →
   `floor(41 * 0.856) = floor(35.09) = 35`. Dodge: contested, AttackerDEX 9 vs DefenderDEX(boss) 6 →
   delta = 6−9 = −3 → DodgePct = clamp(5 + (−3*1.5), 0, 40) = clamp(0.5) = **0.5%** (effectively never;
   assume not dodged). **Boss 600 → 565.**

2. **Healer — Heal → self.** Heal = `16 + 12*1.5 = 34`. Healer 100 → min(112, 134) = **112** (capped,
   22 overheal discarded). Heals are guaranteed (no dodge).

3. **Tank — Taunt.** Applies `Taunted{ by=Tank, rounds=2 }` to the Boss. No damage. Guaranteed.

4. **Boss — Crushing Blow → Mage.** Boss is now **Taunted** and Crushing Blow is single-target →
   **force-retargeted onto the Tank.** Phys dmg = `18 + 14*1.5 = 39` raw. Tank resist 11.2% →
   `floor(39 * 0.888) = floor(34.6) = 34`. Dodge: AttackerDEX(boss) 6 vs DefenderDEX(tank) 7 → delta
   = 7−6 = +1 → DodgePct = clamp(5 + 1.5,0,40) = **6.5%** (roll, assume not dodged). **Tank 152 → 118.**
   The Mage is untouched — taunt did its job.

**END:**
- Win/lose check: Boss 565 > 0, viewers alive → continue.
- Cooldowns tick: Fireball cd0 (still ready), Heal cd0 (ready), Taunt set to 2 at resolve → END
  decrements to **1** (Tank cannot re-taunt next round — there's the deliberate gap). Crushing Blow cd0.
- Status tick: Boss `TauntRoundsRemaining` 2 → **1** (still taunted through the next round's boss
  single-target action).
- RoundNumber += 1.

**End-of-round HP:** Boss **565**, Tank **118**, Mage **96**, Healer **112**.

This is the deterministic oracle (with dodge rolls treated as "not dodged" given the sub-7% chances).
A unit test should seed the RNG so the three dodge checks resolve to "no dodge" and assert exactly
these HP totals and the taunt redirect.

---

## 8. Balance decisions least certain — validate in playtest

1. **Taunt uptime (rounds = 2, cooldown = 2).** This yields a protect-round / gap-round rhythm. If the
   boss (esp. Crushing Blow into the Mage on the gap round) over-punishes, drop Taunt cooldown to 1 for
   near-permanent single-target lockout. If taunt instead makes the boss feel toothless, the lever is
   the boss's **Quake** cooldown (cd2 → cd1) so AOE pressure rises. This is the single most important
   knob for whether "Fight Me" feels fair.

2. **Boss HP scaling slope (HpBase 120 + 160/member).** The 8→13 round drift across 1→4 players is a
   guess at "every viewer should matter without dragging the fight out." If 4-player fights feel long,
   lower `HpPerMember` to ~130; if solo melts the boss, raise `HpBase`. Needs real round-count data
   from the first multi-bot test.

3. **Mage burst (Fireball 41, cd0) vs Mage fragility (96 HP, 5.6% resist).** Fireball with no cooldown
   is the party's main DPS; the balancing counterweight is that the Mage dies to ~3 Quakes / 2 untaunted
   Crushing Blows. If the Mage feels like a must-pick (too dominant) the lever is Fireball basePower
   (20→16) or adding a cd1; if the Mage just dies and contributes nothing, nudge Mage CON up (7→8) or
   widen taunt uptime. Watching whether the Tank can actually keep the Mage alive is the key playtest
   read.

---

## 9. Deferred hooks (named, not designed)

- `CostType`/`CostAmount` fields exist but are `None`/`0` — wired for a future mana/energy system.
- `Scaling` is a single stat; a future `ScalingMultiplier` float could allow per-move scaling weights.
- Resistance is untyped; a future `school` on moves + typed resist enables physical/magic split.
- No XP/level/loot/gear: `Combatant.Stats` is copied from the def at fight start, leaving an obvious
  seam to later layer gear/level modifiers onto the StatBlock before MaxHp is computed.
- AOE moves are authored as `EnemyAll`/`AllyAll` today (single boss) so multi-enemy content "just works".
