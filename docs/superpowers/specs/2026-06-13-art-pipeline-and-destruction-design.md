# Design: Full-Project Agent Team + First Step (Art Pipeline + Destruction)

**Date:** 2026-06-13
**Status:** Approved (design phase)
**Scope:** Stand up a comprehensive Claude agent/skill/hook team scoped to the **entire**
Total Party Krawl project, then deliver the first visible milestone — the game's distinctive
look plus a destructible-scenery test — on the existing Godot art-test scene.

---

## 1. Context (where the project actually is)

Total Party Krawl is a Godot 4 / C# game + a free Twitch extension for small streamers (1–10
viewers). Viewers join as individual RPG characters and fight turn-based combat against or
alongside the streamer. Full product detail lives in `CLAUDE.md`.

Current repo state:

- The repo was reset to a clean slate (commit `429f15c`). A prior MVP prototype existed but
  used the **abandoned chat-voting model** (single streamer-vs-chat boss, `votes_json`), not
  the current per-viewer 10-seat design.
- Active work is an **art-style test** in Godot: `game/scenes/art_test.tscn` places whole props
  (3 barrels, 3 crates, 2 pillars) plus a boss model, a player model, and a test floor.
- **Prep for breakable scenery is done but the test is not built:** pre-fractured meshes exist
  (`barrel_wood_1_fragments.glb`, `crate_wood_1_fragments.glb`, `pillar_stone_1_fragments.glb`)
  and Jolt Physics is selected, but no script swaps a whole prop for its fragments, and there
  is no camera, lighting, shader, or C# script yet.

### Known issues to resolve

- **Engine version mismatch:** `game/project.godot` declares feature `"4.6"`, but the installed
  binary is `Godot_v4.5.1-stable_mono_win64`. Decision: set the project to `"4.5"` to match the
  installed engine (no download required). Override only if 4.6-specific features are needed.
- **Stale residue (flag, do not fix now):** `package.json` is still named `twitch-boss-battle`;
  `lib/supabase.ts` and `supabase/schema.sql` still encode the abandoned chat-voting model.
  Clean these up when the backend layer is actually built, to avoid churn during the art phase.

---

## 2. Goals / Non-goals

**Goals**
- A comprehensive agent/skill/hook team scoped to the **entire project lifecycle**, so we move
  as one coordinated unit from the first art test through to Steam release.
- The game's distinctive look working on `art_test.tscn`: 3/4 top-down narrow-FOV camera,
  lighting, cel shading, screen-space outlines, and color grading.
- A working destruction test: trigger a prop to shatter into its pre-fractured pieces with
  Jolt physics scattering the debris.

**Non-goals (this milestone)**
- Implementing the actual combat engine, seats, classes, turns, progression — those are owned
  by the new agents but built in later milestones.
- Cleaning up stale prototype residue (deferred to the backend milestone).

