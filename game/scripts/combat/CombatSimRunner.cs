using Godot;
using TotalPartyKrawl.Combat;

namespace TotalPartyKrawl.Game.Combat;

/// <summary>
/// Headless combat-sim harness. When the env var <c>TPK_COMBATSIM</c> is set, runs a
/// full 3-bot "Fight Me" fight (Tank/Mage/Healer vs The Warden) using the pure-C#
/// <see cref="CombatSim"/>, prints the round-by-round log, then quits. Mirrors the
/// existing screenshot-on-ready autoload pattern so a fight can be watched headlessly:
///
///   TPK_COMBATSIM=1 Godot_..._console.exe --path game --headless
///
/// Optional <c>TPK_COMBATSIM_SEED</c> sets the dodge RNG seed (default 1).
/// No-op when the env var is unset, so normal runs are unaffected.
/// </summary>
public partial class CombatSimRunner : Node
{
    public override void _Ready()
    {
        string flag = OS.GetEnvironment("TPK_COMBATSIM");
        if (string.IsNullOrEmpty(flag))
            return;

        int seed = 1;
        string seedEnv = OS.GetEnvironment("TPK_COMBATSIM_SEED");
        if (!string.IsNullOrEmpty(seedEnv) && int.TryParse(seedEnv, out int parsed))
            seed = parsed;

        var result = CombatSim.Run(CombatSim.DefaultTrio(), seed);

        GD.Print("=== TPK Combat Sim (Tank/Mage/Healer vs The Warden) ===");
        foreach (var entry in result.Log.Entries)
            GD.Print(entry.Text);
        GD.Print($"=== Result: {result.Outcome} in {result.Rounds} rounds (seed {seed}) ===");

        GetTree().Quit();
    }
}
