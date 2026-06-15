#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Godot;
using TotalPartyKrawl.Combat;
using TotalPartyKrawl.Game.Combat;

namespace TotalPartyKrawl.Game.Net;

/// <summary>
/// The LIVE "Fight Me" match loop: pairs the streamer with Twitch, opens a relay host
/// session, builds a real <see cref="CombatEngine"/> from the joined seats, and each
/// round broadcasts a lock-in prompt, reads viewer moves, resolves, animates, and
/// publishes the new state — until someone wins.
///
/// This is the ADDITIVE live path. The offline bot-only <see cref="CombatController"/>
/// is untouched and still drives <c>combat.tscn</c> for headless dev/CI.
///
/// Boundaries:
///  - ALL combat math is in <c>combat/</c> (the engine + <see cref="LiveMatchMapping"/>).
///    This node only sequences the relay calls and plays the engine's results.
///  - The BOSS is the streamer. For now it is auto-driven by <see cref="BossBot"/>.
///    Replacing that with a streamer move-pick UI is the next task — the seam is the
///    single <see cref="DecideBossChoice"/> call below.
/// </summary>
public partial class LiveMatchController : Node3D
{
    // ----- pacing (presentation only; not balance) -----
    [Export] public float StepDelay = 0.85f;
    [Export] public float RoundDelay = 1.1f;
    [Export] public float LungeTime = 0.18f;

    /// <summary>The authoritative lock-in window the game client enforces (spec: 20s).</summary>
    [Export] public float LockWindowSeconds = 20f;

    /// <summary>
    /// TEST/fast mode: use a short lock window and compressed pacing so a live loop can
    /// be exercised quickly (also auto-on if the TPK_LIVE_FAST env var is set).
    /// </summary>
    [Export] public bool FastMode = false;

    /// <summary>Grace window added after the lock timer for late relay arrivals (spec §6 / notes).</summary>
    [Export] public float GraceSeconds = 1.5f;

    [Export] public int BossSeed = 7;

    // ----- scene wiring -----
    [Export] public NodePath BossPath = "boss_model";
    [Export] public NodePath CameraPath = "Camera3D";

    /// <summary>
    /// Model nodes available to bind to joined viewer seats, in preference order. Seats
    /// beyond this pool still run in the engine + publish; they just have no on-screen
    /// model yet (a dynamic-spawn upgrade gate). Defaults match combat.tscn's 3 models.
    /// </summary>
    [Export] public Godot.Collections.Array<NodePath> ViewerModelPaths = new()
    {
        "tank_model", "mage_model", "healer_model",
    };

    private Camera3D _camera = null!;
    private CanvasLayer _ui = null!;
    private Control _nameplateLayer = null!;
    private Control _floatingLayer = null!;
    private Label _topBar = null!;
    private Label _statusLine = null!;
    private Label _banner = null!;

    private RelayConfig _config = null!;
    private RelayClient _relay = null!;

    private CombatEngine? _engine;
    private CombatState? _state;
    private IReadOnlyDictionary<string, MoveDef> _moves = null!;
    private BossBot _bossBot = null!;

    private readonly Dictionary<string, CombatantView> _views = new();
    private readonly CancellationTokenSource _cts = new();

    public override void _Ready()
    {
        if (FastMode || !string.IsNullOrEmpty(OS.GetEnvironment("TPK_LIVE_FAST")))
        {
            FastMode = true;
            StepDelay = 0.12f; RoundDelay = 0.18f; LungeTime = 0.05f;
            LockWindowSeconds = 2f; GraceSeconds = 0.3f;
        }

        _camera = GetNode<Camera3D>(CameraPath);
        _moves = DefaultContent.Moves();
        _bossBot = new BossBot();

        BuildUi();

        _config = RelayConfig.Load();
        _relay = new RelayClient(_config);

        _ = RunLiveAsync(_cts.Token);
    }

    public override void _Process(double delta)
    {
        foreach (var view in _views.Values)
            view.UpdateNameplatePosition(_camera);
    }

    public override void _ExitTree() => _cts.Cancel();

    // =====================================================================
    //  Live loop
    // =====================================================================

