#nullable enable
using System.Threading.Tasks;
using Godot;
using TotalPartyKrawl.Combat;

namespace TotalPartyKrawl.Game.Combat;

/// <summary>
/// View-side glue for a single combatant: the 3D model instance, its resting
/// transform (so lunges can return home), and its screen-space nameplate. Owns the
/// presentation tweens (lunge, hit flash, cast pulse, death) the controller calls.
/// </summary>
public sealed class CombatantView
{
    public Combatant Combatant { get; }
    public Node3D Model { get; }
    public Nameplate Plate { get; }

    private readonly Vector3 _homePos;
    private readonly Node3D? _meshHost;     // node we scale/flash without disturbing position
    private readonly float _anchorHeight;

    public CombatantView(Combatant combatant, Node3D model, Nameplate plate)
    {
        Combatant = combatant;
        Model = model;
        Plate = plate;
        _homePos = model.GlobalPosition;
        _meshHost = model;
        // Boss model reads taller; lift its nameplate anchor a bit higher.
        _anchorHeight = combatant.IsBoss ? 2.9f : 2.4f;
    }

    /// <summary>World position above the model's head where text/plate anchors.</summary>
    public Vector3 AnchorWorld() => Model.GlobalPosition + new Vector3(0, _anchorHeight, 0);

    public void UpdateNameplatePosition(Camera3D camera)
    {
        if (!GodotObject.IsInstanceValid(Model)) return;
        Vector3 world = AnchorWorld();
        // Hide the plate when the anchor is behind the camera.
        if (camera.IsPositionBehind(world))
        {
            Plate.Root.Visible = false;
            return;
        }
        Plate.Root.Visible = true;
        Vector2 screen = camera.UnprojectPosition(world);
        // Keep the plate clear of the top bar (which occupies roughly the top 78px).
        screen.Y = Mathf.Max(screen.Y, 84f);
        Plate.Root.Position = screen - new Vector2(Plate.Width / 2f, 0);
    }

    public void SetHp(int current, int max) => Plate.SetHp(current, max);

    // ---- presentation tweens -----------------------------------------------

    /// <summary>Dash a fraction of the way toward the target and snap back.</summary>
    public async Task LungeTo(CombatantView target, float time)
    {
        if (!GodotObject.IsInstanceValid(Model)) return;
        Vector3 toTarget = target.Model.GlobalPosition - _homePos;
        Vector3 lungePos = _homePos + toTarget.Normalized() * Mathf.Min(1.2f, toTarget.Length() * 0.45f);

        var tween = Model.CreateTween();
        tween.TweenProperty(Model, "global_position", lungePos, time)
            .SetTrans(Tween.TransitionType.Quad).SetEase(Tween.EaseType.Out);
        tween.TweenProperty(Model, "global_position", _homePos, time * 1.3f)
            .SetTrans(Tween.TransitionType.Quad).SetEase(Tween.EaseType.In);
        await Model.ToSignal(tween, Tween.SignalName.Finished);
    }

    /// <summary>Scale-punch + red tint flash to read a hit landing.</summary>
    public void HitFlash()
    {
        if (_meshHost is null || !GodotObject.IsInstanceValid(_meshHost)) return;
        var tween = _meshHost.CreateTween();
        tween.TweenProperty(_meshHost, "scale", Vector3.One * 1.12f, 0.06f);
        tween.TweenProperty(_meshHost, "scale", Vector3.One, 0.12f);
    }

    /// <summary>Small recoil for a dodge (no damage).</summary>
    public void Dodge()
    {
        if (_meshHost is null || !GodotObject.IsInstanceValid(_meshHost)) return;
        var tween = _meshHost.CreateTween();
        tween.TweenProperty(_meshHost, "scale", new Vector3(0.92f, 1.06f, 0.92f), 0.08f);
        tween.TweenProperty(_meshHost, "scale", Vector3.One, 0.12f);
    }

    /// <summary>Upward squash for a cast (heal / taunt).</summary>
    public void CastPulse()
    {
        if (_meshHost is null || !GodotObject.IsInstanceValid(_meshHost)) return;
        var tween = _meshHost.CreateTween();
        tween.TweenProperty(_meshHost, "scale", new Vector3(1.0f, 1.14f, 1.0f), 0.1f);
        tween.TweenProperty(_meshHost, "scale", Vector3.One, 0.18f);
    }

    /// <summary>Gentle green pop when receiving a heal.</summary>
    public void HealPulse()
    {
        if (_meshHost is null || !GodotObject.IsInstanceValid(_meshHost)) return;
        var tween = _meshHost.CreateTween();
        tween.TweenProperty(_meshHost, "scale", Vector3.One * 1.06f, 0.1f);
        tween.TweenProperty(_meshHost, "scale", Vector3.One, 0.16f);
    }

    /// <summary>On death: topple + sink + fade the plate. (Mesh upgrade gate: a real
    /// death animation / ragdoll / shatter goes here later.)</summary>
    public async Task Die()
    {
        if (!GodotObject.IsInstanceValid(Model)) return;
        Plate.MarkDead();
        var tween = Model.CreateTween();
        tween.SetParallel(true);
        tween.TweenProperty(Model, "rotation:x", Mathf.DegToRad(-85f), 0.45f)
            .SetTrans(Tween.TransitionType.Back).SetEase(Tween.EaseType.In);
        tween.TweenProperty(Model, "global_position:y", _homePos.Y - 0.3f, 0.55f);
        await Model.ToSignal(tween, Tween.SignalName.Finished);
        var fade = Model.CreateTween();
        fade.TweenProperty(Plate.Root, "modulate:a", 0.25, 0.3f);
    }
}
