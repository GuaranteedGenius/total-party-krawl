namespace TotalPartyKrawl.Combat;

/// <summary>
/// The 4 core stats (spec §1, §5.2). A plain value type the math operates on.
/// The Godot <c>StatBlockRes</c> resource converts into this.
/// </summary>
public sealed record StatBlock(int Str, int Int, int Dex, int Con);

/// <summary>
/// A move definition (spec §5.3). Content, never mutated at runtime —
/// per-combatant cooldown state lives on <see cref="Combatant"/>.
/// </summary>
public sealed class MoveDef
{
    public required string Id { get; init; }
    public required string DisplayName { get; init; }
    public required TargetRule Target { get; init; }
    public required EffectKind Effect { get; init; }
    public int BasePower { get; init; }
    public ScalingStat Scaling { get; init; } = ScalingStat.None;
    public int Cooldown { get; init; }
    public CostType CostType { get; init; } = CostType.None;
    public int CostAmount { get; init; }

    /// <summary>For ApplyTaunt etc. Taunt = 2 (spec §3.2). Else 0.</summary>
    public int StatusRounds { get; init; }

    public string Description { get; init; } = string.Empty;

    /// <summary>True if this move can be dodged (only attacks; spec §6.6).</summary>
    public bool IsAttack => Effect is EffectKind.PhysicalDamage or EffectKind.MagicDamage;
}

/// <summary>A playable class definition (spec §5.4).</summary>
public sealed class ClassDef
{
    public required string Id { get; init; }
    public required string DisplayName { get; init; }
    public required StatBlock BaseStats { get; init; }

    /// <summary>Ordered list, includes the universal Basic Attack.</summary>
    public required IReadOnlyList<string> MoveIds { get; init; }

    public string Role { get; init; } = string.Empty;
}

/// <summary>A boss archetype definition (spec §5.5).</summary>
public sealed class BossDef
{
    public required string Id { get; init; }
    public required string DisplayName { get; init; }
    public required StatBlock BaseStats { get; init; }
    public int HpBase { get; init; }
    public int HpPerMember { get; init; }
    public required IReadOnlyList<string> MoveIds { get; init; }

    /// <summary>Boss HP = HpBase + HpPerMember * max(1, activeMembers). Spec §4.3.</summary>
    public int MaxHp(int activeMembers) => HpBase + HpPerMember * Math.Max(1, activeMembers);
}

/// <summary>
/// The single global balance block (spec §1.1, §5.6). Every tunable constant
/// lives here so balance is data, not code.
/// </summary>
public sealed class CombatTuning
{
    public int HpBase { get; init; } = 40;
    public int HpPerCon { get; init; } = 8;
    public double StrDmgPer { get; init; } = 1.5;
    public double IntDmgPer { get; init; } = 1.5;
    public double DodgePerDex { get; init; } = 1.5;
    public int DodgeBase { get; init; } = 5;
    public int DodgeCap { get; init; } = 40;
    public int DodgeFloor { get; init; } = 0;
    public double ResistPerCon { get; init; } = 0.8;
    public int ResistCap { get; init; } = 50;

    public static CombatTuning Default => new();
}
