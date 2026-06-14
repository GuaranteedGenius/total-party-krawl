using Xunit;

namespace TotalPartyKrawl.Combat.Tests;

/// <summary>Pure-formula unit tests (spec §1, §5.8).</summary>
public sealed class FormulaTests
{
    private static readonly CombatTuning T = CombatTuning.Default;

    private static Combatant Make(int str, int @int, int dex, int con, bool boss = false, int seat = 0, string id = "c")
    {
        var stats = new StatBlock(str, @int, dex, con);
        var c = new Combatant { Id = id, IsBoss = boss, SeatIndex = seat, Stats = stats };
        c.MaxHp = CombatMath.MaxHp(stats, T);
        c.CurrentHp = c.MaxHp;
        return c;
    }

    [Theory]
    [InlineData(14, 152)] // Tank
    [InlineData(6, 88)]   // CON 6
    [InlineData(7, 96)]   // Mage
    [InlineData(9, 112)]  // Healer
    [InlineData(0, 40)]   // floor: 0-CON not one-shot
    public void MaxHp_IsBasePlusConTerm(int con, int expected)
    {
        Assert.Equal(expected, CombatMath.MaxHp(new StatBlock(0, 0, 0, con), T));
    }

    [Fact]
    public void PhysicalDamage_AppliesResistAndFloors()
    {
        // Crushing Blow (18 + STR14*1.5 = 39) into Tank (CON14 → 11.2%) → floor(34.6) = 34.
        var move = DefaultContent.Moves()[DefaultContent.BossCrushingBlow];
        var boss = Make(14, 8, 6, 18, boss: true, seat: -1, id: "boss");
        var tank = Make(10, 6, 7, 14, id: "Tank");
        Assert.Equal(34, CombatMath.PhysicalDamage(move, boss, tank, T));
    }

    [Fact]
    public void MagicDamage_AppliesResistAndFloors()
    {
        // Fireball (20 + INT14*1.5 = 41) into Boss (CON18 → 14.4%) → floor(35.09) = 35.
        var move = DefaultContent.Moves()[DefaultContent.MageFireball];
        var mage = Make(6, 14, 9, 7, id: "Mage");
        var boss = Make(14, 8, 6, 18, boss: true, seat: -1, id: "boss");
        Assert.Equal(35, CombatMath.MagicDamage(move, mage, boss, T));
    }

    [Fact]
    public void Damage_FloorsToMinimumOne()
    {
        // A weak hit into a hypothetical 50%-resist wall still does >= 1.
        var weak = new MoveDef
        {
            Id = "weak", DisplayName = "Weak", Target = TargetRule.EnemyOne,
            Effect = EffectKind.PhysicalDamage, BasePower = 1, Scaling = ScalingStat.None,
        };
        var attacker = Make(0, 0, 0, 0, id: "a");
        var wall = Make(0, 0, 0, 100, id: "w"); // CON100 → capped at 50% resist
        Assert.Equal(1, CombatMath.PhysicalDamage(weak, attacker, wall, T));
    }

    [Fact]
    public void Heal_IsNotReducedByResistance()
    {
        // Heal 16 + INT12*1.5 = 34; resistance never applies to healing.
        var heal = DefaultContent.Moves()[DefaultContent.HealerHeal];
        var healer = Make(7, 12, 8, 9, id: "Healer");
        Assert.Equal(34, CombatMath.HealAmount(heal, healer, T));
    }

    [Fact]
    public void ResistPct_CapsAt50()
    {
        var huge = Make(0, 0, 0, 200, id: "h");
        Assert.Equal(50, CombatMath.ResistPct(huge, T));
    }

    [Fact]
    public void DodgePct_CapsAtFortyWhenDefenderMuchFaster()
    {
        var attacker = Make(0, 0, 8, 0, id: "slow");
        var defender = Make(0, 0, 30, 0, id: "fast");
        // delta +22 → 5 + 33 = 38? clamp; actually 5 + 22*1.5 = 38 < 40. Push higher:
        var faster = Make(0, 0, 40, 0, id: "faster"); // delta +32 → 5 + 48 = 53 → cap 40.
        Assert.Equal(40, CombatMath.DodgePctRaw(attacker, faster, T));
        Assert.Equal(38, CombatMath.DodgePctRaw(attacker, defender, T));
    }

    [Fact]
    public void DodgePct_FloorZero_WhenAttackerMuchFaster()
    {
        var attacker = Make(0, 0, 16, 0, id: "att");
        var defender = Make(0, 0, 12, 0, id: "def");
        // delta = 12 - 16 = -4 → 5 + (-6) = -1 → clamp to 0.
        Assert.Equal(0, CombatMath.DodgePctRaw(attacker, defender, T));
    }

    [Fact]
    public void DodgePct_BaseFiveWhenEqualDex()
    {
        var a = Make(0, 0, 10, 0, id: "a");
        var b = Make(0, 0, 10, 0, id: "b");
        Assert.Equal(5, CombatMath.DodgePctRaw(a, b, T));
    }

    [Fact]
    public void DodgePct_PositiveDeltaScalesByOnePointFive()
    {
        var attacker = Make(0, 0, 8, 0, id: "att");
        var defender = Make(0, 0, 12, 0, id: "def");
        // delta +4 → 5 + 6 = 11.
        Assert.Equal(11, CombatMath.DodgePctRaw(attacker, defender, T));
    }

    [Fact]
    public void RollDodge_BoundaryBehaviour()
    {
        Assert.True(CombatMath.RollDodge(11, new FixedRng(0.10)));   // roll 10 < 11
        Assert.False(CombatMath.RollDodge(11, new FixedRng(0.11)));  // roll 11 not < 11
        Assert.False(CombatMath.RollDodge(0, new FixedRng(0.0)));    // 0% can never dodge
    }

    [Fact]
    public void InitiativeOrder_DexDescending_PlayersBeforeBossOnTie()
    {
        var mage = Make(0, 0, 9, 0, id: "Mage", seat: 1);
        var healer = Make(0, 0, 8, 0, id: "Healer", seat: 2);
        var tank = Make(0, 0, 7, 0, id: "Tank", seat: 0);
        var boss = Make(0, 0, 6, 0, boss: true, seat: -1, id: "boss");

        var order = CombatMath.InitiativeOrder(new[] { boss, tank, mage, healer });
        Assert.Equal(new[] { "Mage", "Healer", "Tank", "boss" }, order.Select(c => c.Id).ToArray());
    }

    [Fact]
    public void InitiativeOrder_PlayerActsBeforeBossWhenDexTied()
    {
        var player = Make(0, 0, 6, 0, id: "P", seat: 0);
        var boss = Make(0, 0, 6, 0, boss: true, seat: -1, id: "boss");
        var order = CombatMath.InitiativeOrder(new[] { boss, player });
        Assert.Equal("P", order[0].Id);   // players before boss on DEX tie (spec §1.7)
        Assert.Equal("boss", order[1].Id);
    }

    [Fact]
    public void InitiativeOrder_LowerSeatActsFirstOnPlayerTie()
    {
        var a = Make(0, 0, 9, 0, id: "A", seat: 3);
        var b = Make(0, 0, 9, 0, id: "B", seat: 1);
        var order = CombatMath.InitiativeOrder(new[] { a, b });
        Assert.Equal("B", order[0].Id); // lower seat first
    }
}
