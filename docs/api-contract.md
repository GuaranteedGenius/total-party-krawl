# Relay API Contract (alpha — "Fight Me")

> The interface between the three components. The **Godot client** owns all game logic + the
> authoritative clock. The **server** (Vercel + Supabase) is a thin relay + persistence layer —
> NO game logic. The **Twitch extension** is a controller that submits viewer intent. Combat
> content (classes/moves/stats) is defined by the game and the spec
> `docs/superpowers/specs/2026-06-14-combat-core-design.md`; the extension only needs ids + labels.

## Roles & flow
1. Streamer's Godot client starts a **match** for their channel and is the clock authority.
2. Viewers open the extension panel → **join a seat** (≤10) → **pick a class** → each round
   **submit one move** `(moveId, targetId)` within the soft 20s window.
3. The server relays viewer submissions to the game client (Supabase Realtime) and stores them.
4. The game client resolves the round (its own engine), then publishes updated state the extension reads.

## Auth
- Every viewer→server call sends the Twitch Extension Helper JWT in header
  `Authorization: Bearer <jwt>` (also accept `X-Extension-JWT`). The server verifies it with the
  Twitch extension secret (HS256, base64). Identity = `{ channelId, opaqueUserId, userId?, role }`.
- Viewers NEVER write Supabase directly. All writes go through authenticated Vercel functions
  (service-role key, server-side only). Public read of non-sensitive match/seat state is allowed via RLS.

## Host (broadcaster) auth & pairing

The **game client** is the channel owner and must authenticate too — otherwise any
party could publish fake state or read a channel's incoming lock-ins. We prove
ownership against Twitch, then issue our own short-lived session token.

**Pairing flow** (the Godot client side — OAuth device-code flow + calling these
endpoints — is a LATER task; the server side below exists now):
1. In-game, the streamer links their Twitch account via OAuth **device-code flow**.
   The client ends up holding a Twitch **user access token**.
