/**
 * GameSync — lightweight Supabase Realtime wrapper for Boss Battle.
 *
 * Expects the Supabase JS v2 client to be loaded globally before this script:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *
 * Usage:
 *   GameSync.init(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
 *   GameSync.subscribe(channelId, function (payload) { ... });
 *   // later:
 *   GameSync.unsubscribe();
 */
(function () {
  'use strict';

  var GameSync = {
    /** @type {import('@supabase/supabase-js').SupabaseClient | null} */
    supabase: null,

    /** @type {import('@supabase/supabase-js').RealtimeChannel | null} */
    channel: null,

    /**
     * Create the Supabase client.
     *
     * @param {string} supabaseUrl   — e.g. "https://xyz.supabase.co"
     * @param {string} supabaseAnonKey — the public anon key
     */
    init: function (supabaseUrl, supabaseAnonKey) {
      if (!window.supabase || !window.supabase.createClient) {
        console.error('[GameSync] Supabase JS client not found on window. Make sure the CDN script is loaded first.');
        return;
      }

      this.supabase = window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
        realtime: {
          params: {
            eventsPerSecond: 10
          }
        }
      });

      console.log('[GameSync] Supabase client initialised.');
    },

    /**
     * Subscribe to game-state broadcasts for a specific channel.
     *
     * The EBS (or Edge Function) publishes to a Realtime Broadcast channel
     * named `game:<channelId>` with event name `game_state`.
     *
     * @param {string}   channelId   — Twitch channel ID
     * @param {Function} onGameState — called with the broadcast payload each time
     */
    subscribe: function (channelId, onGameState) {
      if (!this.supabase) {
        console.error('[GameSync] Cannot subscribe — call init() first.');
        return;
      }

      // Clean up any existing subscription before creating a new one.
      this.unsubscribe();

      var topicName = 'game:' + channelId;

      this.channel = this.supabase.channel(topicName, {
        config: {
          broadcast: { self: false }
        }
      });

      this.channel
        .on('broadcast', { event: 'game_state' }, function (message) {
          if (typeof onGameState === 'function') {
            onGameState(message.payload);
          }
        })
        .subscribe(function (status) {
          console.log('[GameSync] Channel "' + topicName + '" status:', status);
        });
    },

    /**
     * Unsubscribe and remove the current channel.
     */
    unsubscribe: function () {
      if (this.channel) {
        this.supabase.removeChannel(this.channel);
        this.channel = null;
        console.log('[GameSync] Unsubscribed from channel.');
      }
    }
  };

  // Expose globally
  window.GameSync = GameSync;
})();
