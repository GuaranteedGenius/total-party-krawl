# Agent Team + Art Pipeline & Destruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the full-project Claude agent/skill/hook team, then deliver the game's distinctive look (cel shading + outlines + 3/4 narrow-FOV camera + lighting + color grading) plus a working destructible-scenery test on `game/scenes/art_test.tscn`.

**Architecture:** Two parts. (1) Team scaffolding — 7 subagents in `.claude/agents/`, 5 skills in `.claude/skills/`, 5 hooks wired in `.claude/settings.json` with Node scripts in `.claude/hooks/`. (2) Godot first milestone — edit the existing `art_test.tscn` text scene to add camera/lights/environment, author two `.gdshader` files (cel + inverted-hull outline), apply them as material overrides/next-pass, and add a C# `DestructionTest` script that swaps a prop for its pre-fractured `*_fragments.glb` and scatters the pieces with Jolt physics.

**Tech Stack:** Godot 4.5.1-mono (C#/.NET 10), GDShader, Jolt Physics, Node.js (hooks), Claude Code agents/skills/hooks (Markdown + JSON).

**Verification note:** Markdown agent files, JSON hooks, and GDShaders have nothing to unit-test. Verification is by structural check (valid JSON, required frontmatter present) and by the `run-godot` screenshot loop (visual confirmation). Genuine logic tests are not faked where they don't apply.

**Engine binary (used throughout):**
`C:\Program Files\Godot\Godot_v4.5.1-stable_mono_win64_console.exe`

---

## Phase 1 — Agent Team

### Task 1: Create the 7 subagent definitions

**Files:**
- Create: `.claude/agents/godot-gameplay-engineer.md`
- Create: `.claude/agents/godot-art-pipeline.md`
- Create: `.claude/agents/backend-relay-engineer.md`
- Create: `.claude/agents/twitch-extension-dev.md`
- Create: `.claude/agents/game-designer.md`
- Create: `.claude/agents/build-release-engineer.md`
- Create: `.claude/agents/qa-test-engineer.md`

Each file uses Claude Code subagent frontmatter (`name`, `description`) followed by a focused system prompt. Every prompt embeds the two non-negotiable project principles so the whole team is aligned:
- **Decision principle:** "Always pick the right choice, not the easiest" (from `CLAUDE.md`).
- **Architecture boundary:** all game logic + rendering live in the Godot client; the server (Vercel + Supabase) is a thin relay + persistence layer with NO game logic; the Twitch extension is a lightweight controller, not a game client.

- [ ] **Step 1: Write `.claude/agents/godot-gameplay-engineer.md`**

```markdown
---
name: godot-gameplay-engineer
description: Use for Godot 4 C# game logic — combat engine (turns, lock-in, DEX-order resolution), the 4 stats (STR/INT/DEX/CON), the 10-seat system, data-driven class/boss/enemy systems, scene/node architecture, Jolt physics, and input. The agent that owns the game client's logic layer.
---

You are the gameplay engineer for Total Party Krawl, a Godot 4.5 / C# turn-based RPG game client.

Project principles you must uphold:
- Always pick the right choice, not the easiest. Explain tradeoffs honestly.
- ALL game logic and rendering live here in the Godot client. The server is a thin relay only — never push combat math, turn resolution, or cooldown logic to the server.
- Data-driven design: classes, bosses, moves, and enemies are defined as data (Godot Resources / data files), not hardcoded branches.
- Don't over-abstract early. Build for the two launch modes (Fight Me, Total Party Krawl), refactor when patterns emerge.

Your domain:
- Combat engine: 20-second simultaneous lock-in, attacks resolve in DEX order, the two launch modes share 90%+ of code (difference is who controls the boss: streamer vs AI).
- The 4 core stats: STR (physical dmg), INT (magic/healing), DEX (attack order + dodge), CON (max HP + resistance).
- Seat system: up to 10 viewer slots; spectators can still interact via Bits.
- Class system (Tank/Mage/Healer at launch) and boss/enemy archetypes — all data-driven.
- Scene/node architecture, input handling, Jolt physics integration.

Engine: Godot 4.5.1-mono, C#/.NET 10, Jolt Physics, D3D12. Use C# for game scripts. Verify changes by running scenes via the run-godot skill. Write C# unit tests for pure combat logic where practical (resolution order, damage formulas). Follow existing patterns in game/scripts and game/scenes.
```

- [ ] **Step 2: Write `.claude/agents/godot-art-pipeline.md`**

```markdown
---
name: godot-art-pipeline
description: Use for the game's visual identity — cel shading, outlines, color grading, lighting, materials, the 3/4 narrow-FOV perspective camera, VFX (fireballs/AOE), destructible environments + debris, GLB import settings, and the 3 overlay layouts (full / facecam-left / facecam-right).
---

You are the technical artist for Total Party Krawl, owning the distinctive look of a Godot 4.5 game.

Project principles you must uphold:
- Always pick the right choice, not the easiest. Explain tradeoffs honestly.
- The goal look: "feels familiar but I've never seen anything like this." Real-time low-poly 3D with stylized post-processing — NOT pre-rendered sprites.
- Rendering happens in the Godot client. The camera is a fixed 3/4 top-down angle with NARROW-FOV perspective (not orthographic), so it reads like 2D but leverages full 3D.

Your domain:
- Post-processing pipeline: cel shading, outlines, color grading.
- Lighting, materials, GLB import settings, WorldEnvironment.
- Destructible environments: fragments scatter via physics, AOE debris, drifting clouds.
- VFX for abilities (fireballs blow chunks from pillars, shockwaves scatter debris).
- The 3 streamer overlay layouts: Full Screen, Facecam-Left (clear zone left), Facecam-Right.

The user is a strong 3D artist (authors models in Blender) and weaker at 2D — lean into the 3D + shader pipeline. You write GDShader and configure scenes/materials; you do NOT author 3D models. Verify every visual change with the run-godot screenshot loop and iterate on FOV/lighting/ramp/outline width until the look reads right.

Engine: Godot 4.5.1-mono, Forward+, D3D12.
```

- [ ] **Step 3: Write `.claude/agents/backend-relay-engineer.md`**

```markdown
---
name: backend-relay-engineer
description: Use for the server layer — Vercel serverless (TypeScript), Supabase Realtime relay + persistence, Twitch JWT verification, viewer move relay, turn-sync/latency strategy, leaderboards/progression storage, and Row Level Security. Thin relay only — never game logic.
---

You are the backend engineer for Total Party Krawl. The server is a THIN relay + persistence layer.

Project principles you must uphold:
- Always pick the right choice, not the easiest. Explain tradeoffs honestly.
- NO game logic on the server. No combat math, no turn resolution, no cooldowns. If you find yourself writing damage/HP/resolution code in api/, stop — that belongs in the Godot client.
- The server relays small JSON and persists data. Costs must stay near-zero even at 1000 concurrent games.

Your domain:
- Vercel serverless endpoints (TypeScript) for auth, move relay, and persistence.
- Supabase Realtime: broadcast turn prompts to viewers, relay viewer moves to the game client as they arrive.
- Twitch JWT verification (Extension auth).
- Turn-sync / latency strategy: the GAME CLIENT is the clock authority; the extension shows a SOFT timer; the server provides a 1-2s grace window for late move arrivals. Viewer moves go directly to the API, bypassing stream delay.
- Persistence: per-viewer progression/gear (persistent across channels), match history, leaderboards. Use Supabase with Row Level Security (public read, service-role write).

Note: lib/supabase.ts and supabase/schema.sql currently encode an ABANDONED chat-voting model (single streamer_hp/boss_hp, votes_json). Replace these with the per-viewer seat model when you build this layer. Design for 50 concurrent games, architect for 1000.
```

- [ ] **Step 4: Write `.claude/agents/twitch-extension-dev.md`**

```markdown
---
name: twitch-extension-dev
description: Use for the Twitch extension viewer controller — HTML/JS panel, Twitch Extension Helper SDK, panel/overlay/config/live-config pages, seat-join UI, class pick, move submit, and Bits products. A controller, not a game client.
---

You are the Twitch extension developer for Total Party Krawl. The extension is a LIGHTWEIGHT controller.

Project principles you must uphold:
- Always pick the right choice, not the easiest. Explain tradeoffs honestly.
- Keep the panel simple — it's a controller, not a game client. No heavy rendering. No game logic.
- Every viewer matters — they're a character in the fight, not a number in a vote.

Your domain:
- Viewer panel (HTML/JS): join a seat (up to 10), pick a class (Tank/Mage/Healer), submit a move, see own stats.
- Twitch Extension Helper SDK (window.Twitch.ext): auth/JWT handoff to the API, config + live-config pages, overlay.
- Soft countdown timer in the panel (approximate; shows "Waiting for results..." after expiry). The timer is a visual guide, NOT authoritative — the game client owns the real clock.
- Bits integration for premium moves (Twitch handles payment).
- Submit moves directly to the API (bypasses stream delay).

Files live under extension/ (css/, js/, and the html pages). The extension is free for viewers.
```

- [ ] **Step 5: Write `.claude/agents/game-designer.md`**

```markdown
---
name: game-designer
description: Use for data-driven content and balance — classes, bosses, enemies, moves, stat curves, XP/level/loot progression, and encounter design. Owns the data schemas the Godot engine consumes.
---

You are the game designer for Total Party Krawl, a turn-based RPG for small Twitch streams (1-10 viewers).

Project principles you must uphold:
- Always pick the right choice, not the easiest. Explain tradeoffs honestly.
- Data-driven design: classes, bosses, moves, enemies are DATA, not hardcoded. You own the schemas; the gameplay engineer consumes them.
- Help the little guy grow — design for small streams first. Every viewer is a character, not a vote.

Your domain:
- The 4 stats (STR physical dmg, INT magic/healing, DEX attack order + dodge, CON max HP + resistance) and how content uses them.
- 3 launch classes: Tank (taunt), Mage (burst), Healer (party sustain). Boss/enemy archetypes.
- Move design, cooldowns, and turn economy (20-second simultaneous lock-in, DEX-order resolution).
- Progression: XP, levels, loot, persistent per-viewer across channels.
- Balance for both launch modes: "Fight Me" (streamer is boss, party wipe = streamer wins) and "Total Party Krawl" (co-op vs AI).

Define content as clear, validated data so the engine and the author-content skill can consume it. Keep launch scope tight; expand after the core is solid.
```

- [ ] **Step 6: Write `.claude/agents/build-release-engineer.md`**

```markdown
---
name: build-release-engineer
description: Use for build + release — Godot export presets (Win/Mac/Linux), GodotSteam/Steamworks integration, Steam depots/builds, Vercel deploy, Twitch extension packaging, CI, and versioning.
---

You are the build/release engineer for Total Party Krawl.

Project principles you must uphold:
- Always pick the right choice, not the easiest. Explain tradeoffs honestly.

Your domain:
- Godot headless export presets for Windows/Mac/Linux (export_presets.cfg is gitignored; document/regenerate as needed).
- GodotSteam plugin for Steamworks integration. Distribution via Steam (payments, updates, discovery, reviews).
- Steam depots and build uploads. Revenue model: streamer buys the game on Steam; extension is free; Bits for premium moves.
- Vercel deploy for the api/ layer; Supabase schema migration.
- Twitch extension packaging (zip for upload).
- CI and versioning across the three components (game/, api/, extension/).

Keep release pipelines reproducible and documented. Assets are binary (.glb) — recommend Git LFS strategy. Note: the repo currently gitignores *.import (incorrect for Godot — .import should be committed); fix as part of asset/release hygiene.
```

- [ ] **Step 7: Write `.claude/agents/qa-test-engineer.md`**

```markdown
---
name: qa-test-engineer
description: Use for testing across all three components — C# combat unit tests, TypeScript API tests, Twitch extension integration via a mock-Twitch test harness, regression suites, and playtest checklists.
---

You are the QA/test engineer for Total Party Krawl.

Project principles you must uphold:
- Always pick the right choice, not the easiest. Explain tradeoffs honestly.
- Test behavior, not implementation. Prefer fast, deterministic tests for pure logic; reserve integration tests for cross-component flows.

Your domain:
- Godot/C# unit tests for pure combat logic (resolution order, damage/heal formulas, cooldowns, stat math).
- TypeScript tests for api/ relay + persistence endpoints.
- Twitch extension integration tests using a mock-Twitch auth harness (the prior prototype had a test-harness with mock Twitch auth — reestablish an equivalent).
- Cross-component turn-flow tests: prompt broadcast -> viewer move submit -> relay -> client resolve, including the server grace window.
- Regression suites and human playtest checklists for both launch modes.

Verify game-client visuals/behavior via the run-godot skill. Make tests easy to run locally and in CI.
```

- [ ] **Step 8: Verify all 7 agent files exist with valid frontmatter**

Run:
```bash
for f in godot-gameplay-engineer godot-art-pipeline backend-relay-engineer twitch-extension-dev game-designer build-release-engineer qa-test-engineer; do
  test -f ".claude/agents/$f.md" && head -1 ".claude/agents/$f.md" | grep -q '^---' && echo "OK $f" || echo "MISSING/BAD $f"
done
```
Expected: 7 lines all starting with `OK`.

- [ ] **Step 9: Commit**

```bash
git add .claude/agents
git commit -m "feat: add full-project subagent team (7 agents)"
```

---

## Phase 2 — Skills

### Task 2: Create the 5 skills

**Files:**
- Create: `.claude/skills/run-godot/SKILL.md`
- Create: `game/tools/screenshot_on_ready.gd`
- Create: `.claude/skills/author-content/SKILL.md`
- Create: `.claude/skills/package-extension/SKILL.md`
- Create: `.claude/skills/deploy-backend/SKILL.md`
- Create: `.claude/skills/export-game/SKILL.md`

- [ ] **Step 1: Write the screenshot helper `game/tools/screenshot_on_ready.gd`**

This is a Godot autoload that does nothing unless the `TPK_SCREENSHOT` env var is set, so normal play is unaffected. When set, it waits a few frames, writes a PNG, and quits.

```gdscript
extends Node
# Autoload helper: when env var TPK_SCREENSHOT is set to an output path,
# capture the viewport after a short delay and quit. Otherwise no-op.

func _ready() -> void:
	var out_path := OS.get_environment("TPK_SCREENSHOT")
	if out_path == "":
		return
	# Let the scene render and physics settle a few frames.
	await get_tree().create_timer(0.6).timeout
	var img := get_viewport().get_texture().get_image()
	var err := img.save_png(out_path)
	if err != OK:
		push_error("screenshot_on_ready: failed to save %s (err %d)" % [out_path, err])
	get_tree().quit()
```

- [ ] **Step 2: Register the autoload in `game/project.godot`**

Add an `[autoload]` section (create it if absent) so the helper loads in every scene:

```
[autoload]

ScreenshotOnReady="*res://tools/screenshot_on_ready.gd"
```

- [ ] **Step 3: Write `.claude/skills/run-godot/SKILL.md`**

```markdown
---
name: run-godot
description: Launch a Godot scene on the installed 4.5.1-mono binary and capture a screenshot for visual verification. Use whenever you need to see the game render — confirming the art look, lighting, shaders, or a destruction test.
---

# run-godot

Runs a Godot scene and writes a screenshot so visual changes can be verified.

## Binary
`C:\Program Files\Godot\Godot_v4.5.1-stable_mono_win64_console.exe`

## How it works
The project autoloads `res://tools/screenshot_on_ready.gd`. When the `TPK_SCREENSHOT`
environment variable points at an output PNG path, that autoload waits ~0.6s for the scene to
render and physics to settle, saves the screenshot, and quits. Without the env var, scenes run
normally.

## Run a scene and screenshot it (PowerShell)
```powershell
$env:TPK_SCREENSHOT = "E:\repos\twitch\total-party-krawl\game\.run\art_test.png"
New-Item -ItemType Directory -Force "E:\repos\twitch\total-party-krawl\game\.run" | Out-Null
& "C:\Program Files\Godot\Godot_v4.5.1-stable_mono_win64_console.exe" --path "E:\repos\twitch\total-party-krawl\game" "res://scenes/art_test.tscn"
Remove-Item Env:\TPK_SCREENSHOT
```

Then Read the PNG at `game/.run/art_test.png` to inspect the result.

## Build C# first if scripts changed
If C# was edited, build before running so the assembly is current:
```powershell
& "C:\Program Files\dotnet\dotnet.exe" build "E:\repos\twitch\total-party-krawl\game\total_party_krawl.sln"
```
(The .sln/.csproj are generated by Godot on first C# build — open the editor once if they do not exist yet.)

## Notes
- First run imports assets and may be slow.
- `game/.run/` holds screenshots; it is gitignored.
- For a non-screenshot interactive run, omit the TPK_SCREENSHOT env var.
```

- [ ] **Step 4: Write `.claude/skills/author-content/SKILL.md` (scaffold)**

```markdown
---
name: author-content
description: Scaffold and validate a data-driven content entry (class, boss, enemy, or move) against the project schema. Use when adding or editing game content. SCAFFOLD — refined once game-designer defines the concrete schemas.
---

# author-content

Data-driven content workflow for Total Party Krawl. Classes, bosses, enemies, and moves are
DATA consumed by the Godot client, never hardcoded.

## Status: SCAFFOLD
The concrete schema (Godot Resource format vs JSON, field names, file locations) is owned by the
game-designer agent and not yet finalized. Until then:

1. Ask the game-designer agent for the current schema before authoring content.
2. Place content where the gameplay engineer expects it (game/data/ once established).
3. Validate required fields for the content type:
   - Class: name, role (Tank/Mage/Healer), base stats (STR/INT/DEX/CON), abilities[].
   - Boss/Enemy: name, archetype, stats, move set, AI behavior (enemies only).
   - Move: name, cost/cooldown, target rule, effect (damage/heal/buff/taunt), stat scaling.

## To be built when the schema lands
- A validator that checks an entry against the schema and reports missing/invalid fields.
- A scaffolder that emits a correctly-shaped template for a chosen content type.
```

- [ ] **Step 5: Write `.claude/skills/package-extension/SKILL.md` (scaffold)**

```markdown
---
name: package-extension
description: Build and zip the Twitch extension for upload to the Twitch developer console. SCAFFOLD — refined once extension/ has real content.
---

# package-extension

Packages the Twitch extension (extension/) into an uploadable zip.

## Status: SCAFFOLD
extension/ currently has no built pages. When content exists, this skill will:

1. Verify required pages exist (panel.html, overlay.html, config.html, live_config.html) and their css/js.
2. Verify all asset references are relative (Twitch hosts the zip contents).
3. Produce the zip:
   ```powershell
   Compress-Archive -Path "E:\repos\twitch\total-party-krawl\extension\*" -DestinationPath "E:\repos\twitch\total-party-krawl\extension.zip" -Force
   ```
4. Remind: upload via the Twitch developer console; extension.zip is gitignored.
```

- [ ] **Step 6: Write `.claude/skills/deploy-backend/SKILL.md` (scaffold)**

```markdown
---
name: deploy-backend
description: Deploy the Vercel serverless API and apply Supabase schema migrations. SCAFFOLD — refined once api/ has real endpoints and the per-viewer schema is finalized.
---

# deploy-backend

Deploys the thin relay/persistence backend.

## Status: SCAFFOLD
api/ has no endpoints yet, and supabase/schema.sql still encodes the ABANDONED chat-voting model
(must be replaced with the per-viewer seat model first). When ready, this skill will:

1. Apply the Supabase schema (run supabase/schema.sql in the Supabase SQL editor or via CLI).
2. Deploy to Vercel:
   ```powershell
   & npx vercel deploy --prod
   ```
3. Verify env vars (SUPABASE_URL, SUPABASE_SECRET_KEY, Twitch ext secret) are set in Vercel, not committed.
4. Smoke-test the auth + relay endpoints.

Guardrail: the no-logic-on-server hook warns if game logic appears under api/.
```

- [ ] **Step 7: Write `.claude/skills/export-game/SKILL.md` (scaffold)**

```markdown
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
   & "C:\Program Files\Godot\Godot_v4.5.1-stable_mono_win64_console.exe" --path "E:\repos\twitch\total-party-krawl\game" --headless --export-release "Windows Desktop" "..\dist\TotalPartyKrawl.exe"
   ```
3. Hand built artifacts to the Steam depot upload (owned by build-release-engineer).
```

- [ ] **Step 8: Add `game/.run/` to ignore + verify skills exist**

Append to `game/.gitignore`:
```
# run-godot screenshot output
.run/
```

Run:
```bash
for s in run-godot author-content package-extension deploy-backend export-game; do
  test -f ".claude/skills/$s/SKILL.md" && echo "OK $s" || echo "MISSING $s"
done
test -f game/tools/screenshot_on_ready.gd && echo "OK helper" || echo "MISSING helper"
```
Expected: 5 `OK <skill>` lines + `OK helper`.

- [ ] **Step 9: Commit**

```bash
git add .claude/skills game/tools/screenshot_on_ready.gd game/project.godot game/.gitignore
git commit -m "feat: add project skills (run-godot active + 4 scaffolds) and screenshot helper"
```

---

## Phase 3 — Hooks

### Task 3: Wire 5 hooks with Node scripts

**Files:**
- Create: `.claude/hooks/secret-guard.mjs`
- Create: `.claude/hooks/csharp-format.mjs`
- Create: `.claude/hooks/ts-lint-format.mjs`
- Create: `.claude/hooks/godot-asset-guard.mjs`
- Create: `.claude/hooks/no-logic-on-server.mjs`
- Create/Modify: `.claude/settings.json`
- Modify: `.gitignore` (un-ignore `*.import`)

Hooks read the tool-call JSON from stdin. Convention used here: exit code `2` blocks the call and shows stderr to Claude; exit `0` allows it (stdout shown as context). Advisory hooks print to stderr and exit `0`.

- [ ] **Step 1: Write `.claude/hooks/secret-guard.mjs`**

```javascript
#!/usr/bin/env node
// PreToolUse(Edit|Write|Bash): block touching/staging secret files.
import { readFileSync } from "node:fs";

const SECRET = /(^|[\\/])\.env(\.local|\.[^\\/]*\.local)?$/i;

let input = "";
try { input = readFileSync(0, "utf8"); } catch { process.exit(0); }
let data = {};
try { data = JSON.parse(input); } catch { process.exit(0); }

const tool = data.tool_name || "";
const ti = data.tool_input || {};

function block(msg) { process.stderr.write(`secret-guard: ${msg}\n`); process.exit(2); }

if ((tool === "Edit" || tool === "Write") && ti.file_path && SECRET.test(ti.file_path)) {
  block(`refusing to write secret file ${ti.file_path}. Secrets must never be edited by the agent.`);
}
if (tool === "Bash" && typeof ti.command === "string") {
  const c = ti.command;
  if (/\bgit\s+add\b/.test(c) && /\.env(\.|\b)/.test(c)) {
    block(`refusing to 'git add' a .env file. Secrets must never be staged.`);
  }
}
process.exit(0);
```

- [ ] **Step 2: Write `.claude/hooks/csharp-format.mjs`**

```javascript
#!/usr/bin/env node
// PostToolUse(Edit|Write): run dotnet format on edited .cs files if a solution exists.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";

let data = {};
try { data = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const ti = data.tool_input || {};
const fp = ti.file_path || "";
if (!fp.endsWith(".cs")) process.exit(0);

// Find a .sln upward from the game dir; bail quietly if none yet.
const gameDir = "E:/repos/twitch/total-party-krawl/game";
let sln = null;
try { sln = readdirSync(gameDir).find(f => f.endsWith(".sln")); } catch {}
if (!sln) { process.stderr.write("csharp-format: no .sln yet, skipping\n"); process.exit(0); }

const dotnet = "C:/Program Files/dotnet/dotnet.exe";
try {
  execFileSync(dotnet, ["format", `${gameDir}/${sln}`, "--include", fp], { stdio: "ignore" });
} catch (e) {
  process.stderr.write(`csharp-format: dotnet format failed (non-fatal)\n`);
}
process.exit(0);
```

- [ ] **Step 3: Write `.claude/hooks/ts-lint-format.mjs`**

```javascript
#!/usr/bin/env node
// PostToolUse(Edit|Write): format .ts/.js with prettier if available. Dormant until installed.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

let data = {};
try { data = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const fp = (data.tool_input || {}).file_path || "";
if (!/\.(ts|js|mjs|cjs)$/.test(fp)) process.exit(0);
if (/[\\/]\.claude[\\/]hooks[\\/]/.test(fp)) process.exit(0); // don't reformat hooks

try {
  execFileSync("npx", ["--no-install", "prettier", "--write", fp], { stdio: "ignore", shell: true });
} catch {
  process.stderr.write("ts-lint-format: prettier not installed yet, skipping\n");
}
process.exit(0);
```

- [ ] **Step 4: Write `.claude/hooks/godot-asset-guard.mjs`**

```javascript
#!/usr/bin/env node
// PreToolUse(Bash): warn (non-blocking) when git-adding a .glb whose .import is missing.
import { readFileSync, existsSync } from "node:fs";

let data = {};
try { data = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const ti = data.tool_input || {};
if ((data.tool_name || "") !== "Bash") process.exit(0);
const cmd = ti.command || "";
if (!/\bgit\s+add\b/.test(cmd)) process.exit(0);

const globs = cmd.match(/\S+\.glb\b/g) || [];
for (const g of globs) {
  const imp = g.replace(/(["']?)$/, ".import$1").replace(/\.glb/, ".glb");
  const importPath = g.replace(/(['"])$/, "") + ".import";
  if (!existsSync(importPath)) {
    process.stderr.write(`godot-asset-guard: ${g} has no committed .import sidecar — Godot needs it. Import the asset in the editor and commit the .import too.\n`);
  }
}
process.exit(0);
```

- [ ] **Step 5: Write `.claude/hooks/no-logic-on-server.mjs`**

```javascript
#!/usr/bin/env node
// PreToolUse(Edit|Write): advisory warning if game-logic keywords appear in api/.
import { readFileSync } from "node:fs";

let data = {};
try { data = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const ti = data.tool_input || {};
const fp = (ti.file_path || "").replace(/\\/g, "/");
if (!/\/api\//.test(fp)) process.exit(0);

const body = ti.content || ti.new_string || "";
const LOGIC = /(resolveTurn|applyDamage|calculateDamage|rollDodge|dexOrder|combat|cooldownTick|hpAfter|takeDamage)/i;
if (LOGIC.test(body)) {
  process.stderr.write("no-logic-on-server: this looks like GAME LOGIC under api/. The server is a thin relay — combat/turn/damage logic belongs in the Godot client. Reconsider before proceeding.\n");
}
process.exit(0);
```

- [ ] **Step 6: Create/merge `.claude/settings.json`**

Note: keep `.claude/settings.local.json` (permissions) as-is. This is the shared `settings.json`.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|Bash",
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/secret-guard.mjs\"" }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/godot-asset-guard.mjs\"" }
        ]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/no-logic-on-server.mjs\"" }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/csharp-format.mjs\"" },
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/ts-lint-format.mjs\"" }
        ]
      }
    ]
  }
}
```

- [ ] **Step 7: Fix `.gitignore` so Godot `.import` files are committable**

In `.gitignore`, under the `# Godot` section, remove the `*.import` line (Godot best practice is to COMMIT `.import` sidecars and ignore only the `.godot/` cache). Change:
```
# Godot
.godot/
*.import
export_presets.cfg
```
to:
```
# Godot
.godot/
export_presets.cfg
```