    private async Task RunLiveAsync(CancellationToken ct)
    {
        try
        {
            if (!_relay.IsPaired)
            {
                SetStatus("Not linked to Twitch. Open the Pair screen (pair.tscn) and link, then relaunch.");
                return;
            }

            SetStatus("Opening host session…");
            await _relay.EnsureHostSessionAsync(ct);
            SetStatus($"Linked as channel {_relay.ChannelId}. Waiting for players…");

            // Wait for at least one viewer to join a seat (spec §4.4 — no 0-viewer match).
            IReadOnlyList<RelayClient.Seat> seats = await WaitForPlayersAsync(ct);
            if (seats.Count == 0)
            {
                SetStatus("No players joined. Stopping.");
                return;
            }

            BuildEngineFromRoster(seats);
            BindViews();
            SetStatus($"Fight on — {seats.Count} player(s) vs The Warden.");

            await RunRoundsAsync(ct);
            await PublishFinalAsync(ct);
            ShowBanner();
        }
        catch (OperationCanceledException) { /* scene closing */ }
        catch (RelayException e)
        {
            GD.PushError($"LiveMatch relay error: {e.Message}");
            SetStatus($"Relay error: {e.Message}");
        }
        catch (Exception e)
        {
            GD.PushError($"LiveMatch error: {e}");
            SetStatus($"Error: {e.Message}");
        }
    }

    private async Task<IReadOnlyList<RelayClient.Seat>> WaitForPlayersAsync(CancellationToken ct)
    {
        // Poll the roster until a seat is claimed (with a class) or the scene closes.
        // A short test cap keeps the fast-mode loop from hanging headless.
        int maxPolls = FastMode ? 3 : int.MaxValue;
        for (int i = 0; i < maxPolls && !ct.IsCancellationRequested; i++)
        {
            var seats = (await _relay.GetSeatsAsync(ct))
                .Where(s => s.Alive && !string.IsNullOrEmpty(s.ClassId))
                .ToList();
            if (seats.Count > 0)
                return seats;

            SetStatus($"Waiting for players… ({i + 1})");
            await Task.Delay(TimeSpan.FromSeconds(FastMode ? 1 : 2), ct);
        }
        return Array.Empty<RelayClient.Seat>();
    }

    private void BuildEngineFromRoster(IReadOnlyList<RelayClient.Seat> seats)
    {
        var roster = seats
            .Select(s => new RosterSeat(s.SeatIndex, s.ClassId!, s.Alive))
            .ToList();

        var party = LiveMatchMapping.BuildParty(roster); // §4.3 active set locked here
        var rng = new Random(BossSeed);

        _engine = CombatEngine.CreateFight(
            party,
            DefaultContent.Classes(),
            DefaultContent.Warden(),
            _moves,
            DefaultContent.Tuning(),
            rng);
        _state = _engine.State;
    }

    private async Task RunRoundsAsync(CancellationToken ct)
    {
        await Wait(0.4f);

        while (_state is { IsOver: false })
        {
            ct.ThrowIfCancellationRequested();
            int round = _state.RoundNumber;
            UpdateTopBar();

            // --- LOCK-IN: open the window + broadcast the prompt to viewers. ---
            long endsAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                          + (long)(LockWindowSeconds * 1000);
            await PublishStateAsync(round, "lockin", endsAt, ct);

            await WaitForLockWindow(round);

            // Grace window for late arrivals, then read the final lock-ins.
            await Wait(GraceSeconds);
            var moves = await _relay.GetMovesAsync(round, ct);
            ApplyViewerLockIns(moves);
            ApplyBossLockIn(); // streamer seam (BossBot for now)

            // --- RESOLVE (pure engine) ---
            await PublishStateAsync(round, "resolving", null, ct);
            _engine!.ResolveRound();

            // --- ANIMATE the ordered results ---
            foreach (var result in _engine.LastRoundResults.ToArray())
            {
                await PlayResult(result);
                await Wait(StepDelay);
            }

            // --- PUBLISH the new state (next round's mirror) ---
            string phase = _state.Phase switch
            {
                Phase.Won => "won",
                Phase.Lost => "lost",
                _ => "lockin",
            };
            // For an ongoing fight we publish the post-round mirror without a timer; the
            // next loop iteration opens the next lock window with a fresh endsAt.
            await PublishStateAsync(_state.RoundNumber, phase == "lockin" ? "resolving" : phase, null, ct);

            await Wait(RoundDelay);
            if (round > 200) break; // stalemate guard
        }
    }

