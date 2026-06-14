using Godot;
using TotalPartyKrawl.Combat;

namespace TotalPartyKrawl.Game.Combat;

/// <summary>
/// Godot-authorable wrapper for <see cref="MoveDef"/> (spec §5.3). One .tres per move.
/// Converts to the immutable pure-C# MoveDef the combat engine resolves against.
/// </summary>
[GlobalClass]
public partial class MoveDefRes : Resource
{
    [Export] public string Id { get; set; } = "";
    [Export] public string DisplayName { get; set; } = "";
    [Export] public TargetRule Target { get; set; } = TargetRule.EnemyOne;
    [Export] public EffectKind Effect { get; set; } = EffectKind.PhysicalDamage;
    [Export] public int BasePower { get; set; }
    [Export] public ScalingStat Scaling { get; set; } = ScalingStat.None;
    [Export] public int Cooldown { get; set; }
    [Export] public CostType CostType { get; set; } = CostType.None;
    [Export] public int CostAmount { get; set; }
    [Export] public int StatusRounds { get; set; }
    [Export(PropertyHint.MultilineText)] public string Description { get; set; } = "";

    public MoveDef ToModel() => new()
    {
        Id = Id,
        DisplayName = DisplayName,
        Target = Target,
        Effect = Effect,
        BasePower = BasePower,
        Scaling = Scaling,
        Cooldown = Cooldown,
        CostType = CostType,
        CostAmount = CostAmount,
        StatusRounds = StatusRounds,
        Description = Description,
    };
}
