using Godot;
using TotalPartyKrawl.Combat;

namespace TotalPartyKrawl.Game.Combat;

/// <summary>Godot-authorable wrapper for <see cref="ClassDef"/> (spec §5.4). One .tres per class.</summary>
[GlobalClass]
public partial class ClassDefRes : Resource
{
    [Export] public string Id { get; set; } = "";
    [Export] public string DisplayName { get; set; } = "";
    [Export] public StatBlockRes BaseStats { get; set; }

    /// <summary>Ordered move ids, including the universal Basic Attack.</summary>
    [Export] public string[] MoveIds { get; set; } = System.Array.Empty<string>();

    [Export] public string Role { get; set; } = "";

    public ClassDef ToModel() => new()
    {
        Id = Id,
        DisplayName = DisplayName,
        BaseStats = (BaseStats ?? new StatBlockRes()).ToModel(),
        MoveIds = MoveIds,
        Role = Role,
    };
}
