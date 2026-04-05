# Claude Code Prompt — Boss Battle MVP

I'm building a Twitch Extension — specifically the "Chat vs Streamer Boss Battle" mode as the MVP. This is a turn-based combat game where chat collectively controls a boss monster and the streamer fights back. It runs as a Twitch video overlay extension with a backend on Vercel serverless functions.

## What This Mode Does

- Turn-based combat displayed as a video overlay (transparent background, positioned over the stream)
- Chat collectively controls a boss monster — they vote on attacks each turn (slash, fireball, poison, heal) via the extension's viewer panel or overlay buttons
- Streamer has a control panel (Twitch component/config panel) to pick their moves each turn
- Both sides have animated health bars, attack effects, and a turn timer countdown
- Bits integration: viewers spend Bits to unlock ultimate attacks, heal the boss, or debuff the streamer
- Match history and win/loss records persist across streams via Supabase
- Game state syncs in real-time across all viewers via Supabase Realtime

## Tech Stack

- **Extension frontend:** HTML, CSS, vanilla JS (no frameworks — Twitch requires plain files hosted on their CDN, total under 50MB)
- **Backend (EBS):** Vercel serverless functions in Node.js/TypeScript (Hobby/free tier — stay within 1M invocations/month)
- **Database + Realtime:** Supabase free tier (PostgreSQL for match history, win/loss records, leaderboards + Supabase Realtime Broadcast for live game state sync to all viewers — no need for Ably or Pusher)
- **Twitch integration:** Twitch Extensions Helper JS (auth, context, Bits), PubSub for Bits transactions
- **Hosting:** Frontend on Twitch CDN (uploaded as zip), backend on Vercel

## Why Supabase Realtime (not Ably/Pusher)

Supabase Realtime is included free on the Supabase free tier with unlimited connections. Use Supabase Realtime Broadcast channels (not database change listeners) to push game state updates. The backend publishes to a channel like `game:{channel_id}` after each turn resolves, and every viewer's overlay subscribes to that channel. This eliminates a separate real-time service entirely.

## Project Structure

```
twitch-boss-battle/
├── extension/              # Frontend — uploaded to Twitch as zip
│   ├── overlay.html        # Video overlay (viewers see this over the stream)
│   ├── panel.html          # Viewer panel below stream (vote on attacks here)
│   ├── config.html         # Streamer config page (set boss name, difficulty, etc.)
│   ├── live_config.html    # Streamer live dashboard (pick moves, see game state)
│   ├── css/
│   │   └── styles.css      # All styling — dark/gaming aesthetic, animations
│   ├── js/
│   │   ├── overlay.js      # Overlay logic — render health bars, effects, turn state
│   │   ├── panel.js        # Viewer voting UI logic
│   │   ├── config.js       # Config page logic
│   │   ├── live_config.js  # Streamer dashboard logic
│   │   ├── supabase-realtime.js  # Supabase Realtime subscription wrapper (Broadcast channels)
│   │   └── twitch-ext.js   # Twitch Extension Helper wrapper (auth, bits, context)
│   └── assets/
│       └── (sprites, icons, sounds if any)
├── test-harness/           # Local testing environment (replaces deprecated Twitch Developer Rig)
│   ├── index.html          # Main test page — loads all views side by side
│   ├── mock-twitch-ext.js  # Mock Twitch Extension Helper (fake JWT, fake user context, fake Bits)
│   └── test-controls.js    # Simulate chat votes, Bits transactions, multiple viewers
├── api/                    # Vercel serverless functions (backend EBS)
│   ├── game/
│   │   ├── start.ts        # POST — start a new match
│   │   ├── action.ts       # POST — streamer submits their move
│   │   ├── vote.ts         # POST — viewer submits a vote for boss action
│   │   ├── resolve.ts      # POST — resolve current turn (called by timer or trigger)
│   │   └── state.ts        # GET — fetch current game state
│   ├── bits/
│   │   └── transaction.ts  # POST — handle Bits transactions (ultimate attacks, heals, debuffs)
│   ├── history/
│   │   ├── record.ts       # POST — save match result
│   │   └── leaderboard.ts  # GET — fetch win/loss history
│   └── middleware/
│       └── auth.ts         # Verify Twitch JWT tokens on all requests
├── lib/                    # Shared backend utilities
│   ├── supabase.ts         # Supabase client init (database + realtime publish helper)
│   ├── game-engine.ts      # Core game logic — damage calc, cooldowns, turn resolution, status effects
│   └── types.ts            # TypeScript interfaces for game state, actions, players
├── supabase/
│   └── schema.sql          # Database schema — matches, turns, leaderboard tables
├── vercel.json             # Vercel config (routes, env vars)
├── package.json
├── tsconfig.json
└── README.md               # Setup instructions
```

