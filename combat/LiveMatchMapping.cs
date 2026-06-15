namespace TotalPartyKrawl.Combat;

/// <summary>
/// A viewer that has joined a seat for this match, as read from the relay roster
/// (<c>GET /api/host/seats</c>). Pure data — no Godot, no networking. The networking
/// layer in <c>game/</c> fills these from the relay JSON.
/// </summary>
public readonly record struct RosterSeat(int SeatIndex, string ClassId, bool Alive);

/// <summary>
/// A single viewer lock-in as read from the relay (<c>GET /api/host/moves?round=N</c>).
/// <see cref="TargetId"/> is the relay's target token (a combatant id like
/// <c>"boss"</c> / <c>"seat.3"</c>, or the AOE tokens <c>"party"</c>/<c>"boss"</c>).
/// </summary>
public readonly record struct RosterMove(int SeatIndex, string MoveId, string? TargetId);

/// <summary>
/// Pure (Godot-free, network-free) translation between the relay's seat/move model
/// and the combat engine's combatant model. Kept here in the combat library so it is
/// unit-testable headless and the resolve path is identical online and offline.
///
/// Conventions (locked by docs/api-contract.md):
///  - A viewer in seat N is the combatant with id <c>"seat.N"</c>; the boss is <c>"boss"</c>.
///  - The relay's <c>targetId</c> token IS the combatant id for single-target moves
///    (<c>"boss"</c> or <c>"seat.N"</c>); AOE tokens (<c>"party"</c>/<c>"boss"</c>) are
///    passed through verbatim and ignored by the engine, which resolves AOE by TargetRule.
///  - A non-responding seat defaults to Basic Attack on the boss (spec §2.3).
///  - A move for a dead or unknown seat is dropped (spec §6.2 — it would not act anyway).
/// </summary>
public static class LiveMatchMapping
{
    /// <summary>The combatant id for a seated viewer (e.g. seat 3 → "seat.3").</summary>
    public static string SeatCombatantId(int seatIndex) => $"seat.{seatIndex}";

    /// <summary>The boss combatant id (the streamer in "Fight Me").</summary>
    public const string BossId = "boss";

    /// <summary>The default action every non-responding viewer takes (spec §2.3).</summary>
    public static MoveChoice DefaultViewerChoice => new(DefaultContent.BasicAttack, BossId);

    /// <summary>
    /// Build the <c>(ClassId, SeatIndex, Id)</c> party tuples the engine's
    /// <see cref="CombatEngine.CreateFight"/> expects, from the joined roster.
    /// Only seats that are alive at fight start are included (spec §4.3 — the active
    /// member set is locked here). Seats are ordered by seat index for determinism.
    /// </summary>
    public static IReadOnlyList<(string ClassId, int SeatIndex, string Id)> BuildParty(
        IEnumerable<RosterSeat> roster)
    {
        return roster
            .Where(s => s.Alive)
            .OrderBy(s => s.SeatIndex)
            .Select(s => (s.ClassId, s.SeatIndex, SeatCombatantId(s.SeatIndex)))
            .ToList();
    }

    /// <summary>
    /// Resolve every living viewer's locked action for the round: a submitted move if
    /// the seat is still alive and present in <paramref name="state"/>, otherwise the
    /// default action (Basic Attack on the boss). Moves for dead/unknown seats are
    /// dropped. Returns <c>(combatantId, MoveChoice)</c> pairs ready for
    /// <see cref="CombatEngine.SubmitLock"/>. Pure: does not mutate the engine.
    /// </summary>
    /// <param name="state">The live fight state (source of truth for who is alive).</param>
    /// <param name="submitted">The viewer lock-ins read from the relay this round.</param>
    public static IReadOnlyList<(string CombatantId, MoveChoice Choice)> ResolveViewerLockIns(
        CombatState state,
        IEnumerable<RosterMove> submitted)
    {
        // Index submissions by seat; a re-submit (last wins) is already collapsed by the
        // relay's unique(channel,round,seat) upsert, but guard here too.
        var bySeat = new Dictionary<int, RosterMove>();
        foreach (var m in submitted)
            bySeat[m.SeatIndex] = m;

        var result = new List<(string, MoveChoice)>();

        foreach (var viewer in state.LivingViewers.OrderBy(v => v.SeatIndex))
        {
            if (bySeat.TryGetValue(viewer.SeatIndex, out var move)
                && !string.IsNullOrEmpty(move.MoveId))
            {
                // Trust the engine to reject/redirect an invalid move or dead target
                // at resolve time (spec §2.3, §6.9); we only pass the intent through.
                result.Add((viewer.Id, new MoveChoice(move.MoveId, move.TargetId)));
            }
            else
            {
                // Non-responder → spec default action.
                result.Add((viewer.Id, DefaultViewerChoice));
            }
        }

        return result;
    }
}
