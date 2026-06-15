#nullable enable
using System;
using System.Threading;
using System.Threading.Tasks;
using Godot;

namespace TotalPartyKrawl.Game.Net;

/// <summary>
/// The "Link Twitch" pairing screen (pair.tscn). Drives the OAuth Device Code Grant:
/// a button starts pairing, the screen shows the verification URL + the big user code
/// ("go to twitch.tv/activate, enter ABCD-EFGH"), polls until the streamer authorizes,
/// then shows "Linked as channel &lt;id&gt;". If already linked, it skips straight to the
/// linked state (with an Unlink option).
///
/// All networking is in <see cref="RelayClient"/>; this node is pure UI glue.
/// </summary>
public partial class PairController : Control
{
    private RelayConfig _config = null!;
    private RelayClient _relay = null!;
    private CancellationTokenSource? _pairCts;

    private Button _linkButton = null!;
    private Button _unlinkButton = null!;
    private Label _title = null!;
    private Label _instructions = null!;
    private Label _userCode = null!;
    private Label _status = null!;

    public override void _Ready()
    {
        _config = RelayConfig.Load();
        _relay = new RelayClient(_config);

        BuildUi();

        if (_relay.IsPaired)
        {
            _ = ShowLinkedAsync();
        }
        else
        {
            SetState(linked: false);
            _status.Text = string.IsNullOrWhiteSpace(_config.TwitchClientId)
                ? "Set a Twitch application client_id in res://config/relay_config.tres first."
                : "Click \"Link Twitch\" to connect your channel.";
        }
    }

    public override void _ExitTree() => _pairCts?.Cancel();

    // ---------------------------------------------------------------- actions

    private async void OnLinkPressed()
    {
        if (string.IsNullOrWhiteSpace(_config.TwitchClientId))
        {
            _status.Text = "Cannot pair: TwitchClientId is empty (see relay_config.tres).";
            return;
        }

        _linkButton.Disabled = true;
        _pairCts = new CancellationTokenSource();
        var ct = _pairCts.Token;

        try
        {
            _status.Text = "Requesting device code…";
            var device = await _relay.BeginDevicePairingAsync(ct);

            _instructions.Text = $"On any device, go to:\n{device.VerificationUri}\nand enter this code:";
            _userCode.Text = device.UserCode;
            _userCode.Visible = true;
            _status.Text = "Waiting for authorization…";

            bool ok = await _relay.PollForTokenAsync(device, ct);
            if (ok)
            {
                await ShowLinkedAsync(ct);
            }
            else
            {
                _status.Text = "Code expired before authorization. Try again.";
                _userCode.Visible = false;
                _linkButton.Disabled = false;
            }
        }
        catch (OperationCanceledException) { /* screen closing or unlinked */ }
        catch (RelayException e)
        {
            _status.Text = $"Pairing failed: {e.Message}";
            _userCode.Visible = false;
            _linkButton.Disabled = false;
        }
        catch (Exception e)
        {
            GD.PushError(e);
            _status.Text = $"Unexpected error: {e.Message}";
            _linkButton.Disabled = false;
        }
    }

    private void OnUnlinkPressed()
    {
        _relay.ClearPairing();
        SetState(linked: false);
        _status.Text = "Unlinked. Click \"Link Twitch\" to connect again.";
    }

    private async Task ShowLinkedAsync(CancellationToken ct = default)
    {
        _status.Text = "Verifying channel…";
        try
        {
            await _relay.EnsureHostSessionAsync(ct);
            SetState(linked: true);
            _status.Text = $"Linked as channel {_relay.ChannelId}. You can start a match.";
        }
        catch (RelayException e)
        {
            // Token may be stale/invalid — let the user re-link.
            _status.Text = $"Link check failed: {e.Message}. Try unlinking and linking again.";
            SetState(linked: false);
        }
    }

    // ---------------------------------------------------------------- UI

    private void SetState(bool linked)
    {
        _linkButton.Visible = !linked;
        _linkButton.Disabled = false;
        _unlinkButton.Visible = linked;
        _userCode.Visible = false;
        _instructions.Visible = !linked;
    }

    private void BuildUi()
    {
        SetAnchorsPreset(LayoutPreset.FullRect);

        var bg = new ColorRect { Color = new Color(0.08f, 0.07f, 0.1f) };
        bg.SetAnchorsPreset(LayoutPreset.FullRect);
        bg.MouseFilter = MouseFilterEnum.Ignore;
        AddChild(bg);

        var center = new CenterContainer();
        center.SetAnchorsPreset(LayoutPreset.FullRect);
        AddChild(center);

        var vbox = new VBoxContainer { CustomMinimumSize = new Vector2(520, 0) };
        vbox.AddThemeConstantOverride("separation", 16);
        center.AddChild(vbox);

        _title = new Label { Text = "Total Party Krawl — Link Twitch", HorizontalAlignment = HorizontalAlignment.Center };
        _title.AddThemeFontSizeOverride("font_size", 30);
        _title.AddThemeColorOverride("font_color", new Color(1f, 0.95f, 0.85f));
        vbox.AddChild(_title);

        _instructions = new Label
        {
            Text = "Link your Twitch channel so viewers can join the fight.",
            HorizontalAlignment = HorizontalAlignment.Center,
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
        };
        _instructions.AddThemeFontSizeOverride("font_size", 17);
        _instructions.AddThemeColorOverride("font_color", new Color(0.82f, 0.84f, 0.92f));
        vbox.AddChild(_instructions);

        _userCode = new Label { Text = "", HorizontalAlignment = HorizontalAlignment.Center, Visible = false };
        _userCode.AddThemeFontSizeOverride("font_size", 56);
        _userCode.AddThemeColorOverride("font_color", new Color(0.95f, 0.78f, 0.25f));
        vbox.AddChild(_userCode);

        _linkButton = new Button { Text = "Link Twitch", CustomMinimumSize = new Vector2(0, 48) };
        _linkButton.Pressed += OnLinkPressed;
        vbox.AddChild(_linkButton);

        _unlinkButton = new Button { Text = "Unlink", Visible = false, CustomMinimumSize = new Vector2(0, 40) };
        _unlinkButton.Pressed += OnUnlinkPressed;
        vbox.AddChild(_unlinkButton);

        _status = new Label
        {
            Text = "", HorizontalAlignment = HorizontalAlignment.Center,
            AutowrapMode = TextServer.AutowrapMode.WordSmart,
        };
        _status.AddThemeFontSizeOverride("font_size", 15);
        _status.AddThemeColorOverride("font_color", new Color(0.7f, 0.75f, 0.85f));
        vbox.AddChild(_status);
    }
}
