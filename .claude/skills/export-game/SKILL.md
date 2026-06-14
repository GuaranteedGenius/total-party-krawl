---
name: export-game
description: Run Godot headless platform exports (Win/Mac/Linux) for a Steam build. SCAFFOLD — refined once export presets and GodotSteam integration exist.
---

# export-game

Headless Godot exports for distribution via Steam.

## Status: SCAFFOLD
export_presets.cfg does not exist yet (and is gitignored). When presets and GodotSteam are set up,
this skill will:

1. Build C#: `& "C:\Program Files\dotnet\dotnet.exe" build` the solution in Release.
2. Export per platform headless, e.g.:
   ```powershell
   & "C:\Users\shawn\Downloads\Godot_v4.6.2-stable_mono_win64\Godot_v4.6.2-stable_mono_win64\Godot_v4.6.2-stable_mono_win64_console.exe" --path "E:\repos\twitch\total-party-krawl\game" --headless --export-release "Windows Desktop" "..\dist\TotalPartyKrawl.exe"
   ```
3. Hand built artifacts to the Steam depot upload (owned by build-release-engineer).
