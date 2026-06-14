using Godot;
using TotalPartyKrawl.Combat;

namespace TotalPartyKrawl.Game.Combat;

/// <summary>
/// Godot-authorable wrapper for <see cref="CombatTuning"/> (spec §1.1, §5.6).
/// One global .tres = the whole balance pass. Defaults mirror the spec constants.
/// </summary>
[GlobalClass]
public partial class CombatTuningRes : Resource
{
    [Export] public int HpBase { get; set; } = 40;
    [Export] public int HpPerCon { get; set; } = 8;
    [Export] public float StrDmgPer { get; set; } = 1.5f;
    [Export] public float IntDmgPer { get; set; } = 1.5f;
    [Export] public float DodgePerDex { get; set; } = 1.5f;
    [Export] public int DodgeBase { get; set; } = 5;
    [Export] public int DodgeCap { get; set; } = 40;
    [Export] public int DodgeFloor { get; set; } = 0;
    [Export] public float ResistPerCon { get; set; } = 0.8f;
    [Export] public int ResistCap { get; set; } = 50;

    public CombatTuning ToModel() => new()
    {
        HpBase = HpBase,
        HpPerCon = HpPerCon,
        StrDmgPer = StrDmgPer,
        IntDmgPer = IntDmgPer,
        DodgePerDex = DodgePerDex,
        DodgeBase = DodgeBase,
        DodgeCap = DodgeCap,
        DodgeFloor = DodgeFloor,
        ResistPerCon = ResistPerCon,
        ResistCap = ResistCap,
    };
}
