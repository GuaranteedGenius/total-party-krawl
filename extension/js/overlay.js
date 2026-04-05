/**
 * overlay.js — Boss Battle video overlay logic.
 *
 * Renders game state (health bars, turn timer, attack effects, event log,
 * game-over banners) on the transparent overlay that sits above the stream.
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

  /* --------------------------------------------------------------------
     DOM references
     -------------------------------------------------------------------- */
  var dom = {
    bossName:       document.getElementById('boss-name'),
    bossHpFill:     document.getElementById('boss-hp-fill'),
    bossHpText:     document.getElementById('boss-hp-text'),
    streamerHpFill: document.getElementById('streamer-hp-fill'),
    streamerHpText: document.getElementById('streamer-hp-text'),
    turnNumber:     document.getElementById('turn-number'),
    timerFill:      document.getElementById('timer-fill'),
    effectsArea:    document.getElementById('effects-area'),
    turnLog:        document.getElementById('turn-log'),
    bannerVictory:  document.getElementById('banner-victory'),
    bannerDefeat:   document.getElementById('banner-defeat'),
  };

  /* --------------------------------------------------------------------
     State tracking
     -------------------------------------------------------------------- */
  var currentState    = null;
  var lastTurnNumber  = -1;
  var timerRaf        = null;

  /* --------------------------------------------------------------------
     Timer — smooth countdown using requestAnimationFrame
     -------------------------------------------------------------------- */
  function startTimerLoop() {
    if (timerRaf) cancelAnimationFrame(timerRaf);

    function tick() {
      if (currentState && currentState.turn_deadline) {
        var now       = Date.now();
        var deadline  = new Date(currentState.turn_deadline).getTime();
        var turnStart = currentState.turn_started_at
                          ? new Date(currentState.turn_started_at).getTime()
                          : deadline - 15000;
        var total     = deadline - turnStart;
        var remaining = Math.max(0, deadline - now);
        var pct       = total > 0 ? (remaining / total) * 100 : 0;

        dom.timerFill.style.width = pct + '%';

        // Color classes
        dom.timerFill.classList.remove('warning', 'critical');
        if (pct < 20) {
          dom.timerFill.classList.add('critical');
        } else if (pct < 50) {
          dom.timerFill.classList.add('warning');
        }
      }
      timerRaf = requestAnimationFrame(tick);
    }

    timerRaf = requestAnimationFrame(tick);
  }

  /* --------------------------------------------------------------------
     Attack effects
     -------------------------------------------------------------------- */
  var EFFECT_MAP = {
    slash:      'effect-slash',
    fireball:   'effect-fireball',
    poison:     'effect-poison',
    heal:       'effect-heal',
    shield:     'effect-shield',
    strike:     'effect-slash',
    heavy_blow: 'effect-fireball',
    potion:     'effect-heal',
  };

  function playEffect(actionName) {
    var cls = EFFECT_MAP[actionName];
    if (!cls) return;

    var el = document.createElement('div');
    el.className = cls;
    dom.effectsArea.appendChild(el);

    el.addEventListener('animationend', function () {
      el.remove();
    });

    // Safety cleanup
    setTimeout(function () {
      if (el.parentNode) el.remove();
    }, 2000);
  }

  /* --------------------------------------------------------------------
     Turn log
     -------------------------------------------------------------------- */
  function addLogEntry(text, isOld) {
    var entry = document.createElement('div');
    entry.className = 'turn-log-entry' + (isOld ? ' old' : '');
    entry.textContent = text;
    dom.turnLog.prepend(entry);

    // Keep only last 3
    while (dom.turnLog.children.length > 3) {
      dom.turnLog.removeChild(dom.turnLog.lastChild);
    }
  }

  /* --------------------------------------------------------------------
     Render game state
     -------------------------------------------------------------------- */
  function renderGameState(state) {
    if (!state) return;
    currentState = state;

    // --- Boss health ---
    var boss = state.boss || {};
    var bossHp    = boss.hp    != null ? boss.hp    : 0;
    var bossMaxHp = boss.max_hp != null ? boss.max_hp : 1;
    var bossName  = state.boss_name || 'Chat Boss';
    var bossPct   = (bossHp / bossMaxHp) * 100;

    dom.bossName.textContent  = bossName + ' \u2014 ' + bossHp + '/' + bossMaxHp;
    dom.bossHpFill.style.width = bossPct + '%';
    dom.bossHpText.textContent = bossHp + ' / ' + bossMaxHp;

    if (bossPct < 25) {
      dom.bossHpFill.classList.add('low-hp');
    } else {
      dom.bossHpFill.classList.remove('low-hp');
    }

    // --- Streamer health ---
    var streamer = state.streamer || {};
    var sHp    = streamer.hp    != null ? streamer.hp    : 0;
    var sMaxHp = streamer.max_hp != null ? streamer.max_hp : 1;
    var sPct   = (sHp / sMaxHp) * 100;

    dom.streamerHpFill.style.width = sPct + '%';
    dom.streamerHpText.textContent = sHp + ' / ' + sMaxHp;

    if (sPct < 25) {
      dom.streamerHpFill.classList.add('low-hp');
    } else {
      dom.streamerHpFill.classList.remove('low-hp');
    }

    // --- Turn counter ---
    var turn = state.turn_number || 0;
    dom.turnNumber.textContent = 'Turn ' + turn;

    // --- Turn result events (play effects + log on new turn) ---
    if (state.last_turn_result && turn !== lastTurnNumber) {
      var result = state.last_turn_result;

      // Play effects for actions taken
      if (result.boss_action)     playEffect(result.boss_action);
      if (result.streamer_action) playEffect(result.streamer_action);

      // Build event descriptions
      var events = result.events || [];
      for (var i = 0; i < events.length; i++) {
        addLogEntry(events[i], false);
      }

      // If no structured events, build a summary line
      if (events.length === 0) {
        var line = '';
        if (result.boss_action) {
          line += 'Boss used ' + result.boss_action;
        }
        if (result.streamer_action) {
          line += (line ? ' | ' : '') + 'Streamer used ' + result.streamer_action;
        }
        if (line) addLogEntry(line, false);
      }
    }
    lastTurnNumber = turn;

    // --- Game over ---
    dom.bannerVictory.classList.add('hidden');
    dom.bannerDefeat.classList.add('hidden');

    if (state.phase === 'game_over') {
      // winner can be 'streamer' or 'boss'
      if (state.winner === 'streamer') {
        dom.bannerVictory.classList.remove('hidden');
        dom.bannerVictory.textContent = 'Victory! Streamer wins!';
      } else {
        dom.bannerDefeat.classList.remove('hidden');
        dom.bannerDefeat.textContent = 'Defeat! Boss wins!';
      }
    }
  }

  /* --------------------------------------------------------------------
     Initialisation
     -------------------------------------------------------------------- */
  function init() {
    var channelId = (window.TwitchExt && window.TwitchExt.channelId)
                    || window.BOSS_BATTLE_CHANNEL_ID
                    || null;

    // Init Supabase & subscribe
    if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_PUBLISHABLE_KEY && window.GameSync) {
      window.GameSync.init(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);
      if (channelId) {
        window.GameSync.subscribe(channelId, function (payload) {
          renderGameState(payload);
        });
      }
    }

    // Also poll for initial state
    if (channelId) {
      fetch(CONFIG.API_BASE + '/api/game/state?channel_id=' + encodeURIComponent(channelId), {
        headers: window.TwitchExt ? window.TwitchExt.getApiHeaders() : {}
      })
        .then(function (res) { return res.json(); })
        .then(function (data) { renderGameState(data); })
        .catch(function (err) { console.warn('[overlay] initial state fetch failed', err); });
    }

    startTimerLoop();
    console.log('[overlay] initialised, channelId=' + channelId);
  }

  // Expose renderGameState for the test harness
  window.overlayRenderGameState = renderGameState;

  // Boot
  if (window.TwitchExt) {
    window.TwitchExt.init(function () {
      init();
    });
    // If TwitchExt.init doesn't call back (test mode), still init
    setTimeout(function () {
      if (!currentState) init();
    }, 500);
  } else {
    // No TwitchExt at all yet — wait briefly then init
    setTimeout(init, 100);
  }
})();
