namespace TotalPartyKrawl.Combat;

/// <summary>
/// Runtime state for one fighter (boss or seated viewer). Pure C#, never
/// serialized to a Resource (spec §5.7). The runtime never mutates content defs.
/// </summary>
public sealed class Combatant
{
    public required string Id { get; init; }
    public required bool IsBoss { get; init; }

    /// <summary>Tie-break key; boss = -1 (spec §1.7, §5.7).</summary>
    public required int SeatIndex { get; init; }

    /// <summary>Class id (viewers) or boss id. Flavor/lookup only.</summary>
    public string DefId { get; init; } = string.Empty;

    public required StatBlock Stats { get; init; }

    public int MaxHp { get; set; }
    public int CurrentHp { get; set; }

    public bool IsAlive => CurrentHp > 0;

    /// <summary>Remaining cooldown rounds per move id. Absent / 0 = ready.</summary>
    public Dictionary<string, int> Cooldowns { get; } = new();

    // This round's submission.
    public string? LockedMoveId { get; set; }
    public string? LockedTargetId { get; set; }

    /// <summary>Boss-only taunt status (spec §5.7 BossStatus).</summary>
    public string? TauntedByTankId { get; set; }
    public int TauntRoundsRemaining { get; set; }

    public bool IsTaunted => TauntedByTankId is not null && TauntRoundsRemaining > 0;

    public bool IsOnCooldown(string moveId) =>
        Cooldowns.TryGetValue(moveId, out int rem) && rem > 0;

    public void ClearLock()
    {
        LockedMoveId = null;
        LockedTargetId = null;
    }
}
