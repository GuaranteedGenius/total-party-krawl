using Xunit;

namespace TotalPartyKrawl.Combat.Tests;

/// <summary>Full-fight headless simulation tests (spec §4.3 round-count target, robustness).</summary>
public sealed class SimTests
{
    [Theory]
    [InlineData(1)]
    [InlineData(7)]
    [InlineData(42)]
    [InlineData(1337)]
    public void ThreeBots_VsWarden_TerminatesCleanly(int seed)
    {
        var result = CombatSim.Run(CombatSim.DefaultTrio(), seed, maxRounds: 100);

        // Always reaches a real outcome within a sane bound.
        Assert.True(result.Outcome is Phase.Won or Phase.Lost,
            $"Fight did not terminate (phase {result.Outcome}, {result.Rounds} rounds).");
        Assert.True(result.Rounds <= 100);
    }

    [Fact]
    public void Sim_IsDeterministic_ForAGivenSeed()
    {
        var a = CombatSim.Run(CombatSim.DefaultTrio(), seed: 99);
        var b = CombatSim.Run(CombatSim.DefaultTrio(), seed: 99);
        Assert.Equal(a.Outcome, b.Outcome);
        Assert.Equal(a.Rounds, b.Rounds);
    }

    [Fact]
    public void Sim_NeverDrivesHpBelowZero_OrThrows()
    {
        // Replay a full fight via the engine to inspect HP invariants each round.
        var rng = new Random(2024);
        var engine = CombatEngine.CreateFight(
            new[]
            {
                (DefaultContent.ClassTank, 0, "Tank"),
                (DefaultContent.ClassMage, 1, "Mage"),
                (DefaultContent.ClassHealer, 2, "Healer"),
            },
            DefaultContent.Classes(), DefaultContent.Warden(), DefaultContent.Moves(),
            DefaultContent.Tuning(), rng);
        var state = engine.State;
        var viewerBot = new ViewerBot();
        var bossBot = new BossBot();

        int guard = 0;
        while (!state.IsOver && guard++ < 200)
        {
            foreach (var c in state.Combatants.Where(c => c.IsAlive))
            {
                var choice = (c.IsBoss ? (IMoveDecider)bossBot : viewerBot).Decide(c, state, DefaultContent.Moves());
                engine.SubmitLock(c.Id, choice.MoveId, choice.TargetId);
            }
            engine.ResolveRound();

            foreach (var c in state.Combatants)
            {
                Assert.True(c.CurrentHp >= 0, $"{c.Id} HP went negative ({c.CurrentHp}).");
                Assert.True(c.CurrentHp <= c.MaxHp, $"{c.Id} HP exceeded MaxHp ({c.CurrentHp}/{c.MaxHp}).");
            }
        }

        Assert.True(state.IsOver);
    }

    [Theory]
    [InlineData(1, 280)]
    [InlineData(2, 440)]
    [InlineData(3, 600)]
    [InlineData(4, 760)]
    public void BossHp_ScalesPerActiveMember(int members, int expectedHp)
    {
        Assert.Equal(expectedHp, DefaultContent.Warden().MaxHp(members));
    }
}
