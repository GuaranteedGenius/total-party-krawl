using Godot;
using TotalPartyKrawl.Combat;

namespace TotalPartyKrawl.Game.Combat;

/// <summary>Godot-authorable wrapper for <see cref="BossDef"/> (spec §5.5). One .tres per boss archetype.</summary>
[GlobalClass]
public partial class BossDefRes : Resource
{
    [Export] public string Id { get; set; } = "";
    [Export] public string DisplayName { get; set; } = "";
    [Export] public StatBlockRes BaseStats { get; set; }
    [Export] public int HpBase { get; set; } = 120;
    [Export] public int HpPerMember { get; set; } = 160;
    [Export] public string[] MoveIds { get; set; } = System.Array.Empty<string>();

    public BossDef ToModel() => new()
    {
        Id = Id,
        DisplayName = DisplayName,
        BaseStats = (BaseStats ?? new StatBlockRes()).ToModel(),
        HpBase = HpBase,
        HpPerMember = HpPerMember,
        MoveIds = MoveIds,
    };
}
