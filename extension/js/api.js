/* api.js — REST client for the relay API (docs/api-contract.md).
 *
 * Every call sends the Twitch Helper JWT as `Authorization: Bearer <jwt>`.
 * The extension NEVER writes Supabase directly and runs NO game logic — it submits
 * viewer intent and reads back the snapshot the game client published.
 *
 * Depends on: window.TPK_CONFIG, window.TPK_AUTH.
 */
(function (global) {
  'use strict';

  var cfg = global.TPK_CONFIG;

  // Allow the streamer config / mock to override the API base at runtime.
  var apiBase = cfg.API_BASE;
  function setApiBase(url) {
    if (url && typeof url === 'string') {
      apiBase = url.replace(/\/+$/, ''); // trim trailing slash
    }
  }
  function getApiBase() { return apiBase; }

  function authToken() {
    var auth = global.TPK_AUTH.getAuth();
    return auth ? auth.token : null;
  }

  function request(path, method, body) {
    var token = authToken();
    if (!token) {
      return Promise.reject(new Error('Not authorized yet (no JWT). Wait for onAuthorized.'));
    }
    var url = apiBase + path;
    var opts = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        // Contract also accepts X-Extension-JWT; send both for robustness.
        'X-Extension-JWT': token
      }
    };
    if (body !== undefined && body !== null) {
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (resp) {
      return resp.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (e) { data = { raw: text }; } }
        if (!resp.ok) {
          var msg = (data && data.error) ? data.error : ('HTTP ' + resp.status);
          var err = new Error(msg);
          err.status = resp.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  global.TPK_API = {
    setApiBase: setApiBase,
    getApiBase: getApiBase,

    // POST /api/join  → { seatIndex, classId|null, alreadySeated }
    join: function () { return request(cfg.ENDPOINTS.join, 'POST', {}); },

    // POST /api/class { classId } → { ok, classId }
    setClass: function (classId) { return request(cfg.ENDPOINTS.class, 'POST', { classId: classId }); },

    // POST /api/move { round, moveId, targetId } → { ok }
    submitMove: function (round, moveId, targetId) {
      return request(cfg.ENDPOINTS.move, 'POST', { round: round, moveId: moveId, targetId: targetId });
    },

    // GET /api/state → snapshot (see contract). Used as poll fallback.
    getState: function () { return request(cfg.ENDPOINTS.state, 'GET', null); }
  };
})(window);