2. Client calls `POST /api/host/session` with `Authorization: Bearer <twitch_user_access_token>`.
   The server validates the token with Twitch (`GET https://id.twitch.tv/oauth2/validate`,
   header `Authorization: OAuth <token>` — Twitch requires the literal scheme "OAuth").
   The returned `user_id` IS the channel id (a broadcaster's channel id == their Twitch user id).
   If `TWITCH_EXTENSION_CLIENT_ID` is configured, the token's `client_id` must also match.
3. Server ensures a `matches` row for that channel and returns a **host-session JWT**
   (HS256, `HOST_SESSION_SECRET`, claims `{ sub: channelId, role: "host" }`, ~2h TTL).
4. The client presents that host JWT on `publish`/`moves`. A host token for channel A
   can NEVER publish to or read channel B (the token's `sub` is the only channel it touches).

### Host endpoints (under `api/host/`)
- `POST /api/host/session` — auth `Authorization: Bearer <twitch_user_access_token>`, body `{}`.
  Resp `{ hostToken, channelId, expiresAt }` (`expiresAt` = epoch ms). `hostToken` is the
  host-session JWT for the next two calls.
- `POST /api/host/publish` — auth `Authorization: Bearer <hostToken>`. Body:
  `{ round, phase, endsAtEpochMs?, boss: { hp, maxHp, alive },
     seats: [{ seatIndex, hp, maxHp, alive, classId }], snapshot?, channelId? }`.
  Writes these **mirrors** to `matches`/`seats` (+ `snapshot` jsonb) for the token's channel
  ONLY, then broadcasts a `state` event (and a `prompt` event when `phase === "lockin"`) on
  `match:<channelId>`. NO game logic — the server stores exactly what the client computed.
  If `channelId` is present and != the token's channel, the request is rejected `403`.
  Seat mirrors only update seats that already exist (claimed by viewers via `/api/join`);
  the host never fabricates a seat's `opaque_user_id`. Resp `{ ok: true, broadcastPrompt }`.
- `GET /api/host/moves?round=N` — auth `Authorization: Bearer <hostToken>`. Returns the
  channel's lock-ins for that round: `{ round, moves: [{ seatIndex, moveId, targetId }] }`.
  This is the **secure path** for the client to read viewer moves — service-role read, scoped
  to the token's channel, so the client never needs the anon key for sensitive pre-resolve data.

### Sensitive vs. broadcast rule
- **Sensitive — viewer lock-ins before resolution:** readable ONLY via `GET /api/host/moves`
  with a valid host token (service-role). NEVER broadcast on Realtime, NEVER anon-readable
  (`moves` table is service-role-only in RLS). One viewer must not see another's lock-in early,
  and no third party may scrape a channel's intended moves.
- **Non-sensitive — boss/party HP, round, phase, prompt:** fine to broadcast publicly on
  `match:<channelId>` (the extension/overlay subscribes to display it). The `state`/`prompt`
  events carry only these fields — never move data.

## Identifiers
- `channelId` — Twitch channel id (the match key; one active match per channel for alpha).
- `seatIndex` — 0..9.
- `classId` — `class.tank | class.mage | class.healer`.
- `moveId` — e.g. `tank.taunt`, `mage.fireball`, `healer.heal`, `*.basic_attack` (see DefaultContent).
- `targetId` — a combatant id: `boss` or a seat id like `seat.<index>`.
- `round` — integer round number from the game client.

## REST endpoints (Vercel, under `api/`)
All JSON. All require auth unless noted. Errors: `{ error: string }` with appropriate HTTP status.

- `POST /api/join` → body `{}` (channel from JWT). Claims/returns the caller's seat for the channel.
  Resp `{ seatIndex, classId|null, alreadySeated: bool }`. Idempotent.
- `POST /api/class` → body `{ classId }`. Sets the caller's class (allowed before the match locks it).
  Resp `{ ok: true, classId }`.
- `POST /api/move` → body `{ round, moveId, targetId }`. Records the caller's lock-in for that round
  and relays it (Realtime) to the game client. Re-submitting the same round overwrites. Resp `{ ok: true }`.
- `GET /api/state` → returns the caller-relevant snapshot:
  `{ matchPhase, round, endsAtEpochMs|null, you: { seatIndex, classId, hp, maxHp, alive, lockedMove|null },
     boss: { hp, maxHp, alive }, seats: [{ seatIndex, classId, hp, maxHp, alive }] }`.
  Used as a fallback/poll; primary updates come via Realtime. No game logic here — pure read of last
  state the client published.

## Supabase Realtime channels
- `match:<channelId>` — game client subscribes (anon key); receives `move` events
  `{ seatIndex, round, moveId, targetId }` as viewers submit. The `state` (the snapshot above)
  and `prompt` `{ round, endsAtEpochMs }` events are emitted **server-side** by
  `POST /api/host/publish` (the host-authenticated path) so the extension/overlay can subscribe
  for push updates. Only non-sensitive state is ever broadcast (see the sensitive-vs-broadcast
  rule above) — viewer lock-ins are never broadcast.

## Supabase schema (per-viewer seat model — replaces the abandoned chat-voting schema)
- `matches` (channel_id PK-ish, status, current_round, phase, boss_hp, boss_max_hp, updated_at).
- `seats` (channel_id, seat_index, opaque_user_id, class_id, hp, max_hp, alive, joined_at;
  unique(channel_id, seat_index) and unique(channel_id, opaque_user_id)).
- `moves` (channel_id, round, seat_index, move_id, target_id, created_at;
  unique(channel_id, round, seat_index) so a re-submit upserts).
- `players` (opaque_user_id PK, display_name?, xp, level, created_at) — minimal persistent
  progression stub; only the columns alpha needs. (XP/loot fully deferred.)
- RLS: public `select` on `matches`/`seats` per channel; all writes service-role only. `players`
  readable by owner; written service-role.

## Resolved conventions (locked during C+D build)
- **Basic Attack id is `basic.attack`** (one shared move every class references) — confirmed against
  `combat/DefaultContent.cs`. The extension and game use this exact string.
- **AOE target tokens:** single-target moves use `boss` or `seat.<index>`. All-enemy moves
  (`EnemyAll`, e.g. `mage.flame_burst`) send `targetId: "boss"` for alpha; all-ally moves
  (`AllyAll`, e.g. `healer.mend`) send `targetId: "party"`. The relay passes `targetId` through
  verbatim; the game engine resolves AOE by the move's `TargetRule` and ignores the token.
- **`matchPhase` values:** `lockin` (submissions open) | `resolving` | `won` | `lost`. The extension
  treats `won`/`lost` as terminal and allows submission whenever phase is `lockin`.
- **`moves` table is service-role-read-only** (viewers can't see each other's lock-ins pre-resolve).
- **`matches.snapshot` (jsonb):** the game client publishes the full per-channel state snapshot here;
  `/api/state` returns it (overlaying the caller's own seat/lockedMove) and falls back to assembling
  from rows before the first publish.

## Notes
- Boss HP/seat HP in the server are **mirrors** the game client pushes — the server never computes them.
- One match per channel for alpha. Grace window: the client accepts late moves ~1–2s after its timer.
- Secrets (Twitch ext secret, Supabase URL + service-role key) are env vars in Vercel — never committed.