## Local Test Harness (IMPORTANT — build this first)

Twitch's Developer Rig was deprecated in 2023 and no longer works. Build a local test harness so I can develop and test everything without going live on Twitch. This is the primary development environment.

### test-harness/index.html

A single HTML page that simulates the full Twitch extension environment:

- **Layout:** Split screen showing all four extension views simultaneously:
  - Top left: Video Overlay view (overlay.html in an iframe, sized to 1280x720 with a placeholder "stream" background image or video behind it so I can see the transparent overlay in context)
  - Top right: Streamer Live Config (live_config.html in an iframe — this is the streamer's control panel)
  - Bottom left: Viewer Panel (panel.html in an iframe, sized to Twitch panel dimensions ~318px wide)
  - Bottom right: Test Controls panel (not an extension view — this is the simulation dashboard)

- **Test Controls panel should include:**
  - "Start New Game" button
  - Chat vote simulator: buttons to cast votes as fake viewers (e.g. "Add 5 votes for Slash", "Add 3 votes for Fireball") with a live vote tally display
  - Bits transaction simulator: buttons like "Trigger 100 Bits — Ultimate Strike" and "Trigger 500 Bits — Full Heal" that fire fake Bits events
  - Viewer count simulator: slider to simulate 1-500 connected viewers
  - Turn timer controls: "Force Resolve Turn" button to skip the 15-second timer during testing
  - Game state inspector: live JSON display of current game state from Supabase
  - Console log viewer: captures and displays console.log output from all iframes in one place

### test-harness/mock-twitch-ext.js

A mock implementation of the Twitch Extension Helper JS that:
- Provides a fake `window.Twitch.ext` object with all the methods the extension code uses
- Generates valid-looking (but fake) JWT tokens with configurable user roles (viewer, broadcaster, moderator)
- Mocks `Twitch.ext.onAuthorized()` with fake channel ID, client ID, and token
- Mocks `Twitch.ext.onContext()` with fake game, language, theme, and video dimensions
- Mocks `Twitch.ext.bits.onTransactionComplete()` so the Bits simulator can trigger fake transactions
- Mocks `Twitch.ext.bits.useBits()` to simulate the Bits purchase flow
- The overlay.html and panel.html should load this mock instead of the real Twitch Helper when running in the test harness (use a query param like `?mock=true` or detect if `window.Twitch` is already defined)

### test-harness/test-controls.js

The logic for the simulation dashboard:
- Connects to the real Supabase backend (same Realtime channels the extension uses) so I can see real data flow
- Hits the real Vercel dev server (`vercel dev` on localhost) for all API calls
- The vote simulator sends real HTTP requests to the vote endpoint with mock auth
- The Bits simulator sends real HTTP requests to the transaction endpoint
- Everything except Twitch auth is real — the harness only mocks the Twitch-specific layer

### Backend auth bypass for local testing

Add a `TESTING_MODE=true` environment variable. When set:
- The auth middleware skips JWT signature verification but still parses the token payload
- The mock JWT tokens from the test harness are accepted
- A console warning logs on every request reminding you testing mode is active
- This flag must NEVER be set in production — add a check that errors out if `TESTING_MODE=true` and `NODE_ENV=production`

## Game Mechanics

**Boss (Chat-controlled):**
- HP: 500, Attack options per turn: Slash (40 dmg), Fireball (60 dmg, 3-turn cooldown), Poison (15 dmg/turn for 3 turns), Heal (restore 50 HP, 4-turn cooldown)
- Chat votes during a 15-second window, highest vote wins
- Bits moves: Ultimate Strike (100 dmg, costs 100 Bits), Full Heal (restore to max, costs 500 Bits)

**Streamer:**
- HP: 300, Attack options: Strike (30 dmg), Heavy Blow (50 dmg, 2-turn cooldown), Shield (block 50% incoming dmg next turn, 3-turn cooldown), Potion (restore 40 HP, 3-turn cooldown)
- Streamer picks via live config panel, has same 15-second timer

**Turn flow:**
1. Turn starts → 15-second countdown begins
2. Chat votes on boss action, streamer picks their action
3. Timer expires → backend resolves turn (both actions execute simultaneously)
4. Damage/healing applied, status effects tick, cooldowns decrement
5. New game state published via Supabase Realtime Broadcast to all viewers
6. Check win condition (either side reaches 0 HP)
7. If game over → record result to Supabase database, show victory/defeat screen

**Bits integration:**
- Use Twitch Extensions Bits products (onTransactionComplete callback)
- When a Bits transaction completes, backend verifies it via Twitch API and applies the effect
- Effects apply immediately (not tied to voting phase)

## Supabase Realtime Implementation

Use Supabase Realtime Broadcast (not Postgres Changes) for game state sync:

```js
// Frontend — subscribe to game state updates
const channel = supabase.channel(`game:${channelId}`)
channel.on('broadcast', { event: 'game_state' }, (payload) => {
  renderGameState(payload)
}).subscribe()

// Backend — publish game state after turn resolution
await supabase.channel(`game:${channelId}`).send({
  type: 'broadcast',
  event: 'game_state',
  payload: gameState
})
```

This keeps all viewers in sync without needing Ably, Pusher, or any additional service.

## Database Schema (Supabase PostgreSQL)

- `matches` table: id, channel_id, boss_name, streamer_hp_start, boss_hp_start, winner (streamer|chat), turns_played, started_at, ended_at
- `turns` table: id, match_id, turn_number, boss_action, streamer_action, boss_hp_after, streamer_hp_after, votes_json, bits_used
- `leaderboard` table: channel_id, streamer_wins, chat_wins, total_matches, last_played

## Environment Variables Needed

```
# Supabase
SUPABASE_URL=           # From Supabase project settings
SUPABASE_ANON_KEY=      # From Supabase project settings (public, safe for frontend)
SUPABASE_SERVICE_KEY=   # From Supabase project settings (secret, backend only)

# Twitch
TWITCH_CLIENT_ID=       # From Twitch Developer Console
TWITCH_EXTENSION_SECRET=# From Twitch Developer Console (for JWT verification)

# Testing
TESTING_MODE=true       # ONLY for local dev — enables mock auth bypass
```

## Build Order

1. **Test harness first** — get the index.html layout working with all four iframes, mock Twitch helper, and test controls panel. I need to see something immediately.
2. **Game engine** — build the core turn resolution logic in lib/game-engine.ts with unit-testable pure functions
3. **Backend API** — wire up the Vercel serverless functions with Supabase
4. **Frontend overlay** — health bars, turn timer, attack animations on the overlay
5. **Frontend panel** — voter UI for chat participants
6. **Frontend live config** — streamer's move selection dashboard
7. **Wire it all together** — connect frontend → backend → Supabase Realtime → frontend

## What to Build Now

Build the entire MVP end to end. I want to be able to:
1. Open the test harness in my browser and see all four views
2. Click "Start Game" in test controls and see health bars appear on the overlay
3. Use the vote simulator to cast boss votes, pick a streamer move in the live config panel
4. Watch the turn resolve with animations and health bar changes
5. Play through a full match to a win/loss result
6. See the result saved to Supabase and reflected on a leaderboard

Make the overlay look polished — dark gaming aesthetic, smooth CSS animations on health bars, attack flash effects, clean typography. This needs to look like a real product, not a prototype.

Write clean, well-commented code throughout. Include a README with full setup instructions (env vars needed, Supabase project setup, Twitch Developer Console config, local testing steps, and how to transition from test harness to Twitch Local Test mode when ready).

Start building.
