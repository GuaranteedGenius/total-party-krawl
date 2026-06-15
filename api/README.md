# Total Party Krawl — Relay + Persistence Backend

A **thin relay**. The Godot client owns all game logic and the authoritative
clock. This backend only:

- verifies the Twitch Extension JWT (viewers) **and** authenticates the
  broadcaster's game client (host-session JWT, derived from a Twitch user token),
- claims seats / sets classes / records + relays viewer moves,
- lets the verified host publish authoritative state and securely read its
  channel's incoming lock-ins,
- reads the last snapshot the game client published.

No combat math, HP/damage, cooldowns, or turn resolution lives here. HP / alive
/ round / phase columns are **mirrors** the client pushes.

## Layout

```
api/            Vercel serverless endpoints (thin wrappers)
  join.ts       POST /api/join          -> claim/return seat (idempotent)
  class.ts      POST /api/class         -> set class on seat
  move.ts       POST /api/move          -> record + Realtime-relay a lock-in
  state.ts      GET  /api/state         -> caller-relevant snapshot (poll fallback)
  host/
    session.ts  POST /api/host/session  -> Twitch user token -> host-session JWT
    publish.ts  POST /api/host/publish  -> host writes authoritative mirrors + relays state/prompt
    moves.ts    GET  /api/host/moves    -> host securely reads its channel's lock-ins
lib/
  twitchAuth.ts Twitch Extension JWT verify (HS256, base64 secret) — viewers
  hostAuth.ts   Twitch user-token validate (injected fetch) + host-session JWT mint/verify
  supabase.ts   service-role client + typed row helpers + Realtime broadcast
  relay.ts      pure relay logic, viewer + host (unit-tested with a mock client)
  http.ts       CORS/preflight/body/error helpers + requireAuth/requireHost
  types.ts      shared row + payload types
  __tests__/    node --test unit tests (no live services)
supabase/
  schema.sql    per-viewer seat schema + RLS (run in Supabase SQL editor)
```

See `docs/api-contract.md` for the authoritative endpoint/Realtime contract.

## Local development / tests

```bash
npm install
npm test        # node --test, all mocked — needs NO real credentials
npm run typecheck
```

`npm run dev` runs `vercel dev` and DOES require the env vars below
(`.env.local`).

## Environment variables (the human gate)

| Var                          | Required | Where to get it |
| ---------------------------- | -------- | --------------- |
| `SUPABASE_URL`               | yes      | Supabase -> Project Settings -> API -> Project URL |
| `SUPABASE_SECRET_KEY`        | yes      | Supabase -> Project Settings -> API -> **service_role** secret |
| `TWITCH_EXTENSION_SECRET`    | yes      | Twitch Dev Console -> Extension -> Settings -> Secret Keys (base64) |
| `HOST_SESSION_SECRET`        | yes      | A random string YOU generate (`openssl rand -hex 32`); signs the host-session JWT |
| `TWITCH_EXTENSION_CLIENT_ID` | optional | Twitch Dev Console -> Extension -> Settings -> Client ID. If set, host pairing also pins the streamer's Twitch token to this client_id |

See `.env.example`. Never commit real values (`.env*` are gitignored).

## What the human must do to go live

1. **Create a Supabase project.** Copy the Project URL and the `service_role`
   secret. Open the SQL editor and run `supabase/schema.sql` (creates
   `matches`, `seats`, `moves`, `players` + RLS).
2. **Create the Twitch Extension** in the Twitch Developer Console. Generate a
   Secret Key (this is `TWITCH_EXTENSION_SECRET`) and note the Client ID. Set
   the panel/config URLs to the extension's hosted assets (extension agent's
   domain).
3. **Set env vars in Vercel** (Project -> Settings -> Environment Variables) for
   Production + Preview: the four vars above. Also drop them in `.env.local` for
   `vercel dev`.
4. **Enable deploys when ready.** `vercel.json` has `git.deploymentEnabled:
   false` so nothing auto-builds while secrets are missing. Flip it to `true`
   (or deploy manually with `vercel --prod`) once steps 1-3 are done.
5. **Supabase Realtime:** Broadcast is enabled by default; no table-replication
   toggle is needed because we use ephemeral `broadcast` events (not Postgres
   changes) on `match:<channelId>`. The Godot client subscribes to that channel
   with the **anon** key to receive `move` events. NOTE: it does NOT publish
   state via the anon key — authoritative `state`/`prompt` go through
   `POST /api/host/publish` (host-token-gated) which broadcasts server-side, and
   pre-resolution lock-ins are read via `GET /api/host/moves`, never the anon key.
6. **Host pairing (broadcaster auth).** The game client links the streamer's
   Twitch account via OAuth **device-code flow** (a later Godot task), obtains a
   Twitch **user access token**, and exchanges it at `POST /api/host/session` for
   a short-lived host-session JWT. That JWT authorizes `publish`/`moves` for the
   streamer's channel only. See `docs/api-contract.md` -> "Host (broadcaster)
   auth & pairing".

## Notes / decisions

- **Single source per file.** Endpoints import lib modules with explicit `.ts`
  extensions so the exact same source runs under `node --test` (native type
  stripping), under Vercel's esbuild bundling, and `tsc --noEmit`
  (`allowImportingTsExtensions`). No dual build step.
- **Service-role only writes.** The extension never touches Supabase directly;
  all writes go through these authenticated functions. RLS denies anon writes.
- **Grace window** for late moves is enforced by the *game client* (it decides
  whether to accept a relayed move ~1-2s after its timer). The server always
  accepts and relays — it has no clock.
