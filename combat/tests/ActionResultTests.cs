using Xunit;

namespace TotalPartyKrawl.Combat.Tests;

/// <summary>
/// Locks the structured <see cref="ActionResult"/> output that the Godot view layer
/// animates. Reuses the spec §7 worked round so the amounts line up with the oracle.
/// </summary>
public sealed class ActionResultTests
{
    private static CombatEngine BuildSec7Fight(out CombatState state)
    {
        var moves = DefaultContent.Moves();
        var classes = DefaultContent.Classes();
        var boss = DefaultContent.Warden();
        var tuning = DefaultContent.Tuning();

        var party = new (string, int, string)[]
        {
            (DefaultContent.ClassTank, 0, "Tank"),
            (DefaultContent.ClassMage, 1, "Mage"),
            (DefaultContent.ClassHealer, 2, "Healer"),
        };

        var engine = CombatEngine.CreateFight(party, classes, boss, moves, tuning, FixedRng.NeverDodge);
        state = engine.State;
        state.ById("Healer")!.CurrentHp = 100;
        return engine;
    }

    [Fact]
    public void Sec7_Results_AreInInitiativeOrder_WithCorrectKindsAndAmounts()
    {
        var engine = BuildSec7Fight(out _);
        engine.SubmitLock("Tank", DefaultContent.TankTaunt, "Tank");
        engine.SubmitLock("Mage", DefaultContent.MageFireball, "boss");
        engine.SubmitLock("Healer", DefaultContent.HealerHeal, "Healer");
        engine.SubmitLock("boss", DefaultContent.BossCrushingBlow, "Mage");

        engine.ResolveRound();
        var r = engine.LastRoundResults;

        // Initiative: Mage(9) → Healer(8) → Tank(7) → Boss(6).
        Assert.Equal(4, r.Count);

        Assert.Equal("Mage", r[0].ActorId);
        Assert.Equal(ActionResultKind.Damage, r[0].Kind);
        Assert.Equal(35, r[0].Amount);            // Fireball 41 → 14.4% resist → 35
        Assert.Equal("boss", r[0].TargetId);

        Assert.Equal("Healer", r[1].ActorId);
        Assert.Equal(ActionResultKind.Heal, r[1].Kind);
        Assert.Equal(12, r[1].Amount);            // 100 → 112 capped → effective 12

        Assert.Equal("Tank", r[2].ActorId);
        Assert.Equal(ActionResultKind.Taunt, r[2].Kind);

        Assert.Equal("boss", r[3].ActorId);
        Assert.Equal(ActionResultKind.Damage, r[3].Kind);
        Assert.Equal(34, r[3].Amount);            // Crushing Blow 39 → 11.2% → 34
    }

    [Fact]
    public void Sec7_BossCrushingBlow_IsRedirectedOntoTank()
    {
        var engine = BuildSec7Fight(out _);
        engine.SubmitLock("Tank", DefaultContent.TankTaunt, "Tank");
        engine.SubmitLock("Mage", DefaultContent.MageFireball, "boss");
        engine.SubmitLock("Healer", DefaultContent.HealerHeal, "Healer");
        engine.SubmitLock("boss", DefaultContent.BossCrushingBlow, "Mage"); // aimed at Mage

        engine.ResolveRound();
        var bossResult = System.Linq.Enumerable.Single(engine.LastRoundResults, x => x.ActorId == "boss");

        Assert.True(bossResult.WasRedirected);
        Assert.Equal("Tank", bossResult.TargetId);   // landed on the Tank, not the Mage
        Assert.False(bossResult.WasDodged);
    }
}
