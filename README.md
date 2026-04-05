# Chat vs Streamer Boss Battle — Twitch Extension

A turn-based combat Twitch Extension where chat collectively controls a boss monster and the streamer fights back. Runs as a video overlay extension with a Vercel serverless backend and Supabase for persistence + real-time sync.

## Quick Start (Local Development)

### Prerequisites

- Node.js 18+
- npm
- Vercel CLI (`npm i -g vercel`)
- A Supabase project (free tier works)

### 1. Install dependencies

```bash
npm install
```

### 2. Set up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to the SQL Editor and run the contents of `supabase/schema.sql`
3. From Settings > API, copy your:
   - **Project URL** (e.g., `https://xyz.supabase.co`)
   - **Publishable key** (`sb_publishable_...` — public, safe for frontend)
   - **Secret key** (`sb_secret_...` — keep this secret, backend only)

### 3. Configure environment variables

Copy `.env` and fill in your values:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...your-publishable-key
SUPABASE_SECRET_KEY=sb_secret_...your-secret-key

TWITCH_CLIENT_ID=your-twitch-client-id
TWITCH_EXTENSION_SECRET=your-base64-encoded-secret

TESTING_MODE=true
```

### 4. Start the backend dev server

```bash
vercel dev
```

This runs the API on `http://localhost:3000`.

### 5. Open the test harness

Open `test-harness/index.html` directly in your browser (use a local file server or VS Code Live Server for best results):

```bash
# Option A: VS Code Live Server extension — right-click test-harness/index.html → Open with Live Server
# Option B: npx serve
npx serve . -p 5500
# Then open http://localhost:5500/test-harness/index.html
```

### 6. Configure Supabase in the test harness

In the bottom-right Test Controls panel, enter your Supabase URL and publishable key, then click "Save & Connect". These are saved to localStorage.

### 7. Play!

1. Click **Start New Game** in the test controls
2. Cast votes using the Chat Vote Simulator buttons
3. Pick a streamer action in the Live Config panel (top right)
4. Click **Force Resolve Turn** to resolve the turn
5. Watch health bars update, attack effects play, and events log in the overlay
6. Repeat until someone wins!

## Project Structure

```
├── extension/              # Frontend — uploaded to Twitch CDN as zip
│   ├── overlay.html        # Video overlay (transparent, sits over stream)
│   ├── panel.html          # Viewer voting panel (318px wide, below stream)
│   ├── config.html         # Streamer config page
│   ├── live_config.html    # Streamer live dashboard (pick moves, see state)
│   ├── css/styles.css      # All styling — dark gaming aesthetic, animations
│   └── js/
│       ├── overlay.js      # Overlay rendering (health bars, effects, timer)
│       ├── panel.js        # Viewer voting UI
│       ├── config.js       # Config persistence
│       ├── live_config.js  # Streamer dashboard logic
│       ├── supabase-realtime.js  # Supabase Realtime subscription wrapper
│       └── twitch-ext.js   # Twitch Extension Helper wrapper
├── test-harness/           # Local testing (replaces deprecated Twitch Dev Rig)
│   ├── index.html          # 4-panel test dashboard
│   ├── mock-twitch-ext.js  # Mock Twitch Extension Helper
│   └── test-controls.js    # Vote/bits/game simulators
├── api/                    # Vercel serverless functions
│   ├── game/start.ts       # POST — start a new match
│   ├── game/action.ts      # POST — streamer locks in action
│   ├── game/vote.ts        # POST — viewer casts a vote
│   ├── game/resolve.ts     # POST — resolve current turn
│   ├── game/state.ts       # GET — fetch current game state
│   ├── bits/transaction.ts # POST — handle Bits purchases
│   ├── history/record.ts   # POST — manually finalize match
│   ├── history/leaderboard.ts  # GET — public leaderboard
│   ├── middleware/auth.ts   # JWT verification (Twitch tokens)
│   └── _store.ts           # In-memory game state store
├── lib/
│   ├── types.ts            # Shared TypeScript interfaces
│   ├── game-engine.ts      # Core game logic (pure functions)
│   └── supabase.ts         # Supabase client + DB helpers
├── supabase/schema.sql     # Database schema
├── vercel.json             # Vercel config
└── package.json
```

## Game Mechanics

**Boss (Chat-controlled):** 500 HP
| Move | Effect | Cooldown |
|------|--------|----------|
| Slash | 40 damage | None |
| Fireball | 60 damage | 3 turns |
| Poison | 15 dmg/turn for 3 turns | None |
| Heal | Restore 50 HP | 4 turns |

**Streamer:** 300 HP
| Move | Effect | Cooldown |
|------|--------|----------|
| Strike | 30 damage | None |
| Heavy Blow | 50 damage | 2 turns |
| Shield | Block 50% incoming next turn | 3 turns |
| Potion | Restore 40 HP | 3 turns |

**Bits Moves (instant, bypass voting):**
- Ultimate Strike: 100 damage (100 Bits)
- Full Heal: Restore boss to max HP (500 Bits)

**Turn Flow:** 15-second voting window → both sides act simultaneously → damage/healing applied → status effects tick → check win condition → broadcast state to all viewers.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/game/start` | Broadcaster | Start a new match |
| POST | `/api/game/vote` | Any | Cast a vote for boss action |
| POST | `/api/game/action` | Broadcaster | Lock in streamer action |
| POST | `/api/game/resolve` | Broadcaster | Resolve current turn |
| GET | `/api/game/state` | Any | Get current game state |
| POST | `/api/bits/transaction` | Any | Record a Bits purchase |
| POST | `/api/history/record` | Broadcaster | Manually finalize match |
| GET | `/api/history/leaderboard` | None | Public leaderboard |

## Testing Mode

When `TESTING_MODE=true`:
- JWT signature verification is skipped (payloads are still parsed)
- Mock JWTs from the test harness are accepted
- A console warning logs on every request
- **Safety:** errors out if `NODE_ENV=production` to prevent accidental production use

## Transitioning to Twitch

When ready to go live on Twitch:

1. **Twitch Developer Console:** Create an Extension, configure the views (overlay, panel, component/config)
2. **Extension files:** Zip the `extension/` folder and upload to Twitch CDN
3. **Backend:** Deploy to Vercel (`vercel --prod`), set all env vars (with `TESTING_MODE` removed or `false`)
4. **Twitch Extension Secret:** The base64-encoded secret from your Extension's settings goes in `TWITCH_EXTENSION_SECRET`
5. **Bits Products:** Register your Bits products (ultimate_strike, full_heal) in the Extension settings
6. **Update frontend config:** Replace the localhost API_BASE and Supabase credentials with production values in the extension JS files (or use Twitch Configuration Service)
7. **Test with Twitch Local Test:** Before going live, use Twitch's hosted test mode to verify everything works with real Twitch auth

## Architecture Notes

- **In-memory state:** Game state lives in `api/_store.ts` (a Map in the serverless process). This works for MVP but won't persist across cold starts. For production, move active game state to Supabase or Redis.
- **Supabase Realtime Broadcast:** Used for pushing game state to all viewers. No database change listeners needed — the backend publishes directly to broadcast channels.
- **No framework:** The frontend uses vanilla HTML/CSS/JS per Twitch Extension requirements. Total bundle stays well under the 50MB CDN limit.
