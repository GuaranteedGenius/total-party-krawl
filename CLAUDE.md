# Total Party Krawl

## Decision-Making Principle

**Always pick the right choice, not the easiest.** This applies to every decision — tech stack, architecture, patterns, tools. The user is building a portfolio of games and wants to hone skills and workflows that compound over time. Short-term convenience that leads to long-term limitations is the wrong call. If a harder path produces a better product or better skills, take it. Explain the tradeoff honestly and recommend what's right.

## What This Is

A standalone game + free Twitch extension for small streamers (1-10 viewers). Viewers join as characters and play alongside or against the streamer in turn-based RPG combat. The game runs on the streamer's machine, OBS captures it, viewers interact through a lightweight Twitch extension panel.

## Product Philosophy

Help the little guy grow. Built for small streamers first. Every viewer matters — they're not a number in a vote, they're a character in the fight.

## Game Modes (Launch)

### "Fight Me" — Streamer is the Boss
- Streamer controls a boss character, picks boss moves each turn
- Up to 10 viewers join as individual characters, each picking their own class and actions
- Party wipes = streamer wins. Boss dies = viewers win.

### "Total Party Krawl" — Co-op Dungeon Crawl
- Streamer is party leader, picks their own hero moves
- Up to 10 viewers join as party members
- Together they fight AI-controlled enemies through a dungeon
- Same combat system as Fight Me, just swap who the boss is

These two modes share 90%+ of the codebase. The difference is who controls the boss (streamer vs AI) and the streamer's role (enemy vs party member).

### Deferred: "Raid Boss" — Large Chat Mode
- For bigger streams (50+ viewers), chat votes collectively on boss actions
- Streamer fights the boss solo
- Build this AFTER the small-stream modes are solid

## Architecture

### Three Components
- **Godot Game Client (C#)** — runs on streamer's machine, OBS captures it. Owns ALL game logic (combat, turns, damage, cooldowns) and ALL rendering (3D scenes, animations, effects). This is the game.
- **Server (Vercel + Supabase)** — thin relay + persistence layer. Handles Twitch auth (JWT), relays viewer moves to the game client via Supabase Realtime, persists player stats/gear/progression/match history/leaderboards. Does NOT run game logic.
- **Twitch Extension (HTML/JS)** — lightweight panel. Viewers join seats, pick class, submit moves, see their stats. No heavy rendering. It's a controller, not a game client.

### Why Game Logic in Godot (Not Server)
- Instant turn resolution — no network round-trip for combat math
- Server costs near-zero even at 1000 concurrent games (just relaying small JSON)
- Cheating is the streamer's problem, not ours — it's their stream/reputation
- Game engine lives next to the rendering code that animates the results
- Works offline for testing (streamer can play vs bots without backend)

### Overlay Layouts (3 options, streamer picks in config)
- **Full Screen** — game fills the entire stream
- **Facecam Left** — clear zone on left for webcam, game on right
- **Facecam Right** — mirror of above

### Key Systems
- **Seat system** — up to 10 viewer slots, join via extension, spectators can still Bits-interact
- **Class system** — data-driven, 3 launch classes: Tank (taunt ability), Mage (burst damage), Healer (party sustain)
- **Boss/enemy system** — data-driven, preset bosses for launch (streamer picks from archetypes)
- **Combat engine** — turn-based, simultaneous 20-sec lock-in, attacks resolve in DEX order
- **4 core stats** — STR (physical damage), INT (magic/healing), DEX (attack order + dodge), CON (max HP + resistance)
- **Progression** — XP, levels, loot, persistent per-viewer across channels (stored server-side in Supabase)

### Turn Flow
1. Turn starts → game client shows "Choose your action" → broadcasts to all viewers via Supabase
2. All players have 20 seconds to lock in moves via extension panel
3. Server relays viewer moves to game client as they arrive
4. Timer expires (game client is clock authority) → game client resolves all moves in DEX order
5. Animations play out in sequence → results broadcast → next turn
- **Soft timer** in extension panel (approximate countdown, "Waiting for results..." after expiry)
- **Server-side grace window** (1-2 sec after timer for late arrivals)
- **Streamer setup guide** recommends: Low Latency mode ON, wired connection, no buffer

### Stream Latency Strategy
- 20-second turns provide ample buffer for 3-8 sec stream delay
- Viewer move submission goes directly to API (bypasses stream delay)
- Extension panel timer is "soft" — visual guide, not authoritative
- Game client controls the real clock and calls resolve

### Art Direction
- **Real-time 3D in Godot** — low-poly models with stylized post-processing shaders
- NOT pre-rendered sprites — real-time 3D enables dynamic environmental destruction, AOE effects, physics debris
- Fixed/isometric camera angle so it reads like 2D but leverages full 3D capabilities
- Post-processing pipeline: cel shading, outlines, color grading for a distinctive look
- Destructible environments: fireballs blow chunks from pillars, shockwaves scatter debris, AOE clouds drift
- Goal: "feels familiar but I've never seen anything like this"
- User is a strong 3D artist, weaker at 2D — this pipeline plays to strengths

### Revenue Model
- Streamer buys the game (one-time or subscription) via Steam
- Extension is free for viewers
- Bits integration for premium moves (Twitch handles payment)

### Distribution
- Steam (Win/Mac/Linux via Godot export) — handles payments, updates, discovery, reviews
- GodotSteam plugin for Steamworks integration

## Current State

The repo has an early MVP prototype (pre-pivot) with:
- Vercel serverless API (game/start, game/vote, game/action, game/resolve, game/state)
- Twitch extension HTML/JS (overlay, panel, live_config, config)
- Game engine with turn resolution (TypeScript — will be rewritten in C# in Godot)
- Test harness for local development
- Mock Twitch auth for testing

This prototype was built for the old "Raid Boss" (chat votes) concept. The pivot is to Godot game client + extension hybrid for Fight Me / Total Party Krawl modes. The TypeScript game engine will be replaced by C# in Godot.

### Art Style Test Project
Before building the full game, a separate small Godot test project is being developed to nail the visual pipeline: low-poly 3D models → post-processing → unique art style. This is the visual identity exploration phase.

## Development Guidelines

- **Always pick the right choice, not the easiest** (see Decision-Making Principle above)
- Data-driven design: classes, bosses, moves, enemies defined as data, not hardcoded
- Keep the extension panel simple — it's a controller, not a game client
- The Godot game client is where ALL game logic and rendering happens
- Don't over-abstract early — build for the two launch modes, refactor when patterns emerge
- Build for 50 concurrent games, design so we can serve 1000