    private void ApplyViewerLockIns(IReadOnlyList<RelayClient.Move> moves)
    {
        var roster = moves.Select(m => new RosterMove(m.SeatIndex, m.MoveId, m.TargetId));
        foreach (var (combatantId, choice) in LiveMatchMapping.ResolveViewerLockIns(_state!, roster))
            _engine!.SubmitLock(combatantId, choice.MoveId, choice.TargetId);
    }

    /// <summary>
    /// SEAM: the boss is the streamer. Today its action is decided by the offline
    /// <see cref="BossBot"/>. The streamer move-pick UI replaces exactly this method.
    /// </summary>
    private MoveChoice DecideBossChoice() => _bossBot.Decide(_state!.Boss, _state, _moves);

    private void ApplyBossLockIn()
    {
        var boss = _state!.Boss;
        if (!boss.IsAlive) return;
        var choice = DecideBossChoice();
        _engine!.SubmitLock(boss.Id, choice.MoveId, choice.TargetId);
    }

    private async Task PublishStateAsync(int round, string phase, long? endsAtEpochMs, CancellationToken ct)
    {
        var boss = _state!.Boss;
        var seatStates = _state.Viewers
            .Select(v => new RelayClient.SeatState(v.SeatIndex, v.CurrentHp, v.MaxHp, v.IsAlive, v.DefId))
            .ToList();

        // A compact snapshot the extension's /api/state echoes back to viewers.
        var snapshot = new
        {
            round,
            phase,
            boss = new { hp = boss.CurrentHp, maxHp = boss.MaxHp, alive = boss.IsAlive },
            seats = seatStates.Select(s => new { seatIndex = s.SeatIndex, hp = s.Hp, maxHp = s.MaxHp, alive = s.Alive, classId = s.ClassId }),
        };

        await _relay.PublishAsync(
            round, phase,
            new RelayClient.BossState(boss.CurrentHp, boss.MaxHp, boss.IsAlive),
            seatStates,
            endsAtEpochMs,
            snapshot,
            ct);
    }

    private async Task PublishFinalAsync(CancellationToken ct)
    {
        if (_state is null) return;
        string phase = _state.Phase == Phase.Won ? "won" : "lost";
        await PublishStateAsync(_state.RoundNumber, phase, null, ct);
    }

    // =====================================================================
    //  View binding + animation (reuses CombatantView / Nameplate / FloatingText)
    // =====================================================================

    private void BindViews()
    {
        if (_state is null) return;

        // Boss.
        if (HasModelNode(BossPath))
            AddView(_state.Boss, GetNode<Node3D>(BossPath), "The Warden", "Boss");

        // Viewers → model pool (best effort).
        int idx = 0;
        foreach (var viewer in _state.Viewers.OrderBy(v => v.SeatIndex))
        {
            if (idx >= ViewerModelPaths.Count) break; // no model for this seat yet
            var path = ViewerModelPaths[idx++];
            if (!HasModelNode(path)) continue;
            string className = ClassLabel(viewer.DefId);
            AddView(viewer, GetNode<Node3D>(path), $"Seat {viewer.SeatIndex}", className);
        }
    }

    private static string ClassLabel(string classId) => classId switch
    {
        DefaultContent.ClassTank => "Tank",
        DefaultContent.ClassMage => "Mage",
        DefaultContent.ClassHealer => "Healer",
        _ => classId,
    };

    private void AddView(Combatant c, Node3D model, string displayName, string className)
    {
        var plate = Nameplate.Create(displayName, className, c.CurrentHp, c.MaxHp, c.IsBoss);
        _nameplateLayer.AddChild(plate.Root);
        _views[c.Id] = new CombatantView(c, model, plate);
    }

    private async Task PlayResult(ActionResult r)
    {
        if (!_views.TryGetValue(r.ActorId, out var actor))
            return; // no on-screen model for this seat — engine state still advanced.
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
                        FloatingText.Spawn(_floatingLayer, _camera, target.AnchorWorld(), "DODGE", FloatingText.Dodge);
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
                        FloatingText.Spawn(_floatingLayer, _camera, target.AnchorWorld(), $"+{r.Amount}", FloatingText.Heal);
                    target.SetHp(r.TargetHpAfter, r.TargetMaxHp);
                    target.HealPulse();
                }
                break;

            case ActionResultKind.Taunt:
                actor.CastPulse();
                FloatingText.Spawn(_floatingLayer, _camera, actor.AnchorWorld(), "TAUNT!", FloatingText.Taunt);
                break;

