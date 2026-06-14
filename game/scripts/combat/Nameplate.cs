#nullable enable
using Godot;

namespace TotalPartyKrawl.Game.Combat;

/// <summary>
/// A screen-space combatant nameplate built entirely from Control nodes (no art
/// assets): name + class, an HP <see cref="ProgressBar"/>, and current/max HP text.
/// The controller positions <see cref="Root"/> each frame via
/// <c>Camera3D.UnprojectPosition</c> so it tracks the 3D model.
/// </summary>
public sealed class Nameplate
{
    public Control Root { get; private set; } = null!;
    public float Width { get; private set; }

    private ProgressBar _bar = null!;
    private Label _hpText = null!;
    private StyleBoxFlat _fill = null!;

    public static Nameplate Create(string name, string className, int hp, int maxHp, bool isBoss)
    {
        var plate = new Nameplate();
        plate.Build(name, className, hp, maxHp, isBoss);
        return plate;
    }

    private void Build(string name, string className, int hp, int maxHp, bool isBoss)
    {
        Width = isBoss ? 280 : 180;

        var panel = new PanelContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        var style = new StyleBoxFlat
        {
            BgColor = new Color(0.06f, 0.05f, 0.08f, 0.72f),
            ContentMarginTop = 4, ContentMarginBottom = 5,
            ContentMarginLeft = 8, ContentMarginRight = 8,
        };
        style.SetCornerRadiusAll(5);
        style.BorderWidthBottom = style.BorderWidthTop = style.BorderWidthLeft = style.BorderWidthRight = 1;
        style.BorderColor = isBoss ? new Color(0.8f, 0.3f, 0.3f, 0.9f) : new Color(1, 1, 1, 0.18f);
        panel.AddThemeStyleboxOverride("panel", style);
        panel.CustomMinimumSize = new Vector2(Width, 0);

        var vbox = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        vbox.AddThemeConstantOverride("separation", 1);
        panel.AddChild(vbox);

        var title = new Label
        {
            Text = isBoss ? $"{name}" : $"{name}  •  {className}",
            HorizontalAlignment = HorizontalAlignment.Center,
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        title.AddThemeFontSizeOverride("font_size", isBoss ? 20 : 14);
        title.AddThemeColorOverride("font_color",
            isBoss ? new Color(1f, 0.7f, 0.6f) : new Color(0.95f, 0.95f, 0.92f));
        vbox.AddChild(title);

        _bar = new ProgressBar
        {
            MinValue = 0, MaxValue = maxHp, Value = hp,
            ShowPercentage = false,
            CustomMinimumSize = new Vector2(Width - 16, isBoss ? 16 : 11),
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        _fill = new StyleBoxFlat { BgColor = HealthColor(1f) };
        _fill.SetCornerRadiusAll(3);
        var bg = new StyleBoxFlat { BgColor = new Color(0.12f, 0.1f, 0.12f) };
        bg.SetCornerRadiusAll(3);
        _bar.AddThemeStyleboxOverride("fill", _fill);
        _bar.AddThemeStyleboxOverride("background", bg);
        vbox.AddChild(_bar);

        _hpText = new Label
        {
            Text = $"{hp} / {maxHp}",
            HorizontalAlignment = HorizontalAlignment.Center,
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        _hpText.AddThemeFontSizeOverride("font_size", isBoss ? 13 : 10);
        _hpText.AddThemeColorOverride("font_color", new Color(0.85f, 0.85f, 0.82f));
        vbox.AddChild(_hpText);

        Root = panel;
    }

    public void SetHp(int current, int max)
    {
        // Tween the bar so damage/heal reads as motion, not a snap.
        var tween = _bar.CreateTween();
        tween.TweenProperty(_bar, "value", current, 0.25f)
            .SetTrans(Tween.TransitionType.Quad).SetEase(Tween.EaseType.Out);
        _hpText.Text = $"{Mathf.Max(0, current)} / {max}";
        float frac = max > 0 ? (float)current / max : 0f;
        _fill.BgColor = HealthColor(frac);
    }

    public void MarkDead()
    {
        _hpText.Text = "DOWN";
        _fill.BgColor = new Color(0.35f, 0.1f, 0.1f);
    }

    private static Color HealthColor(float frac)
    {
        // Green → yellow → red as HP drops.
        if (frac > 0.5f)
            return new Color(0.3f, 0.8f, 0.35f).Lerp(new Color(0.9f, 0.8f, 0.25f), (1f - frac) * 2f);
        return new Color(0.9f, 0.8f, 0.25f).Lerp(new Color(0.85f, 0.25f, 0.25f), (0.5f - frac) * 2f);
    }
}
