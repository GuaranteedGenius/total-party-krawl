/**
 * TwitchExt — thin wrapper around the Twitch Extension Helper.
 *
 * If window.Twitch is not present (e.g. running inside a test harness that
 * already supplies its own mock), this module does nothing — the mock will
 * have set everything up before this script loads.
 */
(function () {
  'use strict';

  var TwitchExt = {
    /** JWT token provided by onAuthorized */
    token: null,

    /** Numeric channel ID string */
    channelId: null,

    /** Opaque user ID (may start with "U" for logged-in users) */
    userId: null,

    /** 'viewer' | 'broadcaster' | 'moderator' | 'external' */
    role: null,

    /** Whether init() has already fired its callback */
    _ready: false,

    /**
     * Initialise the extension.  Calls Twitch.ext.onAuthorized, stores the
     * auth fields, then invokes `callback` once.
     *
     * @param {Function} callback — called with no arguments once auth is ready.
     */
    init: function (callback) {
      if (!window.Twitch || !window.Twitch.ext) {
        // Running outside the Twitch iframe (test harness / local dev).
        // The mock should have already populated window.Twitch.
        console.warn('[TwitchExt] window.Twitch not found — skipping init (test mode?).');
        return;
      }

      var self = this;

      window.Twitch.ext.onAuthorized(function (auth) {
        self.token     = auth.token;
        self.channelId = auth.channelId;
        self.userId    = auth.userId;

        // Decode the JWT payload to grab the role.
        try {
          var payload = JSON.parse(atob(auth.token.split('.')[1]));
          self.role = payload.role || 'viewer';
        } catch (_e) {
          self.role = 'viewer';
        }

        if (!self._ready) {
          self._ready = true;
          if (typeof callback === 'function') {
            callback();
          }
        }
      });
    },

    /**
     * Subscribe to context changes (theme, language, game, etc.).
     *
     * @param {Function} callback — receives (context, changedKeys).
     */
    onContext: function (callback) {
      if (!window.Twitch || !window.Twitch.ext) return;
      window.Twitch.ext.onContext(function (context, changed) {
        if (typeof callback === 'function') {
          callback(context, changed);
        }
      });
    },

    /**
     * Subscribe to Bits transaction completions.
     *
     * @param {Function} callback — receives the transaction object.
     */
    onBitsTransaction: function (callback) {
      if (!window.Twitch || !window.Twitch.ext) return;
      if (!window.Twitch.ext.bits) {
        console.warn('[TwitchExt] Bits API not available.');
        return;
      }
      window.Twitch.ext.bits.onTransactionComplete(function (transaction) {
        if (typeof callback === 'function') {
          callback(transaction);
        }
      });
    },

    /**
     * Build headers for calls to our own EBS (Extension Backend Service).
     *
     * @returns {{ Authorization: string, 'Content-Type': string }}
     */
    getApiHeaders: function () {
      return {
        'Authorization': 'Bearer ' + (this.token || ''),
        'Content-Type':  'application/json'
      };
    }
  };

  // Expose globally
  window.TwitchExt = TwitchExt;
})();