            case ActionResultKind.Skip:
                FloatingText.Spawn(_floatingLayer, _camera, actor.AnchorWorld(), "...", FloatingText.Dodge);
                break;
        }
    }

    // =====================================================================
    //  UI
    // =====================================================================

    private void BuildUi()
    {
        _ui = new CanvasLayer { Name = "LiveUI" };
        AddChild(_ui);

        _floatingLayer = new Control { Name = "Floating", MouseFilter = Control.MouseFilterEnum.Ignore };
        _floatingLayer.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        _ui.AddChild(_floatingLayer);

        _nameplateLayer = new Control { Name = "Nameplates", MouseFilter = Control.MouseFilterEnum.Ignore };
        _nameplateLayer.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        _ui.AddChild(_nameplateLayer);

        var panel = new PanelContainer { Name = "TopBar", MouseFilter = Control.MouseFilterEnum.Ignore };
        panel.SetAnchorsPreset(Control.LayoutPreset.TopWide);
        panel.OffsetTop = 12;
        var style = new StyleBoxFlat
        {
            BgColor = new Color(0.06f, 0.05f, 0.08f, 0.72f),
            ContentMarginTop = 8, ContentMarginBottom = 8, ContentMarginLeft = 16, ContentMarginRight = 16,
        };
        style.SetCornerRadiusAll(6);
        panel.AddThemeStyleboxOverride("panel", style);
        var vbox = new VBoxContainer();
        panel.AddChild(vbox);

        _topBar = new Label { Text = "Live Match", HorizontalAlignment = HorizontalAlignment.Center };
        _topBar.AddThemeFontSizeOverride("font_size", 26);
        _topBar.AddThemeColorOverride("font_color", new Color(1f, 0.95f, 0.85f));
        vbox.AddChild(_topBar);

        _statusLine = new Label { Text = "Starting…", HorizontalAlignment = HorizontalAlignment.Center };
        _statusLine.AddThemeFontSizeOverride("font_size", 15);
        _statusLine.AddThemeColorOverride("font_color", new Color(0.8f, 0.82f, 0.9f));
        vbox.AddChild(_statusLine);

        _ui.AddChild(panel);

        _banner = new Label
        {
            Text = "", HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
            Visible = false, MouseFilter = Control.MouseFilterEnum.Ignore,
        };
        _banner.SetAnchorsPreset(Control.LayoutPreset.FullRect);
        _banner.AddThemeFontSizeOverride("font_size", 84);
        _banner.AddThemeColorOverride("font_outline_color", new Color(0, 0, 0, 0.85f));
        _banner.AddThemeConstantOverride("outline_size", 12);
        _ui.AddChild(_banner);
    }

    private void UpdateTopBar()
    {
        if (_state is null) return;
        _topBar.Text = $"Round {_state.RoundNumber}  •  Lock In";
    }

    private void SetStatus(string text)
    {
        GD.Print($"[LiveMatch] {text}");
        if (_statusLine is not null)
            _statusLine.Text = text;
    }

    private void ShowBanner()
    {
        if (_state is null) return;
        if (_state.Phase == Phase.Won)
        {
            _banner.Text = "VIEWERS WIN!";
            _banner.AddThemeColorOverride("font_color", new Color(0.45f, 0.95f, 0.5f));
        }
        else if (_state.Phase == Phase.Lost)
        {
            _banner.Text = "BOSS WINS!";
            _banner.AddThemeColorOverride("font_color", new Color(0.95f, 0.35f, 0.35f));
        }
        else return;

        _banner.Visible = true;
        _banner.Modulate = new Color(1, 1, 1, 0);
        var tween = CreateTween();
        tween.TweenProperty(_banner, "modulate:a", 1.0, 0.5f);
    }

    // =====================================================================
    //  helpers
    // =====================================================================

    private bool HasModelNode(NodePath path) => path is not null && GetNodeOrNull(path) is Node3D;

    private async Task WaitForLockWindow(int round)
    {
        SetStatus($"Round {round}: lock-in open ({LockWindowSeconds:0}s)…");
        await Wait(LockWindowSeconds);
    }

    private async Task Wait(float seconds)
    {
        if (seconds <= 0) return;
        await ToSignal(GetTree().CreateTimer(seconds), SceneTreeTimer.SignalName.Timeout);
    }
}
