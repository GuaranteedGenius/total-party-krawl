using Godot;
using TotalPartyKrawl.Combat;

namespace TotalPartyKrawl.Game.Combat;

/// <summary>
/// Godot-authorable wrapper for <see cref="StatBlock"/> (spec §5.2). Thin DTO:
/// holds the same fields and converts to the pure-C# combat type. The runtime
/// never mutates a Resource — it reads ToModel() once at fight start.
/// </summary>
[GlobalClass]
public partial class StatBlockRes : Resource
{
    [Export] public int Str { get; set; }
    [Export] public int Int { get; set; }
    [Export] public int Dex { get; set; }
    [Export] public int Con { get; set; }

    public StatBlock ToModel() => new(Str, Int, Dex, Con);
}
