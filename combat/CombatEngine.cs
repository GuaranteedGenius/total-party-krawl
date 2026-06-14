namespace TotalPartyKrawl.Combat;

/// <summary>
/// The round engine (spec §2 turn structure, §1.7 initiative, §2.4 cooldowns,
/// §3.2 taunt, §6 win/lose + edge cases). All math is delegated to
/// <see cref="CombatMath"/>. RNG (dodge only) is injected so fights are seedable.
/// </summary>
public sealed class CombatEngine
{
    private readonly IReadOnlyDictionary<string, MoveDef> _moves;
    private readonly CombatTuning _tuning;
    private readonly Random _rng;
    private readonly CombatLog? _log;

    public CombatState State { get; }

    public CombatEngine(
        CombatState state,
        IReadOnlyDictionary<string, MoveDef> moves,
        CombatTuning tuning,
        Random rng,
        CombatLog? log = null)
    {
        State = state;
        _moves = moves;
        _tuning = tuning;
        _rng = rng;
        _log = log;
    }

    private MoveDef Move(string id) => _moves[id];

    private void Log(string text) => _log?.Add(State.RoundNumber, text);

    // ---------------------------------------------------------------- factory

    /// <summary>
    /// Build a fight from content. Viewers are (classId, seatIndex, id) tuples;
    /// boss HP is derived from activeMembers (= viewer count, min 1) at start (spec §4.3/§4.4).
    /// Throws if there are 0 viewers (the match must not start, spec §4.4).
    /// </summary>
    public static CombatEngine CreateFight(
        IReadOnlyList<(string ClassId, int SeatIndex, string Id)> party,
        IReadOnlyDictionary<string, ClassDef> classes,
        BossDef boss,
        IReadOnlyDictionary<string, MoveDef> moves,
        CombatTuning tuning,
        Random rng,
        CombatLog? log = null)
    {
        if (party.Count == 0)
            throw new InvalidOperationException("Cannot start a fight with 0 viewers (spec §4.4).");

        var state = new CombatState { ActiveMembersAtStart = party.Count };

        var bossC = new Combatant
        {
            Id = "boss", IsBoss = true, SeatIndex = -1, DefId = boss.Id,
            Stats = boss.BaseStats,
        };
        bossC.MaxHp = boss.MaxHp(party.Count);
        bossC.CurrentHp = bossC.MaxHp;
        state.Combatants.Add(bossC);

        foreach (var (classId, seat, id) in party)
        {
            var def = classes[classId];
            var c = new Combatant
            {
                Id = id, IsBoss = false, SeatIndex = seat, DefId = classId,
                Stats = def.BaseStats,
            };
            c.MaxHp = CombatMath.MaxHp(def.BaseStats, tuning);
            c.CurrentHp = c.MaxHp;
            state.Combatants.Add(c);
        }

        return new CombatEngine(state, moves, tuning, rng, log);
    }

    // ---------------------------------------------------------------- lock-in

    /// <summary>Submit / overwrite a combatant's locked action for this round (spec §2.2).</summary>
    public void SubmitLock(string combatantId, string moveId, string? targetId)
    {
        var c = State.ById(combatantId)
            ?? throw new ArgumentException($"No combatant '{combatantId}'");
        c.LockedMoveId = moveId;
        c.LockedTargetId = targetId;
    }

    // ---------------------------------------------------------------- resolve

    /// <summary>
    /// Resolve one full round: initiative → ordered resolution → END
    /// (win/lose, cooldown + status tick, round++). Returns the resulting phase.
    /// </summary>
    public Phase ResolveRound()
    {
        State.Phase = Phase.Resolve;

        // §1.7 — initiative over ALL combatants (dead are skipped at act time).
        var order = CombatMath.InitiativeOrder(State.Combatants);

        foreach (var actor in order)
        {
            if (!actor.IsAlive)
                continue; // §6.2 — dead combatants don't act; locked action discarded.

            ResolveAction(actor);

            // A resolution may end the fight (boss dead). We still finish the ordered
            // pass — win/lose is checked once at END (spec §6.1) — but skip further
            // acts cleanly since dead actors are guarded above.
        }

        return EndRound();
    }

