/**
 * live_config.js — Boss Battle streamer live dashboard.
 *
 * The broadcaster's control panel during a game: start games, pick actions,
 * view chat vote tallies, force-resolve turns, and see results.
 */
(function () {
  'use strict';

  /* --------------------------------------------------------------------
     Configuration
     -------------------------------------------------------------------- */
  var CONFIG = {
    API_BASE:          window.BOSS_BATTLE_API_BASE        || 'http://localhost:3000',
    SUPABASE_URL:      window.BOSS_BATTLE_SUPABASE_URL    || '',
    SUPABASE_PUBLISHABLE_KEY: window.BOSS_BATTLE_SUPABASE_PUBLISHABLE_KEY || '',
  };

  var BOSS_ACTIONS = ['slash', 'fireball', 'poison', 'heal'];

  /* --------------------------------------------------------------------
     DOM references
     -------------------------------------------------------------------- */
  var dom = {
    turn:           document.getElementById('lc-turn'),
    phase:          document.getElementById('lc-phase'),
    hpSummary:      document.getElementById('lc-hp-summary'),
    btnStart:       document.getElementById('btn-start'),
    startCard:      document.getElementById('start-card'),
    actionCard:     document.getElementById('action-card'),
    streamerActions:document.getElementById('streamer-actions'),
    actionStatus:   document.getElementById('action-status'),
    btnResolve:     document.getElementById('btn-resolve'),
    lastResult:     document.getElementById('lc-last-result'),
    gameoverCard:   document.getElementById('gameover-card'),
    gameoverText:   document.getElementById('lc-gameover-text'),
  };

  /* --------------------------------------------------------------------
     State
     -------------------------------------------------------------------- */
  var currentState   = null;
  var lockedAction   = null;
  var lastTurnNumber = -1;

  /* --------------------------------------------------------------------
     API helpers
     -------------------------------------------------------------------- */
  function getChannelId() {
    return (window.TwitchExt && window.TwitchExt.channelId)
           || window.BOSS_BATTLE_CHANNEL_ID
           || '';
  }

  function getBossName() {
    try {
      var raw = localStorage.getItem('boss_battle_config');
      if (raw) {
        var cfg = JSON.parse(raw);
        if (cfg.boss_name) return cfg.boss_name;
      }
    } catch (_) {}
    return 'Chat Boss';
  }

  function apiPost(path, body) {
    return fetch(CONFIG.API_BASE + path, {
      method: 'POST',
      headers: window.TwitchExt ? window.TwitchExt.getApiHeaders() : { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (res) { return res.json(); });
  }

  /* --------------------------------------------------------------------
     Game actions
     -------------------------------------------------------------------- */
  function startGame() {
    dom.btnStart.disabled = true;
    dom.btnStart.textContent = 'Starting...';

    apiPost('/api/game/start', {
      channel_id: getChannelId(),
      boss_name:  getBossName(),
    })
    .then(function (data) {
      console.log('[live_config] game started', data);
      if (data) renderDashboard(data.state || data);
    })
    .catch(function (err) {
      console.error('[live_config] start failed', err);
    })
    .finally(function () {
      dom.btnStart.disabled = false;
      dom.btnStart.textContent = 'Start New Game';
    });
  }

  function pickAction(action) {
    if (lockedAction) return;
    lockedAction = action;
    highlightAction(action);
    dom.actionStatus.textContent = 'Locked in: ' + action;

    apiPost('/api/game/action', {
      channel_id: getChannelId(),
      match_id:   currentState ? currentState.match_id : '',
      action:     action,
    })
    .then(function (data) {
      console.log('[live_config] action response', data);
    })
    .catch(function (err) {
      console.error('[live_config] action failed', err);
      // Allow retry on network error
      lockedAction = null;
      dom.actionStatus.textContent = 'Failed — try again.';
    });
  }

  function forceResolve() {
    dom.btnResolve.disabled = true;
    dom.btnResolve.textContent = 'Resolving...';

    apiPost('/api/game/resolve', {
      channel_id: getChannelId(),
      match_id:   currentState ? currentState.match_id : '',
    })
    .then(function (data) {
      console.log('[live_config] resolve response', data);
      if (data) renderDashboard(data.state || data);
    })
    .catch(function (err) {
      console.error('[live_config] resolve failed', err);
    })
    .finally(function () {
      dom.btnResolve.disabled = false;
      dom.btnResolve.textContent = 'Force Resolve Turn';
    });
  }

  /* --------------------------------------------------------------------
     UI helpers
     -------------------------------------------------------------------- */
  function highlightAction(action) {
    var btns = dom.streamerActions.querySelectorAll('.vote-btn');
    for (var i = 0; i < btns.length; i++) {
      var a = btns[i].getAttribute('data-action');
      btns[i].classList.toggle('selected', a === action);
    }
  }

  /* --------------------------------------------------------------------
     Render dashboard
     -------------------------------------------------------------------- */
  function renderDashboard(state) {
    if (!state) return;
    currentState = state;

    var turn = state.turn_number || 0;

    // Reset lock on new turn
    if (turn !== lastTurnNumber) {
      lockedAction = null;
      dom.actionStatus.textContent = '';
      // Clear selection highlights
      var btns = dom.streamerActions.querySelectorAll('.vote-btn');
      for (var b = 0; b < btns.length; b++) {
        btns[b].classList.remove('selected');
      }
      lastTurnNumber = turn;
    }

    // Turn & phase
    dom.turn.textContent  = 'Turn ' + turn;
    dom.phase.textContent = state.phase || 'unknown';

    // HP summary
    var boss     = state.boss || {};
    var streamer = state.streamer || {};
    dom.hpSummary.textContent =
      'Boss: ' + (boss.hp != null ? boss.hp : '--') + '/' + (boss.max_hp != null ? boss.max_hp : '--') +
      ' | Streamer: ' + (streamer.hp != null ? streamer.hp : '--') + '/' + (streamer.max_hp != null ? streamer.max_hp : '--');

    // Show/hide start card vs action card
    var gameActive = state.phase && state.phase !== 'game_over' && state.phase !== 'idle';
    dom.startCard.classList.toggle('hidden', gameActive);
    dom.actionCard.classList.toggle('hidden', !gameActive);

    // Streamer action cooldowns
    var cooldowns = (state.streamer && state.streamer.cooldowns) || {};
    var actionBtns = dom.streamerActions.querySelectorAll('.vote-btn');
    for (var i = 0; i < actionBtns.length; i++) {
      var action = actionBtns[i].getAttribute('data-action');
      var cd     = cooldowns[action] || 0;
      if (cd > 0) {
        actionBtns[i].classList.add('cooldown');
        actionBtns[i].setAttribute('data-cooldown', cd + ' turns');
      } else {
        actionBtns[i].classList.remove('cooldown');
        actionBtns[i].removeAttribute('data-cooldown');
      }
    }

    // Chat vote preview
    var votes      = state.votes || {};
    var totalVotes = 0;
    for (var j = 0; j < BOSS_ACTIONS.length; j++) {
      totalVotes += (votes[BOSS_ACTIONS[j]] || 0);
    }
    for (var k = 0; k < BOSS_ACTIONS.length; k++) {
      var a   = BOSS_ACTIONS[k];
      var cnt = votes[a] || 0;
      var pct = totalVotes > 0 ? (cnt / totalVotes * 100) : 0;
      var fillEl  = document.getElementById('lc-tally-' + a);
      var countEl = document.getElementById('lc-tally-' + a + '-count');
      if (fillEl)  fillEl.style.width  = pct + '%';
      if (countEl) countEl.textContent  = cnt;
    }

    // Last turn result
    if (state.last_turn_result) {
      var r = state.last_turn_result;
      var lines = [];
      if (r.boss_action)     lines.push('Boss used ' + r.boss_action);
      if (r.streamer_action) lines.push('Streamer used ' + r.streamer_action);
      if (r.events) {
        for (var e = 0; e < r.events.length; e++) {
          lines.push(r.events[e]);
        }
      }
      dom.lastResult.textContent = lines.join(' | ') || 'No results yet.';
    }

    // Game over
    dom.gameoverCard.classList.add('hidden');
    if (state.phase === 'game_over') {
      dom.gameoverCard.classList.remove('hidden');
      dom.startCard.classList.remove('hidden');
      if (state.winner === 'streamer') {
        dom.gameoverText.textContent = 'Victory! Streamer wins!';
        dom.gameoverText.style.color = 'var(--gold)';
      } else {
        dom.gameoverText.textContent = 'Defeat! Boss wins!';
        dom.gameoverText.style.color = 'var(--boss-red)';
      }
    }
  }

  /* --------------------------------------------------------------------
     Events
     -------------------------------------------------------------------- */
  dom.btnStart.addEventListener('click', startGame);
  dom.btnResolve.addEventListener('click', forceResolve);

  dom.streamerActions.addEventListener('click', function (e) {
    var btn = e.target.closest('.vote-btn');
    if (!btn) return;
    if (btn.classList.contains('cooldown')) return;
    var action = btn.getAttribute('data-action');
    if (action) pickAction(action);
  });

  /* --------------------------------------------------------------------
     Init
     -------------------------------------------------------------------- */
  function init() {
    var channelId = getChannelId();

    if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_PUBLISHABLE_KEY && window.GameSync) {
      window.GameSync.init(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);
      if (channelId) {
        window.GameSync.subscribe(channelId, function (payload) {
          renderDashboard(payload);
        });
      }
    }

    // Fetch initial state
    if (channelId) {
      fetch(CONFIG.API_BASE + '/api/game/state?channel_id=' + encodeURIComponent(channelId), {
        headers: window.TwitchExt ? window.TwitchExt.getApiHeaders() : {}
      })
        .then(function (res) { return res.json(); })
        .then(function (data) { renderDashboard(data); })
        .catch(function (err) { console.warn('[live_config] initial state fetch failed', err); });
    }

    console.log('[live_config] initialised, channelId=' + channelId);
  }

  // Expose for test harness
  window.liveConfigRenderDashboard = renderDashboard;

  if (window.TwitchExt) {
    window.TwitchExt.init(function () { init(); });
    setTimeout(function () { if (!currentState) init(); }, 500);
  } else {
    setTimeout(init, 100);
  }
})();