**Considered and deliberately excluded from the team** (recorded so they're known, not missed):
3D-asset/modeling agent (assets are authored by the user in Blender), audio-designer (no audio
in scope yet), marketing/community agent (not engineering). Add later if the need is real.

---

## 3. The agent/skill/hook team (full project scope)

**Decision: build everything now.** All 7 agent definitions, all skills, and all hooks are
created in this milestone — including skills/hooks for layers (`api/`, `extension/`, Steam
export) that have no code yet, which are created as working-but-dormant scaffolds clearly
marked to be refined when that layer lands. Rationale: maximum shared structure up front so
every future layer slots into an existing home.

### 3.1 Subagents (`.claude/agents/`) — the standing team

Domain builders (one per architecture layer + the two specialties):

| Agent | Responsibility |
|---|---|
| `godot-gameplay-engineer` | C# game logic: combat engine (20-sec simultaneous lock-in, DEX-order resolution), 4 stats (STR/INT/DEX/CON), 10-seat system, data-driven class/boss/enemy systems, scene/node architecture, Jolt physics, input |
| `godot-art-pipeline` | Visual identity: cel shading, outlines, color grading, lighting, materials, 3/4 narrow-FOV perspective camera, VFX (fireballs/AOE), destructible environments + debris, GLB import settings, the 3 overlay layouts (full / facecam-left / facecam-right) |
| `backend-relay-engineer` | Vercel serverless (TS) + Supabase Realtime relay + persistence, Twitch JWT verification, move relay, turn-sync/latency strategy (client = clock authority, soft extension timer, server grace window), leaderboards/progression storage, RLS |
| `twitch-extension-dev` | Viewer controller panel (HTML/JS), Twitch Extension Helper SDK, panel/overlay/config/live-config pages, seat-join UI, class pick, move submit, Bits products |
| `game-designer` | Data-driven content + balance: classes, bosses, enemies, moves, stat curves, XP/level/loot progression, encounter design; owns the data schemas the engine consumes |

Lifecycle / cross-cutting:

| Agent | Responsibility |
|---|---|
| `build-release-engineer` | Godot export presets (Win/Mac/Linux), GodotSteam/Steamworks integration, Steam depots/builds, Vercel deploy, extension packaging, CI, versioning |
| `qa-test-engineer` | Test strategy across all 3 components: C# combat unit tests, TS API tests, extension integration via mock-Twitch test harness, regression + playtest checklists |

The **main thread acts as integrator/architect** — routing work to these agents and using the
existing `code-review` / `feature-dev` skills for cross-cutting review, rather than a redundant
"tech-lead" agent.

Each agent definition includes: a focused system prompt for its domain, the project's
architecture principles from `CLAUDE.md` (esp. "all game logic + rendering in Godot; server is
a thin relay; extension is a controller"), the decision-making principle ("right choice, not
easiest"), and a pointer to relevant directories.

### 3.2 Skills (`.claude/skills/`)

| Skill | State | Purpose |
|---|---|---|
| `run-godot` | active | Launch any Godot scene headless on the installed 4.5.1 binary, capture a screenshot, return result. The art/iteration feedback loop. Path: `C:\Program Files\Godot\Godot_v4.5.1-stable_mono_win64_console.exe` |
| `author-content` | scaffold | Scaffold + validate a data-driven class/boss/move/enemy entry against the schema. Refined once `game-designer` defines schemas. |
| `package-extension` | scaffold | Build + zip the Twitch extension for upload. Refined once `extension/` has content. |
| `deploy-backend` | scaffold | Vercel deploy + Supabase schema migrate. Refined once `api/` has content. |
| `export-game` | scaffold | Godot headless export presets per platform for Steam. Refined once export presets exist. |

Scaffold skills are real, documented, and runnable where possible; they self-note what is
pending and what will change when their layer lands.

### 3.3 Hooks (`.claude/settings.json`)

| Hook | Event | Purpose |
|---|---|---|
| `secret-guard` | PreToolUse | Block edits to / git-staging of `.env`, `.env.local`, key files so secrets are never committed (relevant now: `.env.local` has real-looking creds) |
| `csharp-format` | PostToolUse (`.cs`) | Run `dotnet format` after C# edits |
| `ts-lint-format` | PostToolUse (`.ts`/`.js`) | Format/lint `api/`, `extension/`, `lib/` (dormant until those have code) |
| `godot-asset-guard` | PreToolUse / PostToolUse | Ensure `.glb` has its `.import` committed and binaries are handled per `.gitattributes` |
| `no-logic-on-server` | PreToolUse | Warn if game-logic-looking code appears under `api/` — enforces the "no game logic on the server" architecture principle |

---

## 4. First step — "look + destruction" on `art_test.tscn`

Owned by `godot-art-pipeline` (look) and `godot-gameplay-engineer` (destruction script). Build
order, each step independently verifiable via `run-godot`:

1. **Engine version** — set `project.godot` feature `"4.6"` → `"4.5"`.
2. **Camera** — `Camera3D`, perspective, narrow FOV (~28°), 3/4 top-down angle on scene center.
3. **Lighting + environment** — `DirectionalLight3D` key light with shadows; `WorldEnvironment`
   with sky/ambient + tonemap; a soft fill/rim.
4. **The look** — `cel.gdshader` (lighting-ramp cel shading) on the props; a screen-space
   `outline.gdshader` (depth/normal edge detection); color grading via environment adjustments.
5. **Destruction test** — `DestructionTest.cs`: on keypress, replace a target prop with its
   `*_fragments.glb`, add `RigidBody3D` + outward impulse to the pieces, let Jolt scatter them.
   The first `.cs` triggers `.csproj` / `.sln` generation via a Godot build.
6. **Verify** — run via `run-godot`, screenshot, iterate on FOV / lighting / ramp / outline
   width until the look reads as intended.

### Technical approach notes

- **Cel shading:** per-material spatial shader using a quantized lighting ramp (reads more
  predictably across props than a single screen-space pass) — applied as a material override.
- **Outlines:** screen-space depth + normal edge detection as a fullscreen pass (Compositor
  effect or fullscreen quad), so outline width is uniform regardless of mesh.
- **Color grading:** start with `WorldEnvironment` adjustments (brightness/contrast/saturation
  + tonemap); fold a LUT into the post pass later if needed.
- **Destruction:** inspect each `*_fragments.glb` node structure on implementation — fragments
  may be separate child meshes (wrap each in a `RigidBody3D`) or a single mesh (needs per-piece
  separation). Trigger via input action initially; impact-driven later.
- **Language:** C# (project is configured for .NET); use C# for `DestructionTest.cs`.

---

## 5. Success criteria

- All 7 subagents, all 5 skills, and all 5 hooks exist and are usable (scaffolds clearly marked).
- `run-godot` opens `art_test.tscn` in Godot 4.5 and produces a screenshot.
- The screenshot shows cel-shaded props with clean outlines under the 3/4 narrow-FOV camera —
  a recognizable "stylized low-poly" look, not stock PBR.
- Pressing the destruction key shatters a prop into physics-driven fragments that scatter and
  settle via Jolt.
