namespace TotalPartyKrawl.Combat;

/// <summary>
/// The full runtime state of a fight (spec §5.7). Holds combatants, the round
/// counter, phase, and the active-member count locked at fight start (drives boss HP).
/// </summary>
public sealed class CombatState
{
    public List<Combatant> Combatants { get; } = new();
    public int RoundNumber { get; set; } = 1;
    public Phase Phase { get; set; } = Phase.Prompt;

    /// <summary>Seated, non-spectator viewers at fight start (spec §4.3). Locked, never changes.</summary>
    public int ActiveMembersAtStart { get; set; }

    public Combatant Boss => Combatants.Single(c => c.IsBoss);
    public IEnumerable<Combatant> Viewers => Combatants.Where(c => !c.IsBoss);
    public IEnumerable<Combatant> LivingViewers => Viewers.Where(c => c.IsAlive);

    public Combatant? ById(string id) => Combatants.FirstOrDefault(c => c.Id == id);

    public bool IsOver => Phase is Phase.Won or Phase.Lost;
}