    private void ResolveAction(Combatant actor)
    {
        var (move, target) = ResolveMoveAndTarget(actor);

        if (move is null)
        {
            Log($"{Name(actor)} has no valid action and skips.");
            return;
        }

        switch (move.Effect)
        {
            case EffectKind.PhysicalDamage:
            case EffectKind.MagicDamage:
                if (move.Target == TargetRule.EnemyAll)
                    ResolveAoeDamage(actor, move);
                else
                    ResolveSingleDamage(actor, move, target!);
                break;

            case EffectKind.Heal:
                if (move.Target == TargetRule.AllyAll)
                    ResolveAoeHeal(actor, move);
                else
                    ResolveSingleHeal(actor, move, target!);
                break;

            case EffectKind.SelfHeal:
                ResolveSelfHeal(actor, move);
                break;

            case EffectKind.ApplyTaunt:
                ResolveTaunt(actor, move);
                break;
        }

        // §2.4 — set cooldown to N at RESOLVE; END decrements to N-1.
        if (move.Cooldown > 0)
            actor.Cooldowns[move.Id] = move.Cooldown;
    }

    /// <summary>
    /// Pick the move + concrete target for an actor, applying defaults (§2.3),
    /// taunt redirect (§3.2), and dead-target retargeting (§6.9).
    /// Returns (null, null) if the actor should skip.
    /// </summary>
    private (MoveDef? move, Combatant? target) ResolveMoveAndTarget(Combatant actor)
    {
        MoveDef? move = null;

        // Use the locked move if it's known and off cooldown; else default (§2.3).
        if (actor.LockedMoveId is not null
            && _moves.TryGetValue(actor.LockedMoveId, out var locked)
            && !actor.IsOnCooldown(locked.Id))
        {
            move = locked;
        }

        if (move is null)
        {
            // Default action (spec §2.3).
            move = actor.IsBoss ? Move(DefaultBossMoveId()) : Move(DefaultViewerMoveId(actor));
        }

        var target = PickTarget(actor, move);

        // §2.3 / §6.9 — if the chosen move has no valid target, try the default
        // single-target attack; if still none, skip.
        if (NeedsTarget(move) && target is null)
        {
            if (!actor.IsBoss && move.Id != DefaultViewerMoveId(actor))
            {
                move = Move(DefaultViewerMoveId(actor));
                target = PickTarget(actor, move);
            }
            else if (actor.IsBoss && move.Id != DefaultBossMoveId())
            {
                move = Move(DefaultBossMoveId());
                target = PickTarget(actor, move);
            }

            if (NeedsTarget(move) && target is null)
                return (null, null); // degenerate state → skip (§2.3).
        }

        return (move, target);
    }

    private static bool NeedsTarget(MoveDef m) =>
        m.Target is TargetRule.EnemyOne or TargetRule.AllyOne;

    private static string DefaultViewerMoveId(Combatant _) => DefaultContent.BasicAttack;
    private static string DefaultBossMoveId() => DefaultContent.BossCrushingBlow;

    /// <summary>
    /// Resolve a single concrete target for the move, honoring taunt redirect and
    /// dead-target fallback. Null for self/AOE moves (handled separately) only when
    /// no target is needed.
    /// </summary>
    private Combatant? PickTarget(Combatant actor, MoveDef move)
    {
        switch (move.Target)
        {
            case TargetRule.SelfOnly:
                return actor;

            case TargetRule.AllyAll:
            case TargetRule.EnemyAll:
                return null; // resolved across the group, no single target

            case TargetRule.EnemyOne:
                return PickEnemyTarget(actor, move);

            case TargetRule.AllyOne:
                return PickAllyTarget(actor);
        }
        return null;
    }