- [ ] **Step 8: Verify settings.json is valid JSON and hooks are present**

Run:
```bash
node -e "const s=require('./.claude/settings.json'); if(!s.hooks||!s.hooks.PreToolUse||!s.hooks.PostToolUse) throw new Error('hooks missing'); console.log('settings.json OK')"
for h in secret-guard csharp-format ts-lint-format godot-asset-guard no-logic-on-server; do
  test -f ".claude/hooks/$h.mjs" && echo "OK $h" || echo "MISSING $h"
done
```
Expected: `settings.json OK` then 5 `OK <hook>` lines.

- [ ] **Step 9: Functionally verify secret-guard blocks a .env write**

Run:
```bash
echo '{"tool_name":"Write","tool_input":{"file_path":".env.local"}}' | node .claude/hooks/secret-guard.mjs; echo "exit=$?"
```
Expected: prints `secret-guard: refusing to write secret file .env.local...` and `exit=2`.

Then verify a normal file passes:
```bash
echo '{"tool_name":"Write","tool_input":{"file_path":"game/scripts/Foo.cs"}}' | node .claude/hooks/secret-guard.mjs; echo "exit=$?"
```
Expected: `exit=0` with no block message.

- [ ] **Step 10: Commit**

```bash
git add .claude/hooks .claude/settings.json .gitignore
git commit -m "feat: add project hooks (secret-guard, formatters, godot-asset-guard, no-logic-on-server)"
```

