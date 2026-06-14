# Total Party Krawl — Roadmap to Alpha

> Living document. Tick boxes as we go. Last reviewed: 2026-06-14.
> Full product vision lives in [`CLAUDE.md`](../CLAUDE.md). Design specs live in
> [`docs/superpowers/specs/`](superpowers/specs/); implementation plans in
> [`docs/superpowers/plans/`](superpowers/plans/).

## Where we are now

- **Done:** Agent/skill/hook team scaffolded. Art pipeline working on `game/scenes/art_test.tscn`
  — cel materials on all props, **screen-space color-tinted outlines** (CompositorEffect), warm
  lighting, calmer stone. Destruction test working: Space shatters all destructibles (barrels,
  crates, pillars) into Jolt-driven fragments. Verified live in-engine.
- **Status:** This is a **visual + physics prototype**. There is no game loop, no Twitch
  extension, and no backend yet. "Alpha" below = building the thin vertical slice of the real game.

## Alpha goal

A playable **"Fight Me"** match: a streamer friend runs the game (OBS captures it), a few viewers
join via the Twitch extension and fight the streamer-controlled boss in turn-based combat.

### Scope locks for alpha
- **Mode:** "Fight Me" only (streamer = boss). No AI to build — simplest real loop.
- **Party size:** 2–4 viewers for the first test.
- **Combat fidelity:** minimal but real — HP bars, damage numbers, simple attack feedback.
  Destruction is flavor, not required.
- **Defer everything not needed to feel the loop** (see Deferred section).

---

## Milestones

### Milestone A — Combat core, offline vs bots  · game-designer + godot-gameplay-engineer
- [ ] Data schemas: `Class`, `Move`, `Boss`, stat block (STR/INT/DEX/CON) as Godot Resources
- [ ] Turn loop: 20s simultaneous lock-in, resolve in DEX order, HP/damage/heal math
- [ ] 3 launch classes (Tank/Mage/Healer) + 1 boss + ~2–3 moves each, as data
- [ ] Bot "viewers" so a full fight runs with zero network
- [ ] Win/lose: party wipe = streamer wins, boss dies = viewers win
- [ ] Unit tests for resolution order + damage formulas

### Milestone B — Combat on screen  · godot-art-pipeline + godot-gameplay-engineer
- [ ] Combat scene: arena, boss + party seats laid out, cel look applied
- [ ] HP bars / nameplates, turn countdown UI, "choose your action" state
- [ ] Action feedback: attack anim/VFX + floating damage numbers
- [ ] One overlay layout (Full Screen) wired; facecam variants later

### Milestone C — Backend relay  · backend-relay-engineer
- [ ] Replace the abandoned chat-voting `supabase/schema.sql` with the per-viewer seat model
- [ ] Supabase Realtime: broadcast turn prompt → relay viewer moves back to the client
- [ ] Twitch JWT verification + Vercel endpoints (join seat, submit move)
- [ ] 1–2s server grace window for late moves
- [ ] Deploy (Vercel + Supabase) via the `deploy-backend` skill

### Milestone D — Twitch extension (viewer controller)  · twitch-extension-dev
- [ ] Panel: join a seat, pick class, submit a move, see own HP, soft timer
- [ ] Twitch Extension Helper SDK auth → hand JWT to the API
- [ ] Config page (streamer picks layout / mode)
- [ ] Package + upload to the Twitch dev console in developer/test mode (no full review for private alpha)

### Milestone E — Integration + streamer setup  · qa-test-engineer + build-release-engineer
- [ ] End-to-end test: prompt → viewer submits in panel → relay → client resolves
- [ ] Mock-Twitch harness to test without going live
- [ ] Streamer setup guide: OBS capture, low-latency mode, dev-rig steps
- [ ] Real latency check with actual stream delay

### Milestone F — Alpha playtest
- [ ] Dry run solo (bots + the extension on your own channel's test rig)
- [ ] Live test with the streamer friend + a few viewers
- [ ] Capture a bug/feel list, iterate

---

## Deferred (NOT for alpha)
Progression/XP/loot, leaderboards, Steam + GodotSteam packaging, the co-op "Total Party Krawl"
mode, Raid Boss (large-chat) mode, Bits/premium moves. All owned by the team, all post-alpha.

---

## Pre-combat cleanup (do before Milestone A)
Small items to finish the prototype and put the destruction system in its real form:
- [ ] Commit the current art + destruction checkpoint.
- [ ] Refactor destruction into a reusable `Shatterable` component (see Systems notes) so adding a
      breakable is pure data, not a code edit.
- [ ] Build the click-to-fire ball (left-click → ball arcs to boss → AOE shatter). Designed but not built.
- [x] Reconcile engine version: project is on **Godot 4.6.2** (`project.godot` + `.csproj` SDK);
      `run-godot`/`export-game` skills and Godot agent prompts updated to the 4.6.2 binary.

---

## Systems notes

### Destruction
- **Now:** `game/scripts/DestructionTest.cs` is a test harness — it walks the scene tree and
  matches props by source asset (`SceneFilePath`), then swaps each for its `*_fragments.glb` and
  scatters the pieces with Jolt. Adding a destructible currently requires a code edit.
- **Target design:** a `Shatterable` component on each prop holding its own `Fragments` PackedScene
  and joining a `"shatterable"` group. Discovery is then `GetTree().GetNodesInGroup("shatterable")`,
  and adding a breakable is pure data (attach component, assign fragments). The ball's AOE impact
  consumes this group within a blast radius.

### Art / look
- Cel = per-material flat-albedo shader (`game/shaders/cel.gdshader`); models are flat
  baseColorFactor (no textures). Per-surface materials in `game/materials/`.
- Outlines = screen-space CompositorEffect (`game/shaders/outline_post.glsl` + `.gd`), tunable via
  `materials/outline_compositor.tres` (`line_darken`, `tint_amount`, `line_width`, thresholds).
- **Tooling gotcha:** a plain `godot --path … scene` run does NOT recompile changed `.glsl` —
  force `--import` first (see the `run-godot` skill).
