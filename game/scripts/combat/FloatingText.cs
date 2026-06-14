using Godot;

namespace TotalPartyKrawl.Game.Combat;

/// <summary>
/// Floating combat text (damage / heal / DODGE / TAUNT callouts). Spawned at a 3D
/// world anchor projected to screen space, rises and fades, then frees itself.
/// Pure Control nodes — no art assets.
/// </summary>
public static class FloatingText
{
    public static readonly Color Damage = new(1f, 0.42f, 0.32f);
    public static readonly Color Heal   = new(0.45f, 0.95f, 0.5f);
    public static readonly Color Dodge  = new(0.7f, 0.82f, 1f);
    public static readonly Color Taunt  = new(1f, 0.82f, 0.3f);

    public static void Spawn(Control layer, Camera3D camera, Vector3 world, string text, Color color)
    {
        if (camera.IsPositionBehind(world))
            return;

        Vector2 screen = camera.UnprojectPosition(world);

        var label = new Label
        {
            Text = text,
            MouseFilter = Control.MouseFilterEnum.Ignore,
            HorizontalAlignment = HorizontalAlignment.Center,
            ZIndex = 50,
        };
        bool big = text.Contains("TAUNT") || text.Contains("DODGE");
        label.AddThemeFontSizeOverride("font_size", big ? 26 : 30);
        label.AddThemeColorOverride("font_color", color);
        label.AddThemeColorOverride("font_outline_color", new Color(0, 0, 0, 0.9f));
        label.AddThemeConstantOverride("outline_size", 6);
        layer.AddChild(label);

        // Center the label on the anchor (measured after it has a font).
        label.Position = screen - new Vector2(40, 10);
        label.PivotOffset = new Vector2(40, 18);

        var tween = label.CreateTween();
        tween.SetParallel(true);
        tween.TweenProperty(label, "position:y", label.Position.Y - 70, 0.9f)
            .SetTrans(Tween.TransitionType.Quad).SetEase(Tween.EaseType.Out);
        tween.TweenProperty(label, "scale", Vector2.One, 0.18f)
            .From(new Vector2(0.4f, 0.4f))
            .SetTrans(Tween.TransitionType.Back).SetEase(Tween.EaseType.Out);
        tween.Chain().TweenInterval(0.35f);
        tween.TweenProperty(label, "modulate:a", 0.0, 0.45f);
        tween.Chain().TweenCallback(Callable.From(label.QueueFree));
    }
}