---

## Phase 4 — The Look (art pipeline on art_test.tscn)

### Task 4: Fix engine version + baseline screenshot

**Files:**
- Modify: `game/project.godot`

- [ ] **Step 1: Change the engine feature from 4.6 to 4.5**

In `game/project.godot`, change:
```
config/features=PackedStringArray("4.6", "Forward Plus")
```
to:
```
config/features=PackedStringArray("4.5", "Forward Plus")
```

- [ ] **Step 2: Baseline screenshot via run-godot**

Use the run-godot skill (Task 2) to run `res://scenes/art_test.tscn` and write `game/.run/art_test.png`.
Expected: the scene opens in Godot 4.5 without the "created in a newer version" error and produces a PNG (props will look flat/unlit — no camera/lights yet; that's expected baseline).

- [ ] **Step 3: Commit**

```bash
git add game/project.godot
git commit -m "fix: set Godot project feature to 4.5 to match installed engine"
```

### Task 5: Add camera, lighting, and environment

**Files:**
- Modify: `game/scenes/art_test.tscn`

- [ ] **Step 1: Add a 3/4 narrow-FOV camera, key light, and WorldEnvironment**

Edit `game/scenes/art_test.tscn`. Add an environment sub-resource and append the three nodes as children of the root `Node3D`. Add to the `[gd_scene ...]` resource section (a `[sub_resource]` for the environment) and node entries.

Add this sub-resource block near the top (after the ext_resources):
```
[sub_resource type="Environment" id="Environment_main"]
background_mode = 1
ambient_light_source = 2
ambient_light_color = Color(0.6, 0.62, 0.7, 1)
ambient_light_energy = 0.5
tonemap_mode = 3
adjustment_enabled = true
adjustment_brightness = 1.02
adjustment_contrast = 1.08
adjustment_saturation = 1.15
```

Append these nodes at the end of the file:
```
[node name="Camera3D" type="Camera3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 0.866025, 0.5, 0, -0.5, 0.866025, -1, 10, 12)
fov = 28.0

[node name="KeyLight" type="DirectionalLight3D" parent="."]
transform = Transform3D(0.866025, -0.25, 0.433013, 0, 0.866025, 0.5, -0.5, -0.433013, 0.75, 0, 8, 0)
shadow_enabled = true
light_energy = 1.2

[node name="WorldEnvironment" type="WorldEnvironment" parent="."]
environment = SubResource("Environment_main")
```

- [ ] **Step 2: Screenshot and verify framing**

Run via run-godot. Read `game/.run/art_test.png`.
Expected: the scene is now lit from a 3/4 angle and framed by a narrow-FOV perspective camera looking down at the props. If the props are off-center, adjust the `Camera3D` transform origin (the `-1, 10, 12` translation) and re-shoot. Iterate until the floor + boss + player + props are well framed.

- [ ] **Step 3: Commit**

```bash
git add game/scenes/art_test.tscn
git commit -m "feat: add 3/4 narrow-FOV camera, key light, and graded environment to art test"
```

### Task 6: Cel shading

**Files:**
- Create: `game/shaders/cel.gdshader`
- Modify: `game/scenes/art_test.tscn`

- [ ] **Step 1: Write `game/shaders/cel.gdshader`**

```glsl
shader_type spatial;
render_mode cull_back;

uniform vec4 albedo : source_color = vec4(0.8, 0.8, 0.8, 1.0);
uniform sampler2D albedo_tex : source_color, hint_default_white;
uniform int ramp_steps : hint_range(2, 6) = 3;
uniform float rim_strength : hint_range(0.0, 1.0) = 0.25;

void fragment() {
	ALBEDO = albedo.rgb * texture(albedo_tex, UV).rgb;
}

void light() {
	float ndotl = clamp(dot(NORMAL, LIGHT), 0.0, 1.0);
	float stepped = floor(ndotl * float(ramp_steps) + 0.5) / float(ramp_steps);
	DIFFUSE_LIGHT += ALBEDO * LIGHT_COLOR * ATTENUATION * stepped;
	// subtle rim for read against background
	float rim = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0) * rim_strength;
	DIFFUSE_LIGHT += rim * LIGHT_COLOR.rgb * ATTENUATION;
}
```

- [ ] **Step 2: Apply the cel shader as a material override on the props**

Because the props are imported `.glb` instances, the simplest reliable approach for this test is a scene-wide material override via a `GeometryInstance3D.material_override` is not available on the parent — instead, add a `[sub_resource]` ShaderMaterial and set `material_override` on each prop instance node.

Add the shader resource + material to `game/scenes/art_test.tscn`:
```
[ext_resource type="Shader" path="res://shaders/cel.gdshader" id="cel_shader"]

[sub_resource type="ShaderMaterial" id="cel_mat"]
shader = ExtResource("cel_shader")
shader_parameter/albedo = Color(0.78, 0.74, 0.66, 1)
shader_parameter/ramp_steps = 3
shader_parameter/rim_strength = 0.25
```

Then add `material_override = SubResource("cel_mat")` to each prop instance node (the barrels, crates, pillars, boss, player, floor) in the scene. For example, change:
```
[node name="crate_wood_1" parent="." ... instance=ExtResource("6_0oqbn")]
transform = Transform3D(...)
```
to:
```
[node name="crate_wood_1" parent="." ... instance=ExtResource("6_0oqbn")]
transform = Transform3D(...)
material_override = SubResource("cel_mat")
```
Apply `material_override = SubResource("cel_mat")` to all instance nodes.

- [ ] **Step 3: Screenshot and verify cel banding**

Run via run-godot. Read `game/.run/art_test.png`.
Expected: props show 3-step quantized shading (clear light/mid/shadow bands) instead of smooth PBR. Adjust `ramp_steps` (2-4) and `albedo` until the banding reads as stylized cel shading.

- [ ] **Step 4: Commit**

```bash
git add game/shaders/cel.gdshader game/scenes/art_test.tscn
git commit -m "feat: add cel-shading shader and apply to art-test props"
```

### Task 7: Outlines (inverted hull)

**Files:**
- Create: `game/shaders/outline.gdshader`
- Modify: `game/scenes/art_test.tscn`

Rationale: an inverted-hull next_pass is the most reliable outline method for low-poly props in Godot 4.5 (no compositor/depth-buffer plumbing). Screen-space depth/normal outlines are a documented later enhancement.

- [ ] **Step 1: Write `game/shaders/outline.gdshader`**

```glsl
shader_type spatial;
render_mode cull_front, unshaded, shadows_disabled;

uniform float outline_width : hint_range(0.0, 0.1) = 0.02;
uniform vec4 outline_color : source_color = vec4(0.05, 0.04, 0.06, 1.0);

void vertex() {
	VERTEX += normalize(NORMAL) * outline_width;
}

void fragment() {
	ALBEDO = outline_color.rgb;
}
```

- [ ] **Step 2: Add the outline as a next_pass on the cel material**

In `game/scenes/art_test.tscn`, add the outline shader resource + material, and chain it as the cel material's `next_pass`:
```
[ext_resource type="Shader" path="res://shaders/outline.gdshader" id="outline_shader"]

[sub_resource type="ShaderMaterial" id="outline_mat"]
shader = ExtResource("outline_shader")
shader_parameter/outline_width = 0.02
shader_parameter/outline_color = Color(0.05, 0.04, 0.06, 1)
```
Then add `next_pass = SubResource("outline_mat")` to the `cel_mat` sub_resource:
```
[sub_resource type="ShaderMaterial" id="cel_mat"]
shader = ExtResource("cel_shader")
shader_parameter/albedo = Color(0.78, 0.74, 0.66, 1)
shader_parameter/ramp_steps = 3
shader_parameter/rim_strength = 0.25
next_pass = SubResource("outline_mat")
```

- [ ] **Step 3: Screenshot and verify outlines**

Run via run-godot. Read `game/.run/art_test.png`.
Expected: each prop has a dark silhouette outline. Tune `outline_width` (0.01-0.04) so outlines read clearly without ballooning or breaking at sharp corners.

- [ ] **Step 4: Commit**

```bash
git add game/shaders/outline.gdshader game/scenes/art_test.tscn
git commit -m "feat: add inverted-hull outline shader chained as cel next_pass"
```

---

## Phase 5 — Destruction

### Task 8: Destruction test script

**Files:**
- Create: `game/scripts/DestructionTest.cs`
- Modify: `game/scenes/art_test.tscn`
- Modify: `game/project.godot` (input action)

- [ ] **Step 1: Add a "destruct" input action in `game/project.godot`**

Add an `[input]` section (create if absent):
```
[input]

destruct={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":32,"key_label":0,"unicode":0,"location":0,"echo":false,"script":null)
]
}
```
(physical_keycode 32 = Space.)

- [ ] **Step 2: Write `game/scripts/DestructionTest.cs`**

```csharp
using Godot;
using System.Collections.Generic;

// Art-test destruction proof: on the "destruct" action, replace a target prop with its
// pre-fractured *_fragments.glb and scatter the pieces with Jolt physics.
public partial class DestructionTest : Node3D
{
    [Export] public NodePath TargetPath;       // prop to shatter (e.g. a crate)
    [Export] public PackedScene FragmentsScene; // its *_fragments.glb
    [Export] public float ExplosionForce = 4.0f;
    [Export] public float UpwardBoost = 2.0f;

    private bool _spent;

    public override void _UnhandledInput(InputEvent @event)
    {
        if (_spent) return;
        if (@event.IsActionPressed("destruct"))
            Shatter();
    }

    private void Shatter()
    {
        var target = GetNodeOrNull<Node3D>(TargetPath);
        if (target == null || FragmentsScene == null)
        {
            GD.PushWarning("DestructionTest: TargetPath or FragmentsScene not set.");
            return;
        }
        _spent = true;

        Transform3D xform = target.GlobalTransform;
        Vector3 origin = xform.Origin;
        target.QueueFree();

        var fragRoot = FragmentsScene.Instantiate<Node3D>();
        AddChild(fragRoot);
        fragRoot.GlobalTransform = xform;

        // Collect mesh instances first (we reparent them, so don't mutate while iterating).
        var meshes = new List<MeshInstance3D>();
        CollectMeshes(fragRoot, meshes);

        foreach (var mesh in meshes)
        {
            if (mesh.Mesh == null) continue;
            Transform3D meshXform = mesh.GlobalTransform;

            var body = new RigidBody3D();
            AddChild(body);
            body.GlobalTransform = meshXform;

            mesh.GetParent().RemoveChild(mesh);
            body.AddChild(mesh);
            mesh.Transform = Transform3D.Identity;

            var col = new CollisionShape3D();
            col.Shape = mesh.Mesh.CreateConvexShape();
            body.AddChild(col);

            Vector3 dir = body.GlobalPosition - origin;
            if (dir.Length() < 0.01f)
                dir = new Vector3(GD.Randf() - 0.5f, 0.5f, GD.Randf() - 0.5f);
            body.ApplyImpulse(dir.Normalized() * ExplosionForce + Vector3.Up * UpwardBoost);
        }
    }

    private static void CollectMeshes(Node node, List<MeshInstance3D> acc)
    {
        if (node is MeshInstance3D mi) acc.Add(mi);
        foreach (Node child in node.GetChildren())
            CollectMeshes(child, acc);
    }
}
```

- [ ] **Step 3: Attach the script to the scene root and wire exports**

In `game/scenes/art_test.tscn`, add the script ext_resource and attach it to the root `Node3D`, wiring the target to a crate and the fragments scene to the crate fragments:
```
[ext_resource type="Script" path="res://scripts/DestructionTest.cs" id="destruction_script"]
[ext_resource type="PackedScene" uid="uid://..." path="res://assets/crate_wood_1_fragments.glb" id="crate_fragments"]
```
(Use the real uid from `game/assets/crate_wood_1_fragments.glb.import`.)

On the root node line, add the script and exported properties:
```
[node name="Node3D" type="Node3D" unique_id=832495262]
script = ExtResource("destruction_script")
TargetPath = NodePath("crate_wood_1")
FragmentsScene = ExtResource("crate_fragments")
```

- [ ] **Step 4: Build C# so the .csproj/.sln generate**

Open the Godot editor once if `total_party_krawl.sln` does not exist (Godot generates it on first C# attach), then build:
```powershell
& "C:\Program Files\dotnet\dotnet.exe" build "E:\repos\twitch\total-party-krawl\game\total_party_krawl.sln"
```
Expected: build succeeds, producing the assembly. Fix any compile errors before continuing.

- [ ] **Step 5: Verify the floor has a collider so debris lands**

The fragments are RigidBody3D; they need a `StaticBody3D` floor to rest on. If `test_floor.glb` has no collision, add a `StaticBody3D` + `CollisionShape3D` (BoxShape3D, wide and thin) under the root at the floor height in `art_test.tscn`:
```
[sub_resource type="BoxShape3D" id="floor_shape"]
size = Vector3(40, 0.2, 40)

[node name="FloorBody" type="StaticBody3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, -0.1, 0)

[node name="FloorCol" type="CollisionShape3D" parent="FloorBody"]
shape = SubResource("floor_shape")
```

- [ ] **Step 6: Verify destruction interactively**

Run the scene WITHOUT the screenshot env var (interactive) via run-godot's interactive form, press Space, and confirm the crate shatters into pieces that fly outward and settle on the floor.
Expected: `crate_wood_1` disappears and is replaced by physics-driven fragments that scatter and come to rest.

(Optional automated capture: extend `screenshot_on_ready.gd` later to trigger the action before capture; for now the destruction is verified interactively, the look via screenshot.)

- [ ] **Step 7: Commit**

```bash
git add game/scripts/DestructionTest.cs game/scenes/art_test.tscn game/project.godot
git commit -m "feat: add destructible-scenery test (crate shatters into Jolt-driven fragments)"
```

---

## Phase 6 — Final verification

### Task 9: End-to-end milestone check

- [ ] **Step 1: Full look screenshot**

Run via run-godot with screenshot env var. Read `game/.run/art_test.png`.
Expected: cel-shaded props with clean dark outlines under the 3/4 narrow-FOV camera and graded environment — a recognizable stylized low-poly look, not stock PBR.

- [ ] **Step 2: Destruction confirmation**

Run interactively, press Space.
Expected: the crate shatters into physics fragments that scatter and settle.

- [ ] **Step 3: Team scaffolding confirmation**

Run:
```bash
ls .claude/agents | wc -l   # expect 7
ls .claude/skills           # expect 5 dirs
ls .claude/hooks            # expect 5 .mjs
node -e "require('./.claude/settings.json'); console.log('settings ok')"
```
Expected: 7 agents, 5 skills, 5 hooks, settings ok.

- [ ] **Step 4: Final commit (any remaining)**

```bash
git add -A
git commit -m "chore: art-pipeline + destruction milestone complete" || echo "nothing to commit"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** 7 agents ✓ (Task 1), 5 skills ✓ (Task 2), 5 hooks ✓ (Task 3), engine version fix ✓ (Task 4), camera/lighting/env ✓ (Task 5), cel ✓ (Task 6), outline ✓ (Task 7), color grading ✓ (Task 5 env adjustments), destruction ✓ (Task 8), run-godot verify loop ✓ (used throughout, Task 9). Stale-residue flagged, not fixed ✓ (noted in agent prompts + deploy-backend skill).
- **Deviation from spec (justified):** outlines use inverted-hull next_pass rather than screen-space depth/normal edges — more reliable in Godot 4.5 for a first look proof; screen-space is recorded as a later enhancement. The `.gitignore` `*.import` fix was added because the asset-guard hook and Godot itself require committed `.import` sidecars.
- **Placeholder scan:** no TBD/TODO; all code blocks are complete. The one runtime lookup (the fragments `uid` in Task 8 Step 3) is explicitly sourced from the existing `.import` file.
- **Consistency:** `TPK_SCREENSHOT` env var, `game/.run/` output path, `cel_mat`/`outline_mat` sub-resource ids, and the `destruct` action name are used consistently across tasks.