    private Combatant? PickEnemyTarget(Combatant actor, MoveDef move)
    {
        if (actor.IsBoss)
        {
            // §3.2 taunt redirect: a living taunting Tank pulls single-target boss moves.
            var boss = actor;
            if (boss.IsTaunted)
            {
                var tank = State.ById(boss.TauntedByTankId!);
                if (tank is { IsAlive: true })
                    return tank;
                // §3.2/§6.4 — taunting Tank dead → ignore taunt for this move.
            }

            // Boss's chosen victim (locked) if alive, else default lowest-HP viewer (§2.3).
            var locked = actor.LockedTargetId is not null ? State.ById(actor.LockedTargetId) : null;
            if (locked is { IsAlive: true } && !locked.IsBoss)
                return locked;
            return LowestHpLivingViewer();
        }

        // Viewer attacking an enemy → the boss (only enemy in Fight Me).
        var bossC = State.Boss;
        return bossC.IsAlive ? bossC : null;
    }

    private Combatant? PickAllyTarget(Combatant actor)
    {
        // Viewer heal: locked ally if alive (spec §6.5 — cannot target dead ally),
        // else default to self if alive, else lowest-HP living ally.
        if (actor.LockedTargetId is not null)
        {
            var t = State.ById(actor.LockedTargetId);
            if (t is { IsAlive: true } && !t.IsBoss)
                return t;
        }
        if (actor.IsAlive)
            return actor; // self is a valid ally (§6.8)
        return State.LivingViewers.OrderBy(v => v.CurrentHp).FirstOrDefault();
    }

    private Combatant? LowestHpLivingViewer() =>
        State.LivingViewers.OrderBy(v => v.CurrentHp).ThenBy(v => v.SeatIndex).FirstOrDefault();

    // ----------------------------------------------------------- effect appliers

    private void ResolveSingleDamage(Combatant actor, MoveDef move, Combatant target)
    {
        double dodgePct = CombatMath.DodgePctRaw(actor, target, _tuning);
        if (move.IsAttack && CombatMath.RollDodge(dodgePct, _rng))
        {
            Log($"{Name(actor)} uses {move.DisplayName} on {Name(target)} — DODGED!");
            return; // §1.6 — dodged attack deals 0, no rider.
        }

        int dmg = move.Effect == EffectKind.PhysicalDamage
            ? CombatMath.PhysicalDamage(move, actor, target, _tuning)
            : CombatMath.MagicDamage(move, actor, target, _tuning);

        ApplyDamage(target, dmg);
        Log($"{Name(actor)} uses {move.DisplayName} on {Name(target)} for {dmg} ({target.CurrentHp}/{target.MaxHp}).");
    }

    private void ResolveAoeDamage(Combatant actor, MoveDef move)
    {
        // §3.2 / §6.3 — AOE ignores taunt and hits every living enemy.
        var targets = (actor.IsBoss ? State.LivingViewers : EnemiesOf(actor)).ToList();
        foreach (var target in targets)
        {
            if (!target.IsAlive) continue;
            double dodgePct = CombatMath.DodgePctRaw(actor, target, _tuning);
            if (CombatMath.RollDodge(dodgePct, _rng))
            {
                Log($"{Name(actor)} {move.DisplayName} on {Name(target)} — DODGED!");
                continue;
            }
            int dmg = move.Effect == EffectKind.PhysicalDamage
                ? CombatMath.PhysicalDamage(move, actor, target, _tuning)
                : CombatMath.MagicDamage(move, actor, target, _tuning);
            ApplyDamage(target, dmg);
            Log($"{Name(actor)} {move.DisplayName} hits {Name(target)} for {dmg} ({target.CurrentHp}/{target.MaxHp}).");
        }
    }

    private IEnumerable<Combatant> EnemiesOf(Combatant actor) =>
        actor.IsBoss ? State.LivingViewers : new[] { State.Boss }.Where(b => b.IsAlive);

