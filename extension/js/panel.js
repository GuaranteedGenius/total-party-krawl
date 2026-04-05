/**
 * panel.js — Boss Battle viewer voting panel.
 *
 * Renders boss action vote buttons, tallies, and a mini game-state summary
 * inside the 318px panel below the stream.
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

  var ACTIONS = ['slash', 'fireball', 'poison', 'heal'];

  /* --------------------------------------------------------------------
     DOM references
     -------------------------------------------------------------------- */
  var dom = {
    status:         document.getElementById('panel-status'),
    bossFill:       document.getElementById('panel-boss-fill'),
    bossHp:         document.getElementById('panel-boss-hp'),
    streamerFill:   document.getElementById('panel-streamer-fill'),
    streamerHp:     document.getElementById('panel-streamer-hp'),
    turnNumber:     document.getElementById('panel-turn'),
    timerFill:      document.getElementById('panel-timer-fill'),
    voteButtons:    document.getElementById('vote-buttons'),
  };

  /* --------------------------------------------------------------------
     State
     -------------------------------------------------------------------- */
  var currentState    = null;
  var votedThisTurn   = false;
  var selectedAction  = null;
  var lastTurnNumber  = -1;
  var timerRaf        = null;

  /* --------------------------------------------------------------------
     Timer
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
     Cast vote
     -------------------------------------------------------------------- */
  function castVote(action) {
    if (votedThisTurn) return;
    if (!currentState || !currentState.match_id) return;

    var channelId = (window.TwitchExt && window.TwitchExt.channelId)
                    || window.BOSS_BATTLE_CHANNEL_ID || '';
    var viewerId  = (window.TwitchExt && window.TwitchExt.userId)
                    || window.BOSS_BATTLE_VIEWER_ID || 'anonymous';

    votedThisTurn  = true;
    selectedAction = action;

    // Optimistic UI
    highlightSelected(action);

    fetch(CONFIG.API_BASE + '/api/game/vote', {
      method: 'POST',
      headers: window.TwitchExt ? window.TwitchExt.getApiHeaders() : { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        match_id:   currentState.match_id,
        channel_id: channelId,
        action:     action,
        viewer_id:  viewerId,
      }),
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      console.log('[panel] vote response', data);
    })
    .catch(function (err) {
      console.warn('[panel] vote failed', err);
    });
  }

  /* --------------------------------------------------------------------
     Button interaction
     -------------------------------------------------------------------- */
  dom.voteButtons.addEventListener('click', function (e) {
    var btn = e.target.closest('.vote-btn');
    if (!btn) return;
    if (btn.classList.contains('cooldown')) return;
    var action = btn.getAttribute('data-action');
    if (action) castVote(action);
  });

  function highlightSelected(action) {
    var btns = dom.voteButtons.querySelectorAll('.vote-btn');
    for (var i = 0; i < btns.length; i++) {
      var a = btns[i].getAttribute('data-action');
      btns[i].classList.toggle('selected', a === action);
    }
  }

  /* --------------------------------------------------------------------
     Render
     -------------------------------------------------------------------- */
  function renderPanel(state) {
    if (!state) return;
    currentState = state;

    // Reset voted flag on new turn
    var turn = state.turn_number || 0;
    if (turn !== lastTurnNumber) {
      votedThisTurn  = false;
      selectedAction = null;
      lastTurnNumber = turn;
    }

    dom.turnNumber.textContent = 'Turn ' + turn;

    // Status text
    if (state.phase === 'game_over') {
      dom.status.textContent = 'Game Over!';
    } else if (state.phase === 'resolving') {
      dom.status.textContent = 'Resolving turn...';
    } else if (state.phase === 'voting' || state.phase === 'active') {
      dom.status.textContent = votedThisTurn ? 'Vote locked in!' : 'Vote now!';
    } else {
      dom.status.textContent = 'Waiting for game...';
    }

    // Health bars
    var boss     = state.boss || {};
    var streamer = state.streamer || {};
    var bHp = boss.hp != null ? boss.hp : 0;
    var bMax = boss.max_hp != null ? boss.max_hp : 1;
    var sHp = streamer.hp != null ? streamer.hp : 0;
    var sMax = streamer.max_hp != null ? streamer.max_hp : 1;

    dom.bossFill.style.width     = (bHp / bMax * 100) + '%';
    dom.bossHp.textContent       = bHp + '/' + bMax;
    dom.streamerFill.style.width = (sHp / sMax * 100) + '%';
    dom.streamerHp.textContent   = sHp + '/' + sMax;

    // Vote counts & cooldowns
    var votes     = state.votes || {};
    var cooldowns = (state.boss && state.boss.cooldowns) || {};
    var totalVotes = 0;
    for (var i = 0; i < ACTIONS.length; i++) {
      totalVotes += (votes[ACTIONS[i]] || 0);
    }

    var btns = dom.voteButtons.querySelectorAll('.vote-btn');
    for (var j = 0; j < btns.length; j++) {
      var action = btns[j].getAttribute('data-action');
      var count  = votes[action] || 0;
      var cd     = cooldowns[action] || 0;

      // Vote count badge
      var badge = btns[j].querySelector('.vote-count');
      if (badge) badge.textContent = count;

      // Cooldown
      if (cd > 0) {
        btns[j].classList.add('cooldown');
        btns[j].setAttribute('data-cooldown', cd + ' turns');
      } else {
        btns[j].classList.remove('cooldown');
        btns[j].removeAttribute('data-cooldown');
      }

      // Re-apply selection highlight
      if (votedThisTurn && selectedAction) {
        btns[j].classList.toggle('selected', action === selectedAction);
      } else {
        btns[j].classList.remove('selected');
      }
    }

    // Tally bars
    for (var k = 0; k < ACTIONS.length; k++) {
      var a   = ACTIONS[k];
      var cnt = votes[a] || 0;
      var pct = totalVotes > 0 ? (cnt / totalVotes * 100) : 0;
      var fillEl  = document.getElementById('tally-' + a);
      var countEl = document.getElementById('tally-' + a + '-count');
      if (fillEl)  fillEl.style.width  = pct + '%';
      if (countEl) countEl.textContent  = cnt;
    }
  }

  /* --------------------------------------------------------------------
     Init
     -------------------------------------------------------------------- */
  function init() {
    var channelId = (window.TwitchExt && window.TwitchExt.channelId)
                    || window.BOSS_BATTLE_CHANNEL_ID
                    || null;

    if (CONFIG.SUPABASE_URL && CONFIG.SUPABASE_PUBLISHABLE_KEY && window.GameSync) {
      window.GameSync.init(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);
      if (channelId) {
        window.GameSync.subscribe(channelId, function (payload) {
          renderPanel(payload);
        });
      }
    }

    // Fetch initial state
    if (channelId) {
      fetch(CONFIG.API_BASE + '/api/game/state?channel_id=' + encodeURIComponent(channelId), {
        headers: window.TwitchExt ? window.TwitchExt.getApiHeaders() : {}
      })
        .then(function (res) { return res.json(); })
        .then(function (data) { renderPanel(data); })
        .catch(function (err) { console.warn('[panel] initial state fetch failed', err); });
    }

    startTimerLoop();
    console.log('[panel] initialised, channelId=' + channelId);
  }

  // Expose for test harness
  window.panelRenderPanel = renderPanel;
  window.panelCastVote    = castVote;

  if (window.TwitchExt) {
    window.TwitchExt.init(function () { init(); });
    setTimeout(function () { if (!currentState) init(); }, 500);
  } else {
    setTimeout(init, 100);
  }
})();
