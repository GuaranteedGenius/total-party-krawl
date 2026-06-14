using Xunit;

namespace TotalPartyKrawl.Combat.Tests;

/// <summary>
/// The spec §7 worked round, used as an exact oracle. Three-person party
/// (Tank/Mage/Healer) vs The Warden (Boss HP 600). With dodge seeded to "never",
/// one round of the §7 lock-ins must produce the exact end HP totals and the
/// taunt redirect (Crushing Blow hits the Tank, not the Mage).
/// </summary>
public sealed class WorkedRoundOracleTests
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

        var engine = CombatEngine.CreateFight(party, classes, boss, moves, tuning,
            FixedRng.NeverDodge);
        state = engine.State;

        // §7 setup: Boss HP 600 (3 members), Healer started at 100/112 (took chip earlier).
        Assert.Equal(600, state.Boss.MaxHp);
        Assert.Equal(600, state.Boss.CurrentHp);
        state.ById("Healer")!.CurrentHp = 100;

        return engine;
    }

    [Fact]
    public void Sec7_WorkedRound_ProducesExactEndState()
    {
        var engine = BuildSec7Fight(out var state);

        // §7 lock-ins.
        engine.SubmitLock("Tank", DefaultContent.TankTaunt, "Tank");
        engine.SubmitLock("Mage", DefaultContent.MageFireball, "boss");
        engine.SubmitLock("Healer", DefaultContent.HealerHeal, "Healer");
        engine.SubmitLock("boss", DefaultContent.BossCrushingBlow, "Mage"); // streamer aims at the Mage

        engine.ResolveRound();

        // Exact end-of-round HP (§7).
        Assert.Equal(565, state.Boss.CurrentHp);
        Assert.Equal(118, state.ById("Tank")!.CurrentHp);
        Assert.Equal(96, state.ById("Mage")!.CurrentHp);   // Mage untouched — taunt did its job
        Assert.Equal(112, state.ById("Healer")!.CurrentHp); // capped, overheal discarded

        // Fight continues.
        Assert.Equal(Phase.Prompt, state.Phase);
    }

    [Fact]
    public void Sec7_TauntRedirect_CrushingBlowHitTankNotMage()
    {
        var engine = BuildSec7Fight(out var state);
        engine.SubmitLock("Tank", DefaultContent.TankTaunt, "Tank");
        engine.SubmitLock("Mage", DefaultContent.MageFireball, "boss");
        engine.SubmitLock("Healer", DefaultContent.HealerHeal, "Healer");
        engine.SubmitLock("boss", DefaultContent.BossCrushingBlow, "Mage");

        engine.ResolveRound();

        // Mage at full → was NOT hit; Tank took 34 → was the redirect target.
        Assert.Equal(96, state.ById("Mage")!.CurrentHp);
        Assert.Equal(118, state.ById("Tank")!.CurrentHp);
    }

    [Fact]
    public void Sec7_CooldownAndTauntTick_AfterEnd()
    {
        var engine = BuildSec7Fight(out var state);
        engine.SubmitLock("Tank", DefaultContent.TankTaunt, "Tank");
        engine.SubmitLock("Mage", DefaultContent.MageFireball, "boss");
        engine.SubmitLock("Healer", DefaultContent.HealerHeal, "Healer");
        engine.SubmitLock("boss", DefaultContent.BossCrushingBlow, "Mage");

        engine.ResolveRound();

        var tank = state.ById("Tank")!;
        // Taunt cooldown set to 2 at resolve → END decrements to 1 (gap round).
        Assert.Equal(1, tank.Cooldowns[DefaultContent.TankTaunt]);

        // Boss taunt: rounds=2 at apply → END decrements to 1 (still taunted next round).
        Assert.Equal(1, state.Boss.TauntRoundsRemaining);
        Assert.Equal("Tank", state.Boss.TauntedByTankId);

        // Cooldown-0 moves remain ready.
        Assert.False(state.ById("Mage")!.IsOnCooldown(DefaultContent.MageFireball));
        Assert.False(state.Boss.IsOnCooldown(DefaultContent.BossCrushingBlow));

        // Round advanced.
        Assert.Equal(2, state.RoundNumber);
    }
}
