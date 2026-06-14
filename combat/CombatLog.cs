namespace TotalPartyKrawl.Combat;

/// <summary>A single human-readable line emitted during resolution, for the sim log + debugging.</summary>
public readonly record struct CombatLogEntry(int Round, string Text);

/// <summary>Collects log lines during a fight. Pure C#; the Godot runner just GD.Prints these.</summary>
public sealed class CombatLog
{
    private readonly List<CombatLogEntry> _entries = new();
    public IReadOnlyList<CombatLogEntry> Entries => _entries;

    public void Add(int round, string text) => _entries.Add(new CombatLogEntry(round, text));
}
