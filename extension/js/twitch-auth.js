/* twitch-auth.js — thin wrapper over the Twitch Extension Helper SDK.
 *
 * Isolates ALL access to window.Twitch.ext so the panel logic stays testable and the
 * dev mock (extension/dev/mock.html) can stub the same surface.
 *
 * Provides:
 *   TPK_AUTH.onReady(cb)          — cb({ token, channelId, opaqueUserId, userId, role })
 *                                   fires on the first authorization and on every refresh.
 *   TPK_AUTH.getAuth()            — latest auth object, or null before first authorize.
 *   TPK_AUTH.onConfiguration(cb)  — cb(parsedBroadcasterConfig) when config arrives.
 *   TPK_AUTH.onContext(cb)        — cb(context) passthrough (theme etc.), optional.
 */
(function (global) {
  'use strict';

  var latestAuth = null;
  var readyCallbacks = [];

  function ext() {
    return (global.Twitch && global.Twitch.ext) ? global.Twitch.ext : null;
  }

  function notifyReady() {
    for (var i = 0; i < readyCallbacks.length; i++) {
      try { readyCallbacks[i](latestAuth); } catch (e) { /* isolate cb errors */ }
    }
  }

  function init() {
    var e = ext();
    if (!e) {
      // No SDK present (e.g. opened as a bare file without the mock). Surface clearly.
      console.warn('[TPK] window.Twitch.ext not found. Use dev/mock.html for local testing.');
      return;
    }

    e.onAuthorized(function (auth) {
      // auth: { channelId, clientId, token, helixToken, userId, opaqueUserId } per Twitch SDK.
      latestAuth = {
        token: auth.token,
        channelId: auth.channelId,
        opaqueUserId: auth.opaqueUserId,
        userId: auth.userId || null,
        clientId: auth.clientId || null,
        // role is not always provided on the panel auth object; default to 'viewer'.
        role: auth.role || 'viewer'
      };
      notifyReady();
    });
  }

  global.TPK_AUTH = {
    onReady: function (cb) {
      readyCallbacks.push(cb);
      if (latestAuth) { try { cb(latestAuth); } catch (e) {} }
    },
    getAuth: function () { return latestAuth; },
    onConfiguration: function (cb) {
      var e = ext();
      if (!e || !e.configuration) return;
      e.configuration.onChanged(function () {
        var seg = e.configuration.broadcaster;
        var parsed = null;
        if (seg && seg.content) {
          try { parsed = JSON.parse(seg.content); } catch (err) { parsed = null; }
        }
        try { cb(parsed); } catch (err) {}
      });
    },
    onContext: function (cb) {
      var e = ext();
      if (!e || !e.onContext) return;
      e.onContext(function (ctx) { try { cb(ctx); } catch (err) {} });
    }
  };

  init();
})(window);
