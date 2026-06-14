#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using TotalPartyKrawl.Combat;

namespace TotalPartyKrawl.Game.Combat;

/// <summary>
/// Milestone B — the on-screen combat scene driver. Builds a 3-bot "Fight Me"
/// fight (Tank/Mage/Healer vs The Warden) from the pure-C# <see cref="CombatEngine"/>,
/// maps each <see cref="Combatant"/> to a 3D model + a screen-space nameplate, and
/// plays the engine's ordered <see cref="ActionResult"/>s out one at a time with
/// tweened attack lunges, hit flashes, floating combat text and HP-bar updates.
///
/// All combat MATH lives in the lib; this node only animates the results. The bots
/// pick the moves (auto-play) so the scene is watchable / screenshot-able with no
/// viewer input. A real player-input layer + real per-class meshes are the upgrade
/// gates flagged in the milestone notes.
/// </summary>
public partial class CombatController : Node3D
{
    // ----- Tunables for the on-screen pacing (NOT game balance; pure presentation) -----
    [Export] public float StepDelay = 0.85f;       // seconds between each ActionResult
    [Export] public float RoundDelay = 1.1f;       // extra pause between rounds
    [Export] public float LungeTime = 0.18f;       // attacker dash toward target
    [Export] public float TurnTimerSeconds = 20f;  // visual lock-in countdown per round
    [Export] public int Seed = 7;

    // Scene wiring (set in combat.tscn).
    [Export] public NodePath BossPath = "boss_model";
    [Export] public NodePath TankPath = "tank_model";
    [Export] public NodePath MagePath = "mage_model";
    [Export] public NodePath HealerPath = "healer_model";
    [Export] public NodePath CameraPath = "Camera3D";

    private Camera3D _camera = null!;
    private CanvasLayer _ui = null!;
    private Control _nameplateLayer = null!;
    private Control _floatingLayer = null!;
    private Label _topBar = null!;
    private ProgressBar _turnTimer = null!;
    private Label _banner = null!;

    private CombatEngine _engine = null!;
    private CombatState _state = null!;
    private IReadOnlyDictionary<string, MoveDef> _moves = null!;
    private ViewerBot _viewerBot = null!;
    private BossBot _bossBot = null!;

    private readonly Dictionary<string, CombatantView> _views = new();

    public override void _Ready()
    {
        // Screenshot/CI speed override: compress all presentation delays so a full
        // ~14-round fight reaches the win banner in a few seconds for headless
        // capture. Normal runs keep the watchable defaults.
        if (!string.IsNullOrEmpty(OS.GetEnvironment("TPK_COMBAT_FAST")))
        {
            StepDelay = 0.12f;
            RoundDelay = 0.18f;
            LungeTime = 0.05f;
        }

        _camera = GetNode<Camera3D>(CameraPath);

        BuildUi();
        BuildEngine();
        BindViews();

        // Kick off the auto-play loop (async, non-blocking).
        _ = RunFightAsync();
    }

    public override void _Process(double delta)
    {
        // Nameplates follow their 3D model in screen space every frame.
        foreach (var view in _views.Values)
            view.UpdateNameplatePosition(_camera);
    }

    // ----------------------------------------------------------------- engine

    private void BuildEngine()
    {
        var rng = new Random(Seed);
        _moves = DefaultContent.Moves();
        var classes = DefaultContent.Classes();
        var boss = DefaultContent.Warden();
        var tuning = DefaultContent.Tuning();

        var roster = new (string ClassId, int SeatIndex, string Id)[]
        {
            (DefaultContent.ClassTank, 0, "Tank"),
            (DefaultContent.ClassMage, 1, "Mage"),
            (DefaultContent.ClassHealer, 2, "Healer"),
        };

        _engine = CombatEngine.CreateFight(roster, classes, boss, _moves, tuning, rng);
        _state = _engine.State;
        _viewerBot = new ViewerBot();
        _bossBot = new BossBot();
    }

    private void BindViews()
    {
        AddView(_state.Boss, GetNode<Node3D>(BossPath), "The Warden", "Boss");
        AddView(_state.ById("Tank")!, GetNode<Node3D>(TankPath), "Tank", "Tank");
        AddView(_state.ById("Mage")!, GetNode<Node3D>(MagePath), "Mage", "Mage");
        AddView(_state.ById("Healer")!, GetNode<Node3D>(HealerPath), "Healer", "Healer");
    }

