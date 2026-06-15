#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Godot;

namespace TotalPartyKrawl.Game.Net;

/// <summary>
/// All networking for the live "Fight Me" path. Owns:
///  - Twitch OAuth Device Code Grant pairing (link the streamer's account), with the
///    user access token persisted to <c>user://twitch_token.json</c> for reuse.
///  - The relay host session (<c>POST /api/host/session</c>) → a short-lived host JWT,
///    re-minted on 401/expiry.
///  - Reading the roster + viewer moves and publishing match state.
///
/// Pure networking + DTOs only. NO game logic — combat math stays in <c>combat/</c>.
/// Uses <see cref="System.Net.Http.HttpClient"/> (one shared instance per the .NET
/// guidance). Methods are async and safe to await from a Godot node.
///
/// NOTE for the human: <see cref="RelayConfig.TwitchClientId"/> must be a Twitch
/// *application* client_id with the Device Code Grant flow enabled — this can differ
/// from the extension client_id.
/// </summary>
public sealed class RelayClient
{
    private static readonly System.Net.Http.HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };

    private const string TwitchDeviceUrl = "https://id.twitch.tv/oauth2/device";
    private const string TwitchTokenUrl = "https://id.twitch.tv/oauth2/token";
    private const string TokenFilePath = "user://twitch_token.json";

    private readonly RelayConfig _config;

    // ---- Twitch user token (persisted) ----
    private string? _twitchAccessToken;
    private string? _twitchRefreshToken;

    // ---- Host session (in-memory, re-minted as needed) ----
    private string? _hostToken;
    private long _hostExpiresAtMs;

    /// <summary>The channel id (== Twitch user id) once a host session is established.</summary>
    public string? ChannelId { get; private set; }

    /// <summary>True once a Twitch user token is held (loaded from disk or freshly paired).</summary>
    public bool IsPaired => !string.IsNullOrEmpty(_twitchAccessToken);

    public RelayClient(RelayConfig config)
    {
        _config = config;
        LoadPersistedToken();
    }

    // =====================================================================
    //  Twitch OAuth Device Code Grant
    // =====================================================================

    /// <summary>What <see cref="BeginDevicePairingAsync"/> hands back to the UI to show the user.</summary>
    public sealed record DeviceCode(
        string DeviceCodeValue,
        string UserCode,
        string VerificationUri,
        int IntervalSeconds,
        int ExpiresInSeconds);

    /// <summary>
    /// Step 1 of pairing: ask Twitch for a device + user code. The UI shows
    /// <see cref="DeviceCode.VerificationUri"/> and the big <see cref="DeviceCode.UserCode"/>,
    /// then calls <see cref="PollForTokenAsync"/> to wait for the user to authorize.
    /// </summary>
    public async Task<DeviceCode> BeginDevicePairingAsync(CancellationToken ct = default)
    {
        RequireClientId();

        var form = new Dictionary<string, string>
        {
            ["client_id"] = _config.TwitchClientId,
            ["scopes"] = _config.Scopes ?? "",
        };

        using var resp = await Http.PostAsync(
            TwitchDeviceUrl, new FormUrlEncodedContent(form), ct);
        string body = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
            throw new RelayException($"Twitch device request failed ({(int)resp.StatusCode}): {body}");

        var dto = JsonSerializer.Deserialize<DeviceCodeDto>(body)
            ?? throw new RelayException("Twitch device response was empty.");

        return new DeviceCode(
            dto.device_code ?? "",
            dto.user_code ?? "",
            dto.verification_uri ?? "",
            dto.interval > 0 ? dto.interval : 5,
            dto.expires_in > 0 ? dto.expires_in : 1800);
    }

    /// <summary>
    /// Step 2 of pairing: poll the token endpoint every <c>interval</c> seconds until the
    /// user authorizes (or the device code expires / is cancelled). On success the access
    /// + refresh tokens are stored and persisted to <c>user://twitch_token.json</c>.
    /// Returns true once paired.
    /// </summary>
    public async Task<bool> PollForTokenAsync(DeviceCode device, CancellationToken ct = default)
    {
        RequireClientId();

        var deadline = DateTime.UtcNow.AddSeconds(device.ExpiresInSeconds);
        int interval = Math.Max(1, device.IntervalSeconds);

        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            await Task.Delay(TimeSpan.FromSeconds(interval), ct);

            var form = new Dictionary<string, string>
            {
                ["client_id"] = _config.TwitchClientId,
                ["scope"] = _config.Scopes ?? "",
                ["device_code"] = device.DeviceCodeValue,
                ["grant_type"] = "urn:ietf:params:oauth:grant-type:device_code",
            };

            using var resp = await Http.PostAsync(
                TwitchTokenUrl, new FormUrlEncodedContent(form), ct);
            string body = await resp.Content.ReadAsStringAsync(ct);

            if (resp.IsSuccessStatusCode)
            {
                var tok = JsonSerializer.Deserialize<TokenDto>(body)
                    ?? throw new RelayException("Twitch token response was empty.");
                _twitchAccessToken = tok.access_token;
                _twitchRefreshToken = tok.refresh_token;
                PersistToken();
                return true;
            }

            // The device-code flow signals "keep waiting" via specific errors.
            string err = TryReadError(body);
            if (err == "authorization_pending")
                continue; // user hasn't approved yet
            if (err == "slow_down")
            {
                interval += 5; // Twitch wants a longer gap
                continue;
            }
            if (err == "expired_token" || err == "authorization_expired")
                return false; // code timed out; UI should restart pairing

            // access_denied or any other terminal error.
            throw new RelayException($"Twitch pairing failed: {err} ({body})");
        }

        return false;
    }

    /// <summary>Forget the persisted Twitch token + any host session (sign out).</summary>
    public void ClearPairing()
    {
        _twitchAccessToken = null;
        _twitchRefreshToken = null;
        _hostToken = null;
        ChannelId = null;
        if (FileAccess.FileExists(TokenFilePath))
            DirAccess.RemoveAbsolute(ProjectSettings.GlobalizePath(TokenFilePath));
    }

    // =====================================================================
    //  Host session
    // =====================================================================

    /// <summary>
    /// Ensure we hold a valid host-session JWT (re-minting from the Twitch token if absent
    /// or expired) and return it. Sets <see cref="ChannelId"/>. Requires <see cref="IsPaired"/>.
    /// </summary>
    public async Task<string> EnsureHostSessionAsync(CancellationToken ct = default)
    {
        // 60s safety margin against clock skew / in-flight expiry.
        bool fresh = _hostToken is not null
            && _hostExpiresAtMs > DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 60_000;
        if (fresh)
            return _hostToken!;

        return await MintHostSessionAsync(ct);
    }

    private async Task<string> MintHostSessionAsync(CancellationToken ct)
    {
        if (string.IsNullOrEmpty(_twitchAccessToken))
            throw new RelayException("Not paired with Twitch — call pairing first.");

        using var req = new HttpRequestMessage(HttpMethod.Post, $"{_config.ApiBase}/api/host/session");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _twitchAccessToken);
        req.Content = new StringContent("{}", Encoding.UTF8, "application/json");

        using var resp = await Http.SendAsync(req, ct);
        string body = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
            throw new RelayException($"host/session failed ({(int)resp.StatusCode}): {body}");

        var dto = JsonSerializer.Deserialize<HostSessionDto>(body)
            ?? throw new RelayException("host/session response was empty.");

        _hostToken = dto.hostToken;
        _hostExpiresAtMs = dto.expiresAt;
        ChannelId = dto.channelId;
        return _hostToken ?? throw new RelayException("host/session returned no token.");
    }

    // =====================================================================
    //  Roster / moves / publish
    // =====================================================================

    /// <summary>A seat as returned by <c>GET /api/host/seats</c>.</summary>
    public sealed record Seat(
        int SeatIndex, string? OpaqueUserId, string? ClassId, int Hp, int MaxHp, bool Alive);

    /// <summary>A viewer lock-in as returned by <c>GET /api/host/moves</c>.</summary>
    public sealed record Move(int SeatIndex, string MoveId, string? TargetId);

    /// <summary>Read the channel's current seat roster (host-authenticated).</summary>
    public async Task<IReadOnlyList<Seat>> GetSeatsAsync(CancellationToken ct = default)
    {
        var dto = await GetHostJsonAsync<SeatsDto>("/api/host/seats", ct);
        var list = new List<Seat>();
        foreach (var s in dto.seats ?? Array.Empty<SeatDto>())
            list.Add(new Seat(s.seatIndex, s.opaqueUserId, s.classId, s.hp, s.maxHp, s.alive));
        return list;
    }

    /// <summary>Read the viewer lock-ins for a round (the secure, host-scoped path).</summary>
    public async Task<IReadOnlyList<Move>> GetMovesAsync(int round, CancellationToken ct = default)
    {
        var dto = await GetHostJsonAsync<MovesDto>($"/api/host/moves?round={round}", ct);
        var list = new List<Move>();
        foreach (var m in dto.moves ?? Array.Empty<MoveDto>())
            list.Add(new Move(m.seatIndex, m.moveId ?? "", m.targetId));
        return list;
    }

    /// <summary>Boss mirror in a publish payload.</summary>
    public sealed record BossState(int Hp, int MaxHp, bool Alive);

    /// <summary>Seat mirror in a publish payload.</summary>
    public sealed record SeatState(int SeatIndex, int Hp, int MaxHp, bool Alive, string? ClassId);

    /// <summary>
    /// Publish the post-resolve (or prompt) state to the relay. <paramref name="phase"/> is
    /// one of <c>lockin | resolving | won | lost</c>. Pass <paramref name="endsAtEpochMs"/>
    /// on a <c>lockin</c> publish so the extension can show the soft countdown. The relay
    /// broadcasts only this non-sensitive state; never move data.
    /// </summary>
    public async Task PublishAsync(
        int round,
        string phase,
        BossState boss,
        IReadOnlyList<SeatState> seats,
        long? endsAtEpochMs = null,
        object? snapshot = null,
        CancellationToken ct = default)
    {
        string token = await EnsureHostSessionAsync(ct);

        var payload = new PublishDto
        {
            round = round,
            phase = phase,
            endsAtEpochMs = endsAtEpochMs,
            boss = new BossDto { hp = boss.Hp, maxHp = boss.MaxHp, alive = boss.Alive },
            seats = seats.Select(s => new PublishSeatDto
            {
                seatIndex = s.SeatIndex, hp = s.Hp, maxHp = s.MaxHp, alive = s.Alive, classId = s.ClassId,
            }).ToArray(),
            snapshot = snapshot,
        };

        string json = JsonSerializer.Serialize(payload, JsonOpts);

        using var req = new HttpRequestMessage(HttpMethod.Post, $"{_config.ApiBase}/api/host/publish");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Content = new StringContent(json, Encoding.UTF8, "application/json");

        using var resp = await Http.SendAsync(req, ct);
        if (resp.StatusCode == HttpStatusCode.Unauthorized)
        {
            // Host token expired between EnsureHostSession and now — re-mint once and retry.
            token = await MintHostSessionAsync(ct);
            using var retry = new HttpRequestMessage(HttpMethod.Post, $"{_config.ApiBase}/api/host/publish");
            retry.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            retry.Content = new StringContent(json, Encoding.UTF8, "application/json");
            using var retryResp = await Http.SendAsync(retry, ct);
            await ThrowIfNotOk(retryResp, "host/publish");
            return;
        }
        await ThrowIfNotOk(resp, "host/publish");
    }

    // =====================================================================
    //  Internals
    // =====================================================================

    private async Task<T> GetHostJsonAsync<T>(string path, CancellationToken ct)
    {
        string token = await EnsureHostSessionAsync(ct);

        async Task<HttpResponseMessage> Send(string t)
        {
            var req = new HttpRequestMessage(HttpMethod.Get, $"{_config.ApiBase}{path}");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", t);
            return await Http.SendAsync(req, ct);
        }

        var resp = await Send(token);
        if (resp.StatusCode == HttpStatusCode.Unauthorized)
        {
            resp.Dispose();
            token = await MintHostSessionAsync(ct); // re-mint once on expiry
            resp = await Send(token);
        }

        string body = await resp.Content.ReadAsStringAsync(ct);
        var status = resp.StatusCode;
        resp.Dispose();

        if (status != HttpStatusCode.OK)
            throw new RelayException($"GET {path} failed ({(int)status}): {body}");

        return JsonSerializer.Deserialize<T>(body, JsonOpts)
            ?? throw new RelayException($"GET {path} returned empty body.");
    }

    private static async Task ThrowIfNotOk(HttpResponseMessage resp, string what)
    {
        if (resp.IsSuccessStatusCode) return;
        string body = await resp.Content.ReadAsStringAsync();
        throw new RelayException($"{what} failed ({(int)resp.StatusCode}): {body}");
    }

    private void RequireClientId()
    {
        if (string.IsNullOrWhiteSpace(_config.TwitchClientId))
            throw new RelayException(
                "RelayConfig.TwitchClientId is empty. Set a Twitch APPLICATION client_id " +
                "(Device Code Grant enabled) in res://config/relay_config.tres.");
    }

    private static string TryReadError(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("error", out var e))
                return e.GetString() ?? "";
            if (doc.RootElement.TryGetProperty("message", out var m))
                return m.GetString() ?? "";
        }
        catch { /* non-JSON body */ }
        return body;
    }

    // ---- token persistence (user://) ----

    private void LoadPersistedToken()
    {
        if (!FileAccess.FileExists(TokenFilePath))
            return;
        try
        {
            using var f = FileAccess.Open(TokenFilePath, FileAccess.ModeFlags.Read);
            if (f is null) return;
            string json = f.GetAsText();
            var dto = JsonSerializer.Deserialize<PersistedToken>(json);
            if (dto is not null)
            {
                _twitchAccessToken = dto.accessToken;
                _twitchRefreshToken = dto.refreshToken;
            }
        }
        catch (Exception e)
        {
            GD.PushWarning($"RelayClient: could not read persisted token: {e.Message}");
        }
    }

    private void PersistToken()
    {
        try
        {
            var dto = new PersistedToken
            {
                accessToken = _twitchAccessToken,
                refreshToken = _twitchRefreshToken,
            };
            using var f = FileAccess.Open(TokenFilePath, FileAccess.ModeFlags.Write);
            f?.StoreString(JsonSerializer.Serialize(dto));
        }
        catch (Exception e)
        {
            GD.PushWarning($"RelayClient: could not persist token: {e.Message}");
        }
    }

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNameCaseInsensitive = true,
    };

    // ---- DTOs (match the Twitch + relay JSON shapes verbatim) ----

    private sealed class DeviceCodeDto
    {
        public string? device_code { get; set; }
        public string? user_code { get; set; }
        public string? verification_uri { get; set; }
        public int interval { get; set; }
        public int expires_in { get; set; }
    }

    private sealed class TokenDto
    {
        public string? access_token { get; set; }
        public string? refresh_token { get; set; }
        public int expires_in { get; set; }
    }

    private sealed class HostSessionDto
    {
        public string? hostToken { get; set; }
        public string? channelId { get; set; }
        public long expiresAt { get; set; }
    }

    private sealed class SeatsDto { public SeatDto[]? seats { get; set; } }
    private sealed class SeatDto
    {
        public int seatIndex { get; set; }
        public string? opaqueUserId { get; set; }
        public string? classId { get; set; }
        public int hp { get; set; }
        public int maxHp { get; set; }
        public bool alive { get; set; }
    }

    private sealed class MovesDto { public int round { get; set; } public MoveDto[]? moves { get; set; } }
    private sealed class MoveDto
    {
        public int seatIndex { get; set; }
        public string? moveId { get; set; }
        public string? targetId { get; set; }
    }

    private sealed class PublishDto
    {
        public int round { get; set; }
        public string phase { get; set; } = "";
        public long? endsAtEpochMs { get; set; }
        public BossDto boss { get; set; } = new();
        public PublishSeatDto[] seats { get; set; } = Array.Empty<PublishSeatDto>();
        public object? snapshot { get; set; }
    }
    private sealed class BossDto { public int hp { get; set; } public int maxHp { get; set; } public bool alive { get; set; } }
    private sealed class PublishSeatDto
    {
        public int seatIndex { get; set; }
        public int hp { get; set; }
        public int maxHp { get; set; }
        public bool alive { get; set; }
        public string? classId { get; set; }
    }

    private sealed class PersistedToken
    {
        public string? accessToken { get; set; }
        public string? refreshToken { get; set; }
    }
}

/// <summary>Thrown for any relay/Twitch networking or contract error.</summary>
public sealed class RelayException : Exception
{
    public RelayException(string message) : base(message) { }
}
