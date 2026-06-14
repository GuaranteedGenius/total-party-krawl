namespace TotalPartyKrawl.Combat;

/// <summary>
/// The launch content for "Fight Me" built in code straight from the spec
/// (§3 classes + moves, §4 The Warden, §1.1 tuning). Tests and the offline sim
/// depend on this rather than Godot resource loading, so they run headless.
/// </summary>
public static class DefaultContent
{
    // ---- Move ids (stable keys) ----
    public const string BasicAttack = "basic.attack";

    public const string TankTaunt = "tank.taunt";
    public const string TankShieldBash = "tank.shield_bash";

    public const string MageFireball = "mage.fireball";
    public const string MageFlameBurst = "mage.flame_burst";

    public const string HealerHeal = "healer.heal";
    public const string HealerMend = "healer.mend";

    public const string BossCrushingBlow = "boss.crushing_blow";
    public const string BossQuake = "boss.quake";
    public const string BossBrace = "boss.brace";

    // ---- Class / boss ids ----
    public const string ClassTank = "class.tank";
    public const string ClassMage = "class.mage";
    public const string ClassHealer = "class.healer";
    public const string BossWarden = "boss.warden";

    public static CombatTuning Tuning() => CombatTuning.Default;

    /// <summary>All moves keyed by id (spec §3.0, §3.2-3.4, §4.2).</summary>
    public static IReadOnlyDictionary<string, MoveDef> Moves()
    {
        var list = new[]
        {
            // §3.0 universal Basic Attack
            new MoveDef
            {
                Id = BasicAttack, DisplayName = "Basic Attack",
                Target = TargetRule.EnemyOne, Effect = EffectKind.PhysicalDamage,
                BasePower = 4, Scaling = ScalingStat.STR, Cooldown = 0,
                Description = "A simple physical strike. No cooldown.",
            },

            // §3.2 Tank
            new MoveDef
            {
                Id = TankTaunt, DisplayName = "Taunt",
                Target = TargetRule.SelfOnly, Effect = EffectKind.ApplyTaunt,
                BasePower = 0, Scaling = ScalingStat.None, Cooldown = 2,
                StatusRounds = 2,
                Description = "Force the boss's single-target moves onto you for a round.",
            },
            new MoveDef
            {
                Id = TankShieldBash, DisplayName = "Shield Bash",
                Target = TargetRule.EnemyOne, Effect = EffectKind.PhysicalDamage,
                BasePower = 10, Scaling = ScalingStat.STR, Cooldown = 1,
                Description = "A heavy bash.",
            },

            // §3.3 Mage
            new MoveDef
            {
                Id = MageFireball, DisplayName = "Fireball",
                Target = TargetRule.EnemyOne, Effect = EffectKind.MagicDamage,
                BasePower = 20, Scaling = ScalingStat.INT, Cooldown = 0,
                Description = "Single-target magic burst.",
            },
            new MoveDef
            {
                Id = MageFlameBurst, DisplayName = "Flame Burst",
                Target = TargetRule.EnemyAll, Effect = EffectKind.MagicDamage,
                BasePower = 14, Scaling = ScalingStat.INT, Cooldown = 2,
                Description = "Magic damage to all enemies.",
            },

            // §3.4 Healer
            new MoveDef
            {
                Id = HealerHeal, DisplayName = "Heal",
                Target = TargetRule.AllyOne, Effect = EffectKind.Heal,
                BasePower = 16, Scaling = ScalingStat.INT, Cooldown = 0,
                Description = "Restore HP to one ally (may be self).",
            },
            new MoveDef
            {
                Id = HealerMend, DisplayName = "Mend",
                Target = TargetRule.AllyAll, Effect = EffectKind.Heal,
                BasePower = 8, Scaling = ScalingStat.INT, Cooldown = 3,
                Description = "Restore HP to all allies (incl. self).",
            },

            // §4.2 The Warden
            new MoveDef
            {
                Id = BossCrushingBlow, DisplayName = "Crushing Blow",
                Target = TargetRule.EnemyOne, Effect = EffectKind.PhysicalDamage,
                BasePower = 18, Scaling = ScalingStat.STR, Cooldown = 0,
                Description = "Single-target hammer. Redirected by Taunt.",
            },
            new MoveDef
            {
                Id = BossQuake, DisplayName = "Quake",
                Target = TargetRule.EnemyAll, Effect = EffectKind.PhysicalDamage,
                BasePower = 10, Scaling = ScalingStat.STR, Cooldown = 2,
                Description = "Physical damage to everyone. Ignores Taunt.",
            },
            new MoveDef
            {
                Id = BossBrace, DisplayName = "Brace",
                Target = TargetRule.SelfOnly, Effect = EffectKind.SelfHeal,
                BasePower = 12, Scaling = ScalingStat.INT, Cooldown = 3,
                Description = "Self-heal / stall.",
            },
        };
        return list.ToDictionary(m => m.Id);
    }

    /// <summary>The 3 launch classes (spec §3.1).</summary>
    public static IReadOnlyDictionary<string, ClassDef> Classes()
    {
        var list = new[]
        {
            new ClassDef
            {
                Id = ClassTank, DisplayName = "Tank", Role = "Soak + control",
                BaseStats = new StatBlock(Str: 10, Int: 6, Dex: 7, Con: 14),
                MoveIds = new[] { BasicAttack, TankTaunt, TankShieldBash },
            },
            new ClassDef
            {
                Id = ClassMage, DisplayName = "Mage", Role = "Burst",
                BaseStats = new StatBlock(Str: 6, Int: 14, Dex: 9, Con: 7),
                MoveIds = new[] { BasicAttack, MageFireball, MageFlameBurst },
            },
            new ClassDef
            {
                Id = ClassHealer, DisplayName = "Healer", Role = "Party sustain",
                BaseStats = new StatBlock(Str: 7, Int: 12, Dex: 8, Con: 9),
                MoveIds = new[] { BasicAttack, HealerHeal, HealerMend },
            },
        };
        return list.ToDictionary(c => c.Id);
    }

    /// <summary>The Warden (spec §4.1, §4.3).</summary>
    public static BossDef Warden() => new()
    {
        Id = BossWarden, DisplayName = "The Warden",
        BaseStats = new StatBlock(Str: 14, Int: 8, Dex: 6, Con: 18),
        HpBase = 120, HpPerMember = 160,
        MoveIds = new[] { BossCrushingBlow, BossQuake, BossBrace },
    };
}