    private void AddView(Combatant c, Node3D model, string displayName, string className)
    {
        var plate = Nameplate.Create(displayName, className, c.CurrentHp, c.MaxHp, c.IsBoss);
        _nameplateLayer.AddChild(plate.Root);
        var view = new CombatantView(c, model, plate);
        _views[c.Id] = view;
    }

    // ------------------------------------------------------------- auto-play

    private async System.Threading.Tasks.Task RunFightAsync()
    {
        // Brief beat so the arena renders before the first swing.
        await Wait(0.6f);

        while (!_state.IsOver)
        {
            int round = _state.RoundNumber;
            UpdateTopBar();

            // Visual lock-in countdown (compressed; pure presentation).
            await AnimateTurnTimer();

            // LOCK-IN — every living combatant submits a bot choice (same shape a
            // real viewer submission would have).
            foreach (var c in _state.Combatants.Where(c => c.IsAlive))
            {
                var decider = c.IsBoss ? (IMoveDecider)_bossBot : _viewerBot;
                var choice = decider.Decide(c, _state, _moves);
                _engine.SubmitLock(c.Id, choice.MoveId, choice.TargetId);
            }

            _engine.ResolveRound();

            // Play the ordered results out one at a time.
            var results = _engine.LastRoundResults.ToArray();
            foreach (var result in results)
            {
                await PlayResult(result);
                await Wait(StepDelay);
            }

            await Wait(RoundDelay);

            if (round > 200) break; // hard guard against an unexpected stalemate
        }

        ShowBanner();
    }

    private async System.Threading.Tasks.Task PlayResult(ActionResult r)
    {
        if (!_views.TryGetValue(r.ActorId, out var actor))
            return;
        _views.TryGetValue(r.TargetId ?? r.ActorId, out var target);

        switch (r.Kind)
        {
            case ActionResultKind.Damage:
            case ActionResultKind.Dodge:
                if (target is not null)
                    await actor.LungeTo(target, LungeTime);
                if (r.WasDodged)
                {
                    if (target is not null)
                    {
                        FloatingText.Spawn(_floatingLayer, _camera, target.AnchorWorld(),
                            "DODGE", FloatingText.Dodge);
                        target.Dodge();
                    }
                }
                else if (target is not null)
                {
                    string prefix = r.WasRedirected ? "TAUNT " : "";
                    FloatingText.Spawn(_floatingLayer, _camera, target.AnchorWorld(),
                        $"{prefix}-{r.Amount}", r.WasRedirected ? FloatingText.Taunt : FloatingText.Damage);
                    target.HitFlash();
                    target.SetHp(r.TargetHpAfter, r.TargetMaxHp);
                    if (r.TargetDied)
                        await target.Die();
                }
                break;

            case ActionResultKind.Heal:
                actor.CastPulse();
                if (target is not null)
                {
                    if (r.Amount > 0)
                        FloatingText.Spawn(_floatingLayer, _camera, target.AnchorWorld(),
                            $"+{r.Amount}", FloatingText.Heal);
                    target.SetHp(r.TargetHpAfter, r.TargetMaxHp);
                    target.HealPulse();
                }
                break;

            case ActionResultKind.Taunt:
                actor.CastPulse();
                FloatingText.Spawn(_floatingLayer, _camera, actor.AnchorWorld(),
                    "TAUNT!", FloatingText.Taunt);
                break;

            case ActionResultKind.Skip:
                FloatingText.Spawn(_floatingLayer, _camera, actor.AnchorWorld(),
                    "...", FloatingText.Dodge);
                break;
        }
    }

    // ------------------------------------------------------------------- UI

    private void BuildUi()
    {
        _ui = new CanvasLayer { Name = "CombatUI" };
        AddChild(_ui);

        // Floating text sits behind nameplates so plates stay readable.
        _floatingLayer = new Control { Name = "Floating", MouseFilter = Control.MouseFilterEnum.Ignore };
        _floatingLayer.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        _ui.AddChild(_floatingLayer);

        _nameplateLayer = new Control { Name = "Nameplates", MouseFilter = Control.MouseFilterEnum.Ignore };
        _nameplateLayer.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        _ui.AddChild(_nameplateLayer);

        BuildTopBar();
        BuildBanner();
    }

