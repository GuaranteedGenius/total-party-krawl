/**
 * Mock Twitch Extension Helper
 *
 * Drop-in replacement for the real Twitch Extension Helper JS.
 * Must be loaded BEFORE any extension scripts that reference window.Twitch.
 *
 * Configurable via window.MockTwitch.setRole / setChannel / setUser.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Base64url encode (no padding). */
  function base64url(str) {
    return btoa(str)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Build a JWT-shaped token (header.payload.fake-signature).
   * The signature is static — TESTING_MODE skips verification on the backend.
   */
  function createMockJWT(payload) {
    var header = { alg: 'HS256', typ: 'JWT' };
    var headerB64  = base64url(JSON.stringify(header));
    var payloadB64 = base64url(JSON.stringify(payload));
    var sigB64     = base64url('mock-signature-not-verified');
    return headerB64 + '.' + payloadB64 + '.' + sigB64;
  }

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------

  var _role      = 'viewer';
  var _channelId = 'test-channel-001';
  var _userId    = 'mock-viewer-001';
  var _clientId  = 'mock-client-id-000';

  var _onAuthorizedCb       = null;
  var _onContextCb          = null;
  var _onErrorCb            = null;
  var _onTransactionCb      = null;
  var _onVisibilityChangedCb = null;

  /** Derive a sensible default userId for the given role. */
  function defaultUserForRole(role) {
    switch (role) {
      case 'broadcaster': return 'mock-broadcaster-001';
      case 'moderator':   return 'mock-moderator-001';
      default:            return 'mock-viewer-001';
    }
  }

  /** Build the JWT payload for the current state. */
  function buildJWTPayload() {
    return {
      exp: Math.floor(Date.now() / 1000) + 3600,
      opaque_user_id: 'Umock123',
      user_id: _userId,
      channel_id: _channelId,
      role: _role,
      pubsub_perms: { listen: ['broadcast'], send: ['broadcast'] }
    };
  }

  /** Build the auth object passed to onAuthorized callbacks. */
  function buildAuth() {
    return {
      channelId: _channelId,
      clientId:  _clientId,
      token:     createMockJWT(buildJWTPayload()),
      userId:    _userId
    };
  }

  /** Build a fake Twitch context object. */
  function buildContext() {
    return {
      game:        'Boss Battle',
      language:    'en',
      theme:       'dark',
      mode:        'viewer',
      isFullScreen: false,
      isMuted:     false,
      bitrate:     3000,
      bufferSize:  4096,
      displayResolution: '1920x1080',
      hlsLatencyBroadcaster: 2,
      hostingInfo: null,
      playbackMode: 'video',
      videoResolution: '1920x1080'
    };
  }

  // ---------------------------------------------------------------------------
  // Console capture — post messages to parent for the test harness log viewer
  // ---------------------------------------------------------------------------
  (function captureConsole() {
    var origLog  = console.log;
    var origWarn = console.warn;
    var origErr  = console.error;

    function post(level, args) {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            type: 'console-capture',
            level: level,
            args: Array.prototype.slice.call(args).map(function (a) {
              if (typeof a === 'object') {
                try { return JSON.stringify(a); } catch (_) { return String(a); }
              }
              return String(a);
            }),
            source: window.name || document.title || location.pathname,
            timestamp: new Date().toISOString()
          }, '*');
        }
      } catch (_) { /* swallow */ }
    }

    console.log = function () {
      post('log', arguments);
      origLog.apply(console, arguments);
    };
    console.warn = function () {
      post('warn', arguments);
      origWarn.apply(console, arguments);
    };
    console.error = function () {
      post('error', arguments);
      origErr.apply(console, arguments);
    };
  })();

  // ---------------------------------------------------------------------------
  // window.Twitch mock
  // ---------------------------------------------------------------------------

  window.Twitch = {
    ext: {
      onAuthorized: function (callback) {
        _onAuthorizedCb = callback;
        // Fire immediately (Twitch does this too).
        setTimeout(function () {
          if (typeof callback === 'function') callback(buildAuth());
        }, 0);
      },

      onContext: function (callback) {
        _onContextCb = callback;
        setTimeout(function () {
          if (typeof callback === 'function') callback(buildContext(), Object.keys(buildContext()));
        }, 0);
      },

      onError: function (callback) {
        _onErrorCb = callback;
      },

      bits: {
        onTransactionComplete: function (callback) {
          _onTransactionCb = callback;
        },

        useBits: function (sku) {
          console.log('[MockTwitch] useBits called with SKU:', sku);
          // Simulate purchase dialog; auto-complete after 1 second.
          setTimeout(function () {
            if (typeof _onTransactionCb === 'function') {
              _onTransactionCb({
                transactionId: 'mock-tx-' + Date.now(),
                product: {
                  sku: sku,
                  displayName: sku,
                  cost: { amount: 100, type: 'bits' }
                },
                userId: _userId,
                transactionReceipt: 'mock-receipt-' + Date.now()
              });
            }
          }, 1000);
        },

        getProducts: function () {
          return Promise.resolve([
            {
              sku: 'ultimate_strike',
              displayName: 'Ultimate Strike',
              cost: { amount: 100, type: 'bits' },
              inDevelopment: true
            },
            {
              sku: 'full_heal',
              displayName: 'Full Heal',
              cost: { amount: 500, type: 'bits' },
              inDevelopment: true
            }
          ]);
        },

        setUseLoopback: function () { /* no-op */ }
      },

      actions: {
        requestIdShare: function () { /* no-op */ },
        onVisibilityChanged: function (callback) {
          _onVisibilityChangedCb = callback;
          setTimeout(function () {
            if (typeof callback === 'function') callback(true, 'visible');
          }, 0);
        }
      },

      features: {
        onChanged: function () { /* no-op */ }
      },

      viewer: {
        sessionToken: createMockJWT(buildJWTPayload()),
        id: _userId,
        role: _role,
        isLinked: true
      }
    }
  };

  // ---------------------------------------------------------------------------
  // window.MockTwitch — control API for the test harness
  // ---------------------------------------------------------------------------

  window.MockTwitch = {
    /** Expose JWT creation so test-controls can generate tokens too. */
    createMockJWT: createMockJWT,

    /**
     * Change the active role and re-derive userId if it was still the default.
     * Call reauthorize() afterwards to push the new auth to listeners.
     */
    setRole: function (role) {
      var oldDefault = defaultUserForRole(_role);
      _role = role;
      // If the user ID was the auto-default for the old role, update it.
      if (_userId === oldDefault) {
        _userId = defaultUserForRole(role);
      }
      window.Twitch.ext.viewer.role = role;
      window.Twitch.ext.viewer.id   = _userId;
      console.log('[MockTwitch] Role set to', role, '— userId is now', _userId);
    },

    setChannel: function (channelId) {
      _channelId = channelId;
      console.log('[MockTwitch] Channel set to', channelId);
    },

    setUser: function (userId) {
      _userId = userId;
      window.Twitch.ext.viewer.id = userId;
      console.log('[MockTwitch] User set to', userId);
    },

    /** Fire the onAuthorized callback again with the current state. */
    reauthorize: function () {
      window.Twitch.ext.viewer.sessionToken = createMockJWT(buildJWTPayload());
      if (typeof _onAuthorizedCb === 'function') {
        _onAuthorizedCb(buildAuth());
      }
    },

    /**
     * Simulate a Bits transaction completing.
     * @param {{ sku: string, displayName: string }} product
     * @param {number} bits
     */
    triggerBitsTransaction: function (product, bits) {
      var tx = {
        transactionId: 'mock-tx-' + Date.now(),
        product: {
          sku: product.sku || product,
          displayName: product.displayName || product.sku || product,
          cost: { amount: bits || 100, type: 'bits' }
        },
        userId: _userId,
        transactionReceipt: 'mock-receipt-' + Date.now()
      };
      console.log('[MockTwitch] Triggering bits transaction:', tx);
      if (typeof _onTransactionCb === 'function') {
        _onTransactionCb(tx);
      }
    },

    /** Convenience getters */
    getRole:    function () { return _role; },
    getChannel: function () { return _channelId; },
    getUser:    function () { return _userId; },
    getAuth:    buildAuth
  };

  console.log('[MockTwitch] Mock Twitch Extension Helper loaded. Role:', _role, '| Channel:', _channelId, '| User:', _userId);
})();
