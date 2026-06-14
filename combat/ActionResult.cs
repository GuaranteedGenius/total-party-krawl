namespace TotalPartyKrawl.Combat;

/// <summary>
/// The structured outcome of a single resolved effect, emitted in initiative
/// order during <see cref="CombatEngine.ResolveRound"/>. This is the data the
/// Godot view layer animates one at a time (attacker lunge, hit flash, floating
/// number, HP-bar tween, death). Pure C# — no Godot dependency.
///
/// One <see cref="ActionResult"/> is one (actor → target, effect) pair. An AOE
/// move produces one result per target. A skipped action produces a single
/// <see cref="ActionResultKind.Skip"/> result so the view can show a beat pass.
/// </summary>
public readonly record struct ActionResult
{
    /// <summary>Acting combatant id (e.g. "Tank", "boss").</summary>
    public required string ActorId { get; init; }

    /// <summary>The move id that resolved (e.g. "mage.fireball").</summary>
    public required string MoveId { get; init; }

    /// <summary>Display name of the move, for floating callouts / log.</summary>
    public required string MoveName { get; init; }

    /// <summary>Resolved target id. Null for self/skip beats where it equals the actor.</summary>
    public string? TargetId { get; init; }

    /// <summary>What happened (damage / heal / taunt / dodge / skip).</summary>
    public required ActionResultKind Kind { get; init; }

    /// <summary>Damage dealt or HP healed (post-resist, post-clamp). 0 for taunt/dodge/skip.</summary>
    public int Amount { get; init; }

    /// <summary>True when an attack was dodged (Amount is 0, no effect applied).</summary>
    public bool WasDodged { get; init; }

    /// <summary>True when a boss single-target move was redirected onto the taunting Tank.</summary>
    public bool WasRedirected { get; init; }

    /// <summary>True when this result's target dropped to 0 HP as a direct result.</summary>
    public bool TargetDied { get; init; }

    /// <summary>Target HP after this effect (for the view to tween the bar to).</summary>
    public int TargetHpAfter { get; init; }

    /// <summary>Target max HP (so the view can size the bar without a lookup).</summary>
    public int TargetMaxHp { get; init; }
}

/// <summary>The category of an <see cref="ActionResult"/>.</summary>
public enum ActionResultKind
{
    /// <summary>Physical or magic damage landed.</summary>
    Damage,
    /// <summary>HP restored.</summary>
    Heal,
    /// <summary>Taunt status applied to the boss.</summary>
    Taunt,
    /// <summary>An attack missed (dodged): no effect.</summary>
    Dodge,
    /// <summary>The actor had no valid action and passed.</summary>
    Skip,
}
