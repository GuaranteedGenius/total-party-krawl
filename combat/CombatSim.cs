namespace TotalPartyKrawl.Combat;

/// <summary>Result of a headless simulated fight.</summary>
public sealed record SimResult(Phase Outcome, int Rounds, CombatLog Log);

/// <summary>
/// Runs a full "Fight Me" fight headlessly: builds the roster from DefaultContent,
/// drives bot deciders each round, and resolves until Won/Lost. Deterministic given
/// a seed (the only RNG is dodge). Used by tests and the Godot headless runner.
/// </summary>
public static class CombatSim
{
    /// <summary>A roster entry: the class id and its display seat id.</summary>
    public readonly record struct PartyMember(string ClassId, string Id);

    /// <summary>
    /// Run a fight to completion. <paramref name="maxRounds"/> guards against an
    /// infinite stalemate (returns the last phase even if not terminal).
    /// </summary>
    public static SimResult Run(IReadOnlyList<PartyMember> party, int seed, int maxRounds = 200)
    {
        var rng = new Random(seed);
        var log = new CombatLog();
        var moves = DefaultContent.Moves();
        var classes = DefaultContent.Classes();
        var boss = DefaultContent.Warden();
        var tuning = DefaultContent.Tuning();

        var roster = party
            .Select((m, i) => (m.ClassId, SeatIndex: i, m.Id))
            .ToList();

        var engine = CombatEngine.CreateFight(roster, classes, boss, moves, tuning, rng, log);
        var state = engine.State;

        var viewerBot = new ViewerBot();
        var bossBot = new BossBot();

        log.Add(0, $"Fight start: {party.Count} vs The Warden (Boss HP {state.Boss.MaxHp}). Seed {seed}.");

        while (!state.IsOver && state.RoundNumber <= maxRounds)
        {
            // LOCK-IN — every living combatant submits a bot choice.
            foreach (var c in state.Combatants.Where(c => c.IsAlive))
            {
                var decider = c.IsBoss ? (IMoveDecider)bossBot : viewerBot;
                var choice = decider.Decide(c, state, moves);
                engine.SubmitLock(c.Id, choice.MoveId, choice.TargetId);
            }

            int round = state.RoundNumber;
            log.Add(round, $"--- Round {round} (Boss {state.Boss.CurrentHp}/{state.Boss.MaxHp}) ---");
            engine.ResolveRound();
        }

        return new SimResult(state.Phase, state.RoundNumber, log);
    }

    /// <summary>The canonical 3-bot roster (Tank/Mage/Healer) used by the runner.</summary>
    public static IReadOnlyList<PartyMember> DefaultTrio() => new[]
    {
        new PartyMember(DefaultContent.ClassTank, "Tank"),
        new PartyMember(DefaultContent.ClassMage, "Mage"),
        new PartyMember(DefaultContent.ClassHealer, "Healer"),
    };
}
