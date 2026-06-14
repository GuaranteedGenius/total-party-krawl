namespace TotalPartyKrawl.Combat;

/// <summary>
/// Pure, side-effect-free combat formulas (spec §1, §5.8). The only randomness
/// is dodge, threaded through an injected <see cref="Random"/> so it is seedable.
/// Damage/heal are fully deterministic (no variance) — this is the unit-test oracle.
/// </summary>
public static class CombatMath
{
    /// <summary>MaxHP = HP_BASE + CON * HP_PER_CON (spec §1.2).</summary>
    public static int MaxHp(StatBlock s, CombatTuning t) =>
        t.HpBase + s.Con * t.HpPerCon;

    /// <summary>
    /// Percent damage reduction from the defender's CON (spec §1.5).
    /// Kept as a double so the downstream floor matches the worked oracle exactly
    /// (e.g. CON 18 → 14.4%, not a pre-rounded 14%).
    /// </summary>
    public static double ResistPctRaw(StatBlock s, CombatTuning t) =>
        Math.Min(t.ResistCap, s.Con * t.ResistPerCon);

    /// <summary>Integer resist percent for UI/inspection (spec §5.8 signature).</summary>
    public static int ResistPct(Combatant defender, CombatTuning t) =>
        (int)Math.Round(ResistPctRaw(defender.Stats, t));

    private static double Scale(ScalingStat stat, StatBlock s, CombatTuning t) => stat switch
    {
        ScalingStat.STR => s.Str * t.StrDmgPer,
        ScalingStat.INT => s.Int * t.IntDmgPer,
        // DEX/CON have no damage-scaling constant in alpha; treat as 0 contribution.
        ScalingStat.DEX => 0,
        ScalingStat.CON => 0,
        _ => 0,
    };

    /// <summary>
    /// Final physical damage after resistance, floored to int, min 1 (spec §1.3/§1.5).
    /// A connecting hit always does at least 1.
    /// </summary>
    public static int PhysicalDamage(MoveDef m, Combatant attacker, Combatant defender, CombatTuning t)
    {
        double raw = m.BasePower + Scale(ScalingStat.STR == m.Scaling ? ScalingStat.STR : m.Scaling, attacker.Stats, t);
        return ApplyResist(raw, defender, t);
    }

    /// <summary>Final magic damage after resistance, floored, min 1 (spec §1.4/§1.5).</summary>
    public static int MagicDamage(MoveDef m, Combatant attacker, Combatant defender, CombatTuning t)
    {
        double raw = m.BasePower + Scale(m.Scaling, attacker.Stats, t);
        return ApplyResist(raw, defender, t);
    }

    private static int ApplyResist(double raw, Combatant defender, CombatTuning t)
    {
        double pct = ResistPctRaw(defender.Stats, t);
        int final = (int)Math.Floor(raw * (1.0 - pct / 100.0));
        return Math.Max(1, final);
    }

    /// <summary>
    /// Heal amount (spec §1.4). NOT reduced by resistance. Floored to int.
    /// Overheal clamping is the caller's responsibility (spec §6.5).
    /// </summary>
    public static int HealAmount(MoveDef m, Combatant caster, CombatTuning t)
    {
        double raw = m.BasePower + Scale(m.Scaling, caster.Stats, t);
        return (int)Math.Floor(raw);
    }

    /// <summary>
    /// Contested dodge percent: defender DEX vs attacker DEX, clamped (spec §1.6).
    /// Returned as a double to preserve fractional values (e.g. 0.5%, 6.5%).
    /// </summary>
    public static double DodgePctRaw(Combatant attacker, Combatant defender, CombatTuning t)
    {
        int dexDelta = defender.Stats.Dex - attacker.Stats.Dex;
        double pct = t.DodgeBase + dexDelta * t.DodgePerDex;
        return Math.Clamp(pct, t.DodgeFloor, t.DodgeCap);
    }

    /// <summary>Integer dodge percent for UI (spec §5.8 signature).</summary>
    public static int DodgePct(Combatant attacker, Combatant defender, CombatTuning t) =>
        (int)Math.Round(DodgePctRaw(attacker, defender, t));

    /// <summary>
    /// Roll the single dodge check (spec §1.6): roll = Random*100 in [0,100),
    /// dodged when roll &lt; dodgePct. One Random draw per attack so tests can seed it.
    /// </summary>
    public static bool RollDodge(double dodgePct, Random rng)
    {
        double roll = rng.NextDouble() * 100.0;
        return roll < dodgePct;
    }

    /// <summary>
    /// Initiative order (spec §1.7): DEX desc, then players-before-boss on tie,
    /// then seat index asc, then id asc. Stable and deterministic.
    /// </summary>
    public static List<Combatant> InitiativeOrder(IEnumerable<Combatant> combatants) =>
        combatants
            .OrderByDescending(c => c.Stats.Dex)
            .ThenBy(c => c.IsBoss)            // false (players) sorts before true (boss)
            .ThenBy(c => c.SeatIndex)
            .ThenBy(c => c.Id, StringComparer.Ordinal)
            .ToList();
}
