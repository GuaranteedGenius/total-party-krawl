namespace TotalPartyKrawl.Combat;

/// <summary>Who a move can be aimed at. See spec §5.1.</summary>
public enum TargetRule
{
    SelfOnly,
    AllyOne,
    AllyAll,
    EnemyOne,
    EnemyAll,
}

/// <summary>What a move does on resolve. See spec §5.1.</summary>
public enum EffectKind
{
    PhysicalDamage,
    MagicDamage,
    Heal,
    ApplyTaunt,
    SelfHeal,
}

/// <summary>Which stat scales a move's power. See spec §5.1.</summary>
public enum ScalingStat
{
    None,
    STR,
    INT,
    DEX,
    CON,
}

/// <summary>Deferred resource cost (alpha: always None). See spec §2.4 / §5.1.</summary>
public enum CostType
{
    None,
    Mana,
    Energy,
}

/// <summary>Round phase machine. See spec §5.7 / §2.1.</summary>
public enum Phase
{
    Prompt,
    LockIn,
    Resolve,
    End,
    Won,
    Lost,
}
