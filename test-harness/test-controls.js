/**
 * Test Controls — dashboard logic for the Boss Battle test harness.
 *
 * Drives the bottom-right control panel: game lifecycle, vote simulation,
 * bits transactions, game-state inspector, and console log capture.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  var API_BASE = 'http://localhost:3000';

  /** Read Supabase config from localStorage or leave blank. */
  var SUPABASE_URL      = localStorage.getItem('bb_supabase_url') || '';
  var SUPABASE_PUBLISHABLE_KEY = localStorage.getItem('bb_supabase_key') || '';

  // Expose on parent window so iframes can pick it up.
  window.BOSS_BATTLE_CONFIG = {
    API_BASE: API_BASE,
    SUPABASE_URL: SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: SUPABASE_PUBLISHABLE_KEY
  };

  // ---------------------------------------------------------------------------
  // JWT helpers (delegates to MockTwitch)
  // ---------------------------------------------------------------------------

  function createBroadcasterJWT() {
    return window.MockTwitch.createMockJWT({
      exp: Math.floor(Date.now() / 1000) + 3600,
      opaque_user_id: 'Umock-broadcaster',
      user_id: 'mock-broadcaster-001',
      channel_id: window.MockTwitch.getChannel(),
      role: 'broadcaster',
      pubsub_perms: { listen: ['broadcast'], send: ['broadcast'] }
    });
  }

  function createViewerJWT(viewerId) {
    return window.MockTwitch.createMockJWT({
      exp: Math.floor(Date.now() / 1000) + 3600,
      opaque_user_id: 'U' + (viewerId || 'viewer-anon'),
      user_id: viewerId || 'mock-viewer-001',
      channel_id: window.MockTwitch.getChannel(),
      role: 'viewer',
      pubsub_perms: { listen: ['broadcast'], send: ['broadcast'] }
    });
  }

  // ---------------------------------------------------------------------------
  // API helper
  // ---------------------------------------------------------------------------

  function apiCall(method, path, body, token) {
    var url = API_BASE + path;
    var opts = {
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    if (token) {
      opts.headers['Authorization'] = 'Bearer ' + token;
    }
    if (body) {
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts)
      .then(function (res) {
        return res.json().then(function (data) {
          return { status: res.status, data: data };
        });
      })
      .catch(function (err) {
        console.error('[TestControls] API error:', err);
        return { status: 0, data: { error: err.message } };
      });
  }

  // ---------------------------------------------------------------------------
  // Active game state tracker
  // ---------------------------------------------------------------------------

  var _lastGameState = null;

  function getActiveMatchId() {
    return _lastGameState ? _lastGameState.match_id : '';
  }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------

  function $(id) { return document.getElementById(id); }

  function appendLog(level, text, source) {
    var container = $('tc-console-log');
    if (!container) return;

    var entry = document.createElement('div');
    entry.className = 'tc-log-entry tc-log-' + level;

    var ts = document.createElement('span');
    ts.className = 'tc-log-ts';
    ts.textContent = new Date().toLocaleTimeString();

    var src = document.createElement('span');
    src.className = 'tc-log-src';
    src.textContent = source || 'harness';

    var msg = document.createElement('span');
    msg.className = 'tc-log-msg';
    msg.textContent = text;

    entry.appendChild(ts);
    entry.appendChild(src);
    entry.appendChild(msg);
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;

    // Cap at 500 entries
    while (container.children.length > 500) {
      container.removeChild(container.firstChild);
    }
  }

  // ---------------------------------------------------------------------------
  // Syntax-highlighted JSON
  // ---------------------------------------------------------------------------

  function syntaxHighlight(json) {
    if (typeof json !== 'string') json = JSON.stringify(json, null, 2);
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return json.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      function (match) {
        var cls = 'tc-json-number';
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? 'tc-json-key' : 'tc-json-string';
        } else if (/true|false/.test(match)) {
          cls = 'tc-json-bool';
        } else if (/null/.test(match)) {
          cls = 'tc-json-null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Console capture listener (messages from iframes)
  // ---------------------------------------------------------------------------

  window.addEventListener('message', function (event) {
    if (!event.data || event.data.type !== 'console-capture') return;
    var d = event.data;
    appendLog(d.level, d.args.join(' '), d.source);
  });

  // ---------------------------------------------------------------------------
  // Game state polling
  // ---------------------------------------------------------------------------

  var _pollTimer = null;

  function startPolling() {
    stopPolling();
    fetchGameState();
    _pollTimer = setInterval(fetchGameState, 2000);
  }

  function stopPolling() {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  }

  function fetchGameState() {
    apiCall('GET', '/api/game/state?channel_id=' + encodeURIComponent(window.MockTwitch.getChannel()), null, createBroadcasterJWT())
      .then(function (res) {
        var pre = $('tc-game-state-json');
        if (pre) {
          pre.innerHTML = syntaxHighlight(res.data);
        }
        if (res.data && !res.data.error) _lastGameState = res.data;
        updateGameSummary(res.data);
      });
  }

  function updateGameSummary(data) {
    var el = $('tc-game-summary');
    if (!el) return;
    if (!data || data.error) {
      el.textContent = data ? data.error : 'No data';
      return;
    }
    var parts = [];
    if (data.phase)       parts.push('Phase: ' + data.phase);
    if (data.turn_number != null) parts.push('Turn: ' + data.turn_number);
    if (data.boss && data.boss.hp != null) parts.push('Boss HP: ' + data.boss.hp + '/' + data.boss.max_hp);
    if (data.streamer && data.streamer.hp != null) parts.push('Streamer HP: ' + data.streamer.hp + '/' + data.streamer.max_hp);
    el.textContent = parts.join(' | ') || 'Waiting for game data...';
  }

  // ---------------------------------------------------------------------------
  // Initialization — called after DOM is ready
  // ---------------------------------------------------------------------------

  function init() {
    // ---- Supabase config inputs ----
    var urlInput = $('tc-supabase-url');
    var keyInput = $('tc-supabase-key');
    if (urlInput) urlInput.value = SUPABASE_URL;
    if (keyInput) keyInput.value = SUPABASE_PUBLISHABLE_KEY;

    var connectBtn = $('tc-supabase-connect');
    if (connectBtn) {
      connectBtn.addEventListener('click', function () {
        SUPABASE_URL = urlInput.value.trim();
        SUPABASE_PUBLISHABLE_KEY = keyInput.value.trim();
        localStorage.setItem('bb_supabase_url', SUPABASE_URL);
        localStorage.setItem('bb_supabase_key', SUPABASE_PUBLISHABLE_KEY);
        window.BOSS_BATTLE_CONFIG.SUPABASE_URL = SUPABASE_URL;
        window.BOSS_BATTLE_CONFIG.SUPABASE_PUBLISHABLE_KEY = SUPABASE_PUBLISHABLE_KEY;
        appendLog('log', 'Supabase config saved.', 'harness');
      });
    }

    // ---- Game Controls ----
    $('tc-start-game').addEventListener('click', function () {
      appendLog('log', 'Starting new game...', 'harness');
      apiCall('POST', '/api/game/start', { channel_id: window.MockTwitch.getChannel() }, createBroadcasterJWT())
        .then(function (res) {
          appendLog('log', 'Start game response: ' + JSON.stringify(res.data), 'harness');
          fetchGameState();
        });
    });

    $('tc-resolve-turn').addEventListener('click', function () {
      appendLog('log', 'Force-resolving turn...', 'harness');
      apiCall('POST', '/api/game/resolve', { channel_id: window.MockTwitch.getChannel() }, createBroadcasterJWT())
        .then(function (res) {
          appendLog('log', 'Resolve response: ' + JSON.stringify(res.data), 'harness');
          fetchGameState();
        });
    });

    // ---- Chat Vote Simulator ----
    var voteButtons = document.querySelectorAll('[data-vote]');
    voteButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action   = btn.getAttribute('data-vote');
        var countEl  = $('tc-vote-count');
        var count    = parseInt(countEl ? countEl.value : '1', 10) || 1;

        appendLog('log', 'Casting ' + count + ' vote(s) for ' + action, 'harness');

        var promises = [];
        for (var i = 0; i < count; i++) {
          var viewerId = 'sim-viewer-' + Date.now() + '-' + i;
          promises.push(
            apiCall('POST', '/api/game/vote', {
              channel_id: window.MockTwitch.getChannel(),
              match_id: getActiveMatchId(),
              action: action,
              viewer_id: viewerId
            }, createViewerJWT(viewerId))
          );
        }

        Promise.all(promises).then(function (results) {
          var ok = results.filter(function (r) { return r.status >= 200 && r.status < 300; }).length;
          var failed = results.filter(function (r) { return r.status < 200 || r.status >= 300; });
          if (failed.length > 0) {
            appendLog('error', 'Vote error: ' + JSON.stringify(failed[0].data) + ' (status ' + failed[0].status + ')', 'harness');
          }
          appendLog('log', ok + '/' + count + ' votes accepted for ' + action, 'harness');
          fetchGameState();
        });
      });
    });

    // ---- Bits Transaction Simulator ----
    $('tc-bits-ultimate').addEventListener('click', function () {
      appendLog('log', 'Simulating Ultimate Strike (100 bits)...', 'harness');
      var product = { sku: 'ultimate_strike', displayName: 'Ultimate Strike' };

      apiCall('POST', '/api/bits/transaction', {
        channel_id: window.MockTwitch.getChannel(),
        match_id: getActiveMatchId(),
        product: product.sku,
        transaction_id: 'mock-tx-' + Date.now(),
        bits_amount: 100,
        viewer_id: window.MockTwitch.getUser()
      }, createViewerJWT(window.MockTwitch.getUser()))
        .then(function (res) {
          appendLog('log', 'Bits API response: ' + JSON.stringify(res.data), 'harness');
        });

      // Also trigger on iframes
      triggerBitsOnIframes(product, 100);
    });

    $('tc-bits-heal').addEventListener('click', function () {
      appendLog('log', 'Simulating Full Heal (500 bits)...', 'harness');
      var product = { sku: 'full_heal', displayName: 'Full Heal' };

      apiCall('POST', '/api/bits/transaction', {
        channel_id: window.MockTwitch.getChannel(),
        match_id: getActiveMatchId(),
        product: product.sku,
        transaction_id: 'mock-tx-' + Date.now(),
        bits_amount: 500,
        viewer_id: window.MockTwitch.getUser()
      }, createViewerJWT(window.MockTwitch.getUser()))
        .then(function (res) {
          appendLog('log', 'Bits API response: ' + JSON.stringify(res.data), 'harness');
        });

      triggerBitsOnIframes(product, 500);
    });

    // ---- Viewer count slider ----
    var slider = $('tc-viewer-slider');
    var sliderVal = $('tc-viewer-count');
    if (slider && sliderVal) {
      slider.addEventListener('input', function () {
        sliderVal.textContent = slider.value;
      });
    }

    // ---- Start polling game state ----
    startPolling();

    // ---- Initial log ----
    appendLog('log', 'Test harness initialized. API: ' + API_BASE, 'harness');
    appendLog('log', 'Channel: ' + window.MockTwitch.getChannel() + ' | Role: ' + window.MockTwitch.getRole(), 'harness');
  }

  // ---------------------------------------------------------------------------
  // Trigger bits transaction on iframe MockTwitch instances
  // ---------------------------------------------------------------------------

  function triggerBitsOnIframes(product, bits) {
    var iframes = document.querySelectorAll('iframe');
    iframes.forEach(function (iframe) {
      try {
        if (iframe.contentWindow && iframe.contentWindow.MockTwitch) {
          iframe.contentWindow.MockTwitch.triggerBitsTransaction(product, bits);
        }
      } catch (_) { /* cross-origin will fail, that's ok */ }
    });
  }

  // ---------------------------------------------------------------------------
  // Console log clear
  // ---------------------------------------------------------------------------

  window.clearConsoleLog = function () {
    var container = $('tc-console-log');
    if (container) container.innerHTML = '';
  };

  // ---------------------------------------------------------------------------
  // Kick off
  // ---------------------------------------------------------------------------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