    private void BuildTopBar()
    {
        var panel = new PanelContainer { Name = "TopBar", MouseFilter = Control.MouseFilterEnum.Ignore };
        panel.SetAnchorsPreset(Control.LayoutPreset.TopWide);
        panel.OffsetTop = 12; panel.OffsetLeft = 0; panel.OffsetRight = 0;
        var style = new StyleBoxFlat
        {
            BgColor = new Color(0.06f, 0.05f, 0.08f, 0.72f),
            ContentMarginTop = 8, ContentMarginBottom = 8,
            ContentMarginLeft = 16, ContentMarginRight = 16,
        };
        style.SetCornerRadiusAll(6);
        panel.AddThemeStyleboxOverride("panel", style);

        var vbox = new VBoxContainer();
        panel.AddChild(vbox);

        _topBar = new Label
        {
            Text = "Round 1  •  Lock In",
            HorizontalAlignment = HorizontalAlignment.Center,
        };
        _topBar.AddThemeFontSizeOverride("font_size", 26);
        _topBar.AddThemeColorOverride("font_color", new Color(1f, 0.95f, 0.85f));
        vbox.AddChild(_topBar);

        _turnTimer = new ProgressBar
        {
            CustomMinimumSize = new Vector2(420, 12),
            MinValue = 0, MaxValue = 100, Value = 100, ShowPercentage = false,
            SizeFlagsHorizontal = Control.SizeFlags.ShrinkCenter,
        };
        var fill = new StyleBoxFlat { BgColor = new Color(0.95f, 0.78f, 0.25f) };
        fill.SetCornerRadiusAll(4);
        var bg = new StyleBoxFlat { BgColor = new Color(0.15f, 0.13f, 0.16f) };
        bg.SetCornerRadiusAll(4);
        _turnTimer.AddThemeStyleboxOverride("fill", fill);
        _turnTimer.AddThemeStyleboxOverride("background", bg);
        vbox.AddChild(_turnTimer);

        _ui.AddChild(panel);
    }

    private void BuildBanner()
    {
        _banner = new Label
        {
            Text = "",
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Visible = false,
            MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        _banner.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        _banner.AddThemeFontSizeOverride("font_size", 84);
        _banner.AddThemeColorOverride("font_outline_color", new Color(0, 0, 0, 0.85f));
        _banner.AddThemeConstantOverride("outline_size", 12);
        _ui.AddChild(_banner);
    }

    private void UpdateTopBar()
    {
        string phase = _state.Phase switch
        {
            Phase.Prompt => "Lock In",
            Phase.Resolve => "Resolving",
            _ => _state.Phase.ToString(),
        };
        _topBar.Text = $"Round {_state.RoundNumber}  •  {phase}";
    }

    private async System.Threading.Tasks.Task AnimateTurnTimer()
    {
        // Compressed visual of the 20s lock-in: fill drains over ~0.9s (or fast).
        float drain = LungeTime < 0.1f ? 0.12f : 0.9f;
        _turnTimer.Value = 100;
        var tween = CreateTween();
        tween.TweenProperty(_turnTimer, "value", 0.0, drain);
        await ToSignal(tween, Tween.SignalName.Finished);
    }

    private void ShowBanner()
    {
        _turnTimer.Value = 0;
        if (_state.Phase == Phase.Won)
        {
            _banner.Text = "VIEWERS WIN!";
            _banner.AddThemeColorOverride("font_color", new Color(0.45f, 0.95f, 0.5f));
            _topBar.Text = $"Boss defeated in {_state.RoundNumber} rounds";
        }
        else
        {
            _banner.Text = "BOSS WINS!";
            _banner.AddThemeColorOverride("font_color", new Color(0.95f, 0.35f, 0.35f));
            _topBar.Text = $"Party wiped in {_state.RoundNumber} rounds";
        }
        _banner.Visible = true;
        _banner.Modulate = new Color(1, 1, 1, 0);
        var tween = CreateTween();
        tween.TweenProperty(_banner, "modulate:a", 1.0, 0.5f);
        tween.Parallel().TweenProperty(_banner, "scale", Vector2.One, 0.5f)
            .From(new Vector2(1.4f, 1.4f));
        _banner.PivotOffset = _banner.Size / 2;
    }

    // --------------------------------------------------------------- helpers

    private async System.Threading.Tasks.Task Wait(float seconds)
    {
        await ToSignal(GetTree().CreateTimer(seconds), SceneTreeTimer.SignalName.Timeout);
    }
}
