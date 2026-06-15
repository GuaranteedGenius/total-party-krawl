/* config.js — runtime configuration for the Total Party Krawl extension.
 *
 * LIGHTWEIGHT CONTROLLER. No game logic lives here.
 *
 * API_BASE is the Vercel deployment that hosts the relay API (see docs/api-contract.md).
 * Defaults to the live production deployment; the streamer can override it in config.html
 * (persisted via Twitch.ext.configuration).
 *
 * All other paths are RELATIVE because Twitch hosts the zipped extension contents.
 */
(function (global) {
  'use strict';

  var TPK_CONFIG = {
    // Default API base (live production relay). Overridden at runtime by streamer config when present.
    API_BASE: 'https://total-party-krawl-guaranteed-genius-projects.vercel.app',

    // REST endpoints (relative to API_BASE), per docs/api-contract.md.
    ENDPOINTS: {
      join: '/api/join',
      class: '/api/class',
      move: '/api/move',
      state: '/api/state'
    },

    // Soft countdown length, seconds. VISUAL ONLY — the game client owns the real clock.
    // We prefer endsAtEpochMs from the server prompt when available and fall back to this.
    SOFT_TIMER_SECONDS: 20,

    // How often to poll GET /api/state when Realtime push is unavailable (ms).
    POLL_INTERVAL_MS: 3000
  };

  global.TPK_CONFIG = TPK_CONFIG;
})(window);
