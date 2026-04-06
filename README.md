# Total Party Krawl

A standalone Godot 4 game + free Twitch extension for small streamers. Viewers join as individual characters and play alongside or against the streamer in turn-based RPG combat.

## Game Modes

- **Fight Me** — Streamer is the boss, up to 10 viewers fight them (building first)
- **Total Party Krawl** — Co-op dungeon crawl, streamer + viewers vs AI enemies
- **Raid Boss** — Large chat voting mode for bigger streams (deferred)

## Project Structure

```
├── game/               Godot 4 C# project (all game logic + rendering)
│   ├── assets/         3D models, textures, audio
│   ├── shaders/        Post-processing, cel shading, outlines
│   ├── scripts/        C# game scripts
│   └── scenes/         Godot scene files
├── api/                Vercel serverless (auth, move relay, persistence)
├── extension/          Twitch extension (lightweight viewer controller)
│   ├── css/
│   └── js/
├── lib/                Shared TypeScript utilities
├── supabase/           Database schema
└── docs/               Design specs and documentation
```

## Architecture

- **Godot Game Client** — runs on streamer's machine, OBS captures it. Owns all game logic and rendering.
- **Server (Vercel + Supabase)** — thin relay + persistence. Auth, move relay, player stats. No game logic.
- **Twitch Extension** — lightweight HTML/JS panel. Join, pick class, submit moves. It's a controller, not a game client.

See [CLAUDE.md](CLAUDE.md) for full technical details.
