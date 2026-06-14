namespace TotalPartyKrawl.Combat;

/// <summary>A decided action: which move and (optionally) which target id.</summary>
public readonly record struct MoveChoice(string MoveId, string? TargetId);

/// <summary>
/// Decides one combatant's action for a round. Implementations must produce the
/// SAME data shape a real viewer submission would (spec §2.2) so the resolve path
/// is identical online and offline.
/// </summary>
public interface IMoveDecider
{
    MoveChoice Decide(Combatant self, CombatState state, IReadOnlyDictionary<string, MoveDef> moves);
}

/// <summary>
/// Sensible viewer bot (per the task brief):
///  - Healer: heal the lowest-HP hurt ally (incl. self) if anyone is hurt, else Basic Attack the boss.
///  - Tank: Taunt when off cooldown, else Shield Bash (else Basic Attack).
///  - Mage: Fireball.
///  - Fallback: Basic Attack the boss.
/// Respects cooldowns; never returns a move that is currently on cooldown.
/// </summary>
public sealed class ViewerBot : IMoveDecider
{
    public MoveChoice Decide(Combatant self, CombatState state, IReadOnlyDictionary<string, MoveDef> moves)
    {
        bool Ready(string id) => !self.IsOnCooldown(id);

        switch (self.DefId)
        {
            case DefaultContent.ClassHealer:
            {
                // A lone-surviving Healer commits to damage: with no allies to protect,
                // self-heal-locking only delays an unwinnable DPS race (and, against the
                // boss's Brace, can deadlock the fight). Otherwise heal the lowest ally
                // when someone is meaningfully hurt (< 60% max); topping off chip damage
                // wastes a turn. Tunable via HealThreshold.
                const double HealThreshold = 0.60;
                bool lastAlive = state.LivingViewers.Count() <= 1;
                if (!lastAlive)
                {
                    var hurt = state.LivingViewers
                        .Where(v => v.CurrentHp < v.MaxHp * HealThreshold)
                        .OrderBy(v => v.CurrentHp)
                        .FirstOrDefault();
                    if (hurt is not null && Ready(DefaultContent.HealerHeal))
                        return new MoveChoice(DefaultContent.HealerHeal, hurt.Id);
                }
                return new MoveChoice(DefaultContent.BasicAttack, state.Boss.Id);
            }

            case DefaultContent.ClassTank:
            {
                if (Ready(DefaultContent.TankTaunt))
                    return new MoveChoice(DefaultContent.TankTaunt, self.Id);
                if (Ready(DefaultContent.TankShieldBash))
                    return new MoveChoice(DefaultContent.TankShieldBash, state.Boss.Id);
                return new MoveChoice(DefaultContent.BasicAttack, state.Boss.Id);
            }

            case DefaultContent.ClassMage:
            {
                if (Ready(DefaultContent.MageFireball))
                    return new MoveChoice(DefaultContent.MageFireball, state.Boss.Id);
                return new MoveChoice(DefaultContent.BasicAttack, state.Boss.Id);
            }

            default:
                return new MoveChoice(DefaultContent.BasicAttack, state.Boss.Id);
        }
    }
}

/// <summary>
/// The boss bot (spec §4.2 offline rule):
///   Quake when ≥2 viewers alive and Quake is up;
///   else Crushing Blow on the lowest-HP viewer;
///   else Brace when boss &lt; 40% HP and Brace is up.
/// (Crushing Blow has no cooldown so it is always a valid fallback; Brace only
///  pre-empts when the boss is hurt and Quake is unavailable.)
/// </summary>
public sealed class BossBot : IMoveDecider
{
    public MoveChoice Decide(Combatant self, CombatState state, IReadOnlyDictionary<string, MoveDef> moves)
    {
        bool Ready(string id) => !self.IsOnCooldown(id);
        int aliveViewers = state.LivingViewers.Count();

        if (aliveViewers >= 2 && Ready(DefaultContent.BossQuake))
            return new MoveChoice(DefaultContent.BossQuake, null);

        bool hurt = self.CurrentHp < self.MaxHp * 0.40;
        if (hurt && Ready(DefaultContent.BossBrace))
            return new MoveChoice(DefaultContent.BossBrace, self.Id);

        var victim = state.LivingViewers.OrderBy(v => v.CurrentHp).ThenBy(v => v.SeatIndex).FirstOrDefault();
        return new MoveChoice(DefaultContent.BossCrushingBlow, victim?.Id);
    }
}
