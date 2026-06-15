#nullable enable
using Godot;

namespace TotalPartyKrawl.Game.Net;

/// <summary>
/// Connection knobs for the live relay + Twitch pairing, kept as an authorable Godot
/// Resource so they can be tweaked per-build without recompiling. Save an instance as
/// <c>res://config/relay_config.tres</c> and the net scripts will load it; if absent,
/// the hard-coded production defaults below are used.
/// </summary>
[GlobalClass]
public partial class RelayConfig : Resource
{
    /// <summary>Base URL of the Vercel relay (no trailing slash). The LIVE production deploy.</summary>
    [Export]
    public string ApiBase { get; set; } =
        "https://total-party-krawl-guaranteed-genius-projects.vercel.app";

    /// <summary>
    /// Twitch APPLICATION client_id used for the OAuth Device Code Grant. This must be a
    /// Twitch *application* registered with the Device Code Grant flow enabled — it may
    /// DIFFER from the Twitch extension client_id. Set this before pairing will work.
    /// </summary>
    [Export]
    public string TwitchClientId { get; set; } = "";

    /// <summary>
    /// OAuth scopes requested in the device flow. Empty is valid for "Fight Me": the host
    /// session only needs to prove channel ownership, which `oauth2/validate` returns from
    /// any user token. Add scopes here later if a feature needs them.
    /// </summary>
    [Export]
    public string Scopes { get; set; } = "";

    private const string ResPath = "res://config/relay_config.tres";

    /// <summary>Load the authored config, or a default instance if none exists.</summary>
    public static RelayConfig Load()
    {
        if (ResourceLoader.Exists(ResPath)
            && ResourceLoader.Load(ResPath) is RelayConfig cfg)
        {
            return cfg;
        }
        return new RelayConfig();
    }
}