    private void ResolveSingleHeal(Combatant actor, MoveDef move, Combatant target)
    {
        int heal = CombatMath.HealAmount(move, actor, _tuning);
        ApplyHeal(target, heal);
        Log($"{Name(actor)} heals {Name(target)} for {heal} ({target.CurrentHp}/{target.MaxHp}).");
    }

    private void ResolveAoeHeal(Combatant actor, MoveDef move)
    {
        int heal = CombatMath.HealAmount(move, actor, _tuning);
        // Allies of a viewer = all living viewers (incl. self).
        var allies = State.LivingViewers.ToList();
        foreach (var ally in allies)
            ApplyHeal(ally, heal);
        Log($"{Name(actor)} {move.DisplayName} heals the party for {heal} each.");
    }

    private void ResolveSelfHeal(Combatant actor, MoveDef move)
    {
        int heal = CombatMath.HealAmount(move, actor, _tuning);
        ApplyHeal(actor, heal);
        Log($"{Name(actor)} {move.DisplayName} self-heals for {heal} ({actor.CurrentHp}/{actor.MaxHp}).");
    }

    private void ResolveTaunt(Combatant actor, MoveDef move)
    {
        var boss = State.Boss;
        boss.TauntedByTankId = actor.Id;
        boss.TauntRoundsRemaining = move.StatusRounds; // = 2 (spec §3.2)
        Log($"{Name(actor)} uses {move.DisplayName} — boss is Taunted ({move.StatusRounds} rounds).");
    }

    private static void ApplyDamage(Combatant target, int dmg)
    {
        target.CurrentHp -= dmg;
        if (target.CurrentHp < 0) target.CurrentHp = 0;
    }

    private static void ApplyHeal(Combatant target, int heal)
    {
        // §6.5 — overheal clamped; healing a dead ally is prevented at target-selection
        // time, so a live target here is guaranteed.
        target.CurrentHp = Math.Min(target.MaxHp, target.CurrentHp + heal);
    }

    // ------------------------------------------------------------------- END

    private Phase EndRound()
    {
        State.Phase = Phase.End;

        // §3.2/§6.4 — clear taunt if the tank died this round (before tick).
        var boss = State.Boss;
        if (boss.TauntedByTankId is not null)
        {
            var tank = State.ById(boss.TauntedByTankId);
            if (tank is null || !tank.IsAlive)
            {
                boss.TauntedByTankId = null;
                boss.TauntRoundsRemaining = 0;
            }
        }

        // §6.1 — win/lose check once, after the full ordered resolution.
        bool bossDead = !boss.IsAlive;
        bool partyWiped = !State.LivingViewers.Any();

        if (bossDead)
        {
            // §6.1 — boss-death wins ties (simultaneous death → viewers win).
            State.Phase = Phase.Won;
            Log("Boss defeated — VIEWERS WIN.");
            return State.Phase;
        }
        if (partyWiped)
        {
            State.Phase = Phase.Lost;
            Log("Party wiped — BOSS WINS.");
            return State.Phase;
        }

        // §2.4 — decrement cooldowns at END.
        foreach (var c in State.Combatants)
        {
            foreach (var key in c.Cooldowns.Keys.ToList())
            {
                int rem = c.Cooldowns[key] - 1;
                c.Cooldowns[key] = rem < 0 ? 0 : rem;
            }
        }

        // §2.1/§3.2 — decrement taunt duration; expire at 0.
        if (boss.TauntRoundsRemaining > 0)
        {
            boss.TauntRoundsRemaining--;
            if (boss.TauntRoundsRemaining <= 0)
                boss.TauntedByTankId = null;
        }

        // Clear locks for next round; bump round counter; back to Prompt.
        foreach (var c in State.Combatants)
            c.ClearLock();

        State.RoundNumber++;
        State.Phase = Phase.Prompt;
        return State.Phase;
    }

    private static string Name(Combatant c) => c.IsBoss ? "Boss" : c.Id;
}
