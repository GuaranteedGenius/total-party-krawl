using Xunit;

namespace TotalPartyKrawl.Combat.Tests;

/// <summary>
/// Tests for the pure relay↔engine mapping (<see cref="LiveMatchMapping"/>): roster →
/// party tuples, and lock-in resolution incl. the spec defaults (§2.3) and dead-seat
/// dropping (§6.2). No Godot, no networking.
/// </summary>
public sealed class LiveMatchMappingTests
{
    private static CombatEngine Fight(out CombatState state, params (string ClassId, int Seat, string Id)[] party)
    {
        var engine = CombatEngine.CreateFight(
            party.Length == 0
                ? new[]
                {
                    (DefaultContent.ClassTank, 0, LiveMatchMapping.SeatCombatantId(0)),
                    (DefaultContent.ClassMage, 1, LiveMatchMapping.SeatCombatantId(1)),
                    (DefaultContent.ClassHealer, 2, LiveMatchMapping.SeatCombatantId(2)),
                }
                : party,
            DefaultContent.Classes(), DefaultContent.Warden(), DefaultContent.Moves(),
            DefaultContent.Tuning(), FixedRng.NeverDodge);
        state = engine.State;
        return engine;
    }

    [Fact]
    public void SeatCombatantId_FollowsContractConvention()
    {
        Assert.Equal("seat.0", LiveMatchMapping.SeatCombatantId(0));
        Assert.Equal("seat.9", LiveMatchMapping.SeatCombatantId(9));
        Assert.Equal("boss", LiveMatchMapping.BossId);
    }

    [Fact]
    public void BuildParty_KeepsAliveSeats_OrderedBySeatIndex_WithSeatIds()
    {
        var roster = new[]
        {
            new RosterSeat(2, DefaultContent.ClassHealer, Alive: true),
            new RosterSeat(0, DefaultContent.ClassTank, Alive: true),
            new RosterSeat(1, DefaultContent.ClassMage, Alive: true),
        };

        var party = LiveMatchMapping.BuildParty(roster);

        Assert.Equal(3, party.Count);
        Assert.Equal((DefaultContent.ClassTank, 0, "seat.0"), party[0]);
        Assert.Equal((DefaultContent.ClassMage, 1, "seat.1"), party[1]);
        Assert.Equal((DefaultContent.ClassHealer, 2, "seat.2"), party[2]);
    }

    [Fact]
    public void BuildParty_DropsSeatsThatAreNotAliveAtStart()
    {
        var roster = new[]
        {
            new RosterSeat(0, DefaultContent.ClassTank, Alive: true),
            new RosterSeat(1, DefaultContent.ClassMage, Alive: false),
        };

        var party = LiveMatchMapping.BuildParty(roster);

        Assert.Single(party);
        Assert.Equal(0, party[0].SeatIndex);
    }

    [Fact] // spec §2.3 — a seat that submitted nothing defaults to Basic Attack on the boss.
    public void ResolveViewerLockIns_NonResponder_DefaultsToBasicAttackOnBoss()
    {
        Fight(out var state);

        // Only seat 1 (Mage) submits; seats 0 and 2 are non-responders.
        var submitted = new[]
        {
            new RosterMove(1, DefaultContent.MageFireball, "boss"),
        };

        var locks = LiveMatchMapping.ResolveViewerLockIns(state, submitted);

        Assert.Equal(3, locks.Count);

        var seat0 = locks.Single(l => l.CombatantId == "seat.0");
        Assert.Equal(DefaultContent.BasicAttack, seat0.Choice.MoveId);
        Assert.Equal("boss", seat0.Choice.TargetId);

        var seat1 = locks.Single(l => l.CombatantId == "seat.1");
        Assert.Equal(DefaultContent.MageFireball, seat1.Choice.MoveId);
        Assert.Equal("boss", seat1.Choice.TargetId);

        var seat2 = locks.Single(l => l.CombatantId == "seat.2");
        Assert.Equal(DefaultContent.BasicAttack, seat2.Choice.MoveId);
    }

    [Fact] // spec §6.2 — a dead seat's submission is dropped (it never appears in the lock-ins).
    public void ResolveViewerLockIns_DeadSeatMoveIsDropped()
    {
        Fight(out var state);
        state.ById("seat.1")!.CurrentHp = 0; // Mage is dead

        var submitted = new[]
        {
            new RosterMove(1, DefaultContent.MageFireball, "boss"), // should be dropped
            new RosterMove(0, DefaultContent.TankShieldBash, "boss"),
        };

        var locks = LiveMatchMapping.ResolveViewerLockIns(state, submitted);

        // Only the two living viewers (seats 0 and 2) produce lock-ins.
        Assert.Equal(2, locks.Count);
        Assert.DoesNotContain(locks, l => l.CombatantId == "seat.1");
        Assert.Contains(locks, l => l.CombatantId == "seat.0" && l.Choice.MoveId == DefaultContent.TankShieldBash);
    }

    [Fact] // an empty moveId is treated as no submission → default action.
    public void ResolveViewerLockIns_EmptyMoveId_TreatedAsNonResponder()
    {
        Fight(out var state);

        var submitted = new[]
        {
            new RosterMove(0, "", "boss"),
        };

        var locks = LiveMatchMapping.ResolveViewerLockIns(state, submitted);

        var seat0 = locks.Single(l => l.CombatantId == "seat.0");
        Assert.Equal(DefaultContent.BasicAttack, seat0.Choice.MoveId);
    }

    [Fact] // the mapped lock-ins, submitted to the engine, actually resolve a round.
    public void ResolvedLockIns_FeedTheEngineAndDamageTheBoss()
    {
        var engine = Fight(out var state);
        int bossBefore = state.Boss.CurrentHp;

        var submitted = new[]
        {
            new RosterMove(1, DefaultContent.MageFireball, "boss"),
        };

        foreach (var (id, choice) in LiveMatchMapping.ResolveViewerLockIns(state, submitted))
            engine.SubmitLock(id, choice.MoveId, choice.TargetId);
        engine.SubmitLock("boss", DefaultContent.BossBrace, "boss"); // keep boss off the party

        engine.ResolveRound();

        Assert.True(state.Boss.CurrentHp < bossBefore);
    }
}
