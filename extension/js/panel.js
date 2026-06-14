/* panel.js — viewer controller logic.
 *
 * Flow (docs/api-contract.md): authorize → join seat → pick class → each round pick a
 * move + target and submit → show own HP/stats + party/boss readout.
 *
 * This is a CONTROLLER. It holds no combat math and no authoritative clock. It mirrors
 * the snapshot the game client publishes and submits the viewer's intent.
 *
 * Depends on: TPK_CONFIG, TPK_CONTENT, TPK_AUTH, TPK_API.
 */
(function (global) {
  'use strict';

  var cfg = global.TPK_CONFIG;
  var content = global.TPK_CONTENT;
  var api = global.TPK_API;

  // ---- Local view state (a mirror, never the source of truth) -----------------------
  var view = {
    authorized: false,
    channelId: null,

    // Our seat. null until we join.
    seatIndex: null,
    classId: null,

    // Latest snapshot from /api/state or a Realtime `state` event.
    matchPhase: 'unknown',   // e.g. waiting | prompt | lockin | resolve | won | lost
    round: 0,
    endsAtEpochMs: null,
    you: null,               // { seatIndex, classId, hp, maxHp, alive, lockedMove }
    boss: null,              // { hp, maxHp, alive }
    seats: [],               // [{ seatIndex, classId, hp, maxHp, alive }]

    // Round-local move selection (cleared when a new prompt arrives).
    selectedMoveId: null,
    selectedTargetId: null,
    submittedForRound: null, // round number we last submitted for

    // Soft timer
    timerEndsAt: null,       // epoch ms the panel counts down to
    timerExpired: false
  };

  var pollTimer = null;
  var tickTimer = null;

  // ---- DOM helpers ------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }
  function setText(id, txt) { var el = $(id); if (el) el.textContent = txt; }
  function spanWith(cls, txt) {
    var s = document.createElement('span');
    s.className = cls;
    s.textContent = txt; // safe: never parses HTML
    return s;
  }

  function setStatus(msg, kind) {
    var el = $('status-line');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' status--' + kind : '');
  }

  // ---- Section visibility -----------------------------------------------------------
  function refreshSections() {
    var joinSection = $('join-section');
    var classSection = $('class-section');
    var playSection = $('play-section');

    if (view.seatIndex === null) {
      show(joinSection); hide(classSection); hide(playSection);
    } else if (!view.classId) {
      hide(joinSection); show(classSection); hide(playSection);
    } else {
      hide(joinSection); hide(classSection); show(playSection);
    }
  }

  // ===================================================================================
  // JOIN
  // ===================================================================================
  function doJoin() {
    setStatus('Joining a seat…');
    var btn = $('join-btn');
    if (btn) btn.disabled = true;
    api.join().then(function (res) {
      view.seatIndex = res.seatIndex;
      view.classId = res.classId || null;
      setStatus(res.alreadySeated ? 'Welcome back — seat ' + res.seatIndex + '.'
                                  : 'Seated at ' + res.seatIndex + '.', 'ok');
      refreshSections();
      renderClassChoices();
      startStateSync();
    }).catch(function (err) {
      setStatus('Could not join: ' + err.message, 'error');
      if (btn) btn.disabled = false;
    });
  }

  // ===================================================================================
  // CLASS PICK
  // ===================================================================================
  function renderClassChoices() {
    var wrap = $('class-choices');
    if (!wrap) return;
    wrap.innerHTML = '';
    content.ORDERED_CLASS_IDS.forEach(function (cid) {
      var c = content.getClass(cid);
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'class-card';
      card.setAttribute('data-class-id', cid);
      if (view.classId === cid) card.classList.add('selected');
      card.innerHTML =
        '<div class="class-card__name">' + c.label + '</div>' +
        '<div class="class-card__role">' + c.role + '</div>' +
        '<div class="class-card__blurb">' + c.blurb + '</div>';
      card.addEventListener('click', function () { pickClass(cid); });
      wrap.appendChild(card);
    });
  }

  function pickClass(classId) {
    setStatus('Setting class…');
    api.setClass(classId).then(function (res) {
      view.classId = res.classId || classId;
      setStatus('Class set: ' + content.getClass(view.classId).label, 'ok');
      renderClassChoices();
      refreshSections();
      renderMoves();
    }).catch(function (err) {
      setStatus('Could not set class: ' + err.message, 'error');
    });
  }

  // ===================================================================================
  // MOVE SELECTION + SUBMIT
  // ===================================================================================
  function isMatchAcceptingMoves() {
    // We submit when there is a live prompt and the timer has not visually expired.
    // The contract has no explicit "lockin" enum value list, so treat any non-terminal
    // phase with a positive round as submittable; the server/client enforce the truth.
    if (view.matchPhase === 'won' || view.matchPhase === 'lost') return false;
    if (view.round <= 0) return false;
    if (view.you && view.you.alive === false) return false;
    return true;
  }

  function renderMoves() {
    var wrap = $('move-list');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!view.classId) return;

    var moves = content.movesForClass(view.classId);
    moves.forEach(function (m) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'move-btn';
      btn.setAttribute('data-move-id', m.id);
      if (view.selectedMoveId === m.id) btn.classList.add('selected');
      var cd = m.cooldown > 0 ? ('<span class="move-btn__cd">CD ' + m.cooldown + '</span>') : '';
      btn.innerHTML =
        '<span class="move-btn__name">' + m.label + '</span>' + cd +
        '<span class="move-btn__blurb">' + m.blurb + '</span>';
      btn.addEventListener('click', function () { selectMove(m.id); });
      wrap.appendChild(btn);
    });

    renderTargets();
    updateSubmitState();
  }

  function selectMove(moveId) {
    view.selectedMoveId = moveId;
    // Reset target; auto-resolve targets that need no choice.
    view.selectedTargetId = null;
    var m = content.getMove(moveId);
    if (m) {
      if (m.target === content.TARGET.SELF) {
        view.selectedTargetId = content.seatTargetId(view.seatIndex);
      } else if (m.target === content.TARGET.ENEMY_ALL || m.target === content.TARGET.ALLY_ALL) {
        view.selectedTargetId = null; // no single target needed
      } else if (m.target === content.TARGET.ENEMY_ONE) {
        view.selectedTargetId = 'boss'; // alpha has exactly one enemy
      }
    }
    renderMoves();
  }

  function renderTargets() {
    var wrap = $('target-list');
    var label = $('target-label');
    if (!wrap) return;
    wrap.innerHTML = '';

    var m = view.selectedMoveId ? content.getMove(view.selectedMoveId) : null;
    if (!m) { if (label) label.textContent = ''; return; }

    if (m.target === content.TARGET.SELF) {
      if (label) label.textContent = 'Targets: yourself';
      return;
    }
    if (m.target === content.TARGET.ENEMY_ALL) {
      if (label) label.textContent = 'Targets: all enemies';
      return;
    }
    if (m.target === content.TARGET.ALLY_ALL) {
      if (label) label.textContent = 'Targets: whole party';
      return;
    }
    if (m.target === content.TARGET.ENEMY_ONE) {
      if (label) label.textContent = 'Target: the boss';
      // Single enemy in alpha — render the boss as the only (auto-selected) target.
      var bAlive = !view.boss || view.boss.alive !== false;
      wrap.appendChild(targetButton('boss', 'The Boss', view.selectedTargetId === 'boss', !bAlive));
      return;
    }
    if (m.target === content.TARGET.ALLY_ONE) {
      if (label) label.textContent = 'Choose an ally';
      view.seats.forEach(function (s) {
        var tid = content.seatTargetId(s.seatIndex);
        var isSelf = s.seatIndex === view.seatIndex;
        // Build the label from numeric seat index + the static class label only.
        // Never interpolate raw server strings; getClass returns a known label or null.
        var cls = s.classId ? content.getClass(s.classId) : null;
        var name = 'Seat ' + s.seatIndex + (isSelf ? ' (you)' : '') +
          (cls ? ' · ' + cls.label : '');
        wrap.appendChild(targetButton(tid, name, view.selectedTargetId === tid, s.alive === false));
      });
    }
  }

  function targetButton(targetId, label, selected, disabled) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'target-btn' + (selected ? ' selected' : '') + (disabled ? ' dead' : '');
    btn.textContent = disabled ? (label + ' (down)') : label;
    btn.disabled = !!disabled;
    if (!disabled) {
      btn.addEventListener('click', function () {
        view.selectedTargetId = targetId;
        renderMoves();
      });
    }
    return btn;
  }

  function selectionIsComplete() {
    var m = view.selectedMoveId ? content.getMove(view.selectedMoveId) : null;
    if (!m) return false;
    var needsTarget = (m.target === content.TARGET.ENEMY_ONE || m.target === content.TARGET.ALLY_ONE);
    if (needsTarget && !view.selectedTargetId) return false;
    return true;
  }

  function updateSubmitState() {
    var btn = $('submit-btn');
    if (!btn) return;
    var accepting = isMatchAcceptingMoves() && !view.timerExpired;
    var ready = selectionIsComplete();
    btn.disabled = !(accepting && ready);

    var alreadySubmitted = view.submittedForRound === view.round && view.round > 0;
    if (alreadySubmitted) {
      btn.textContent = 'Update lock-in';
    } else {
      btn.textContent = 'Lock in move';
    }
  }

  function doSubmit() {
    if (!selectionIsComplete()) return;
    var m = content.getMove(view.selectedMoveId);
    // For AOE / self moves with no single target, send the move's natural target token.
    var targetId = view.selectedTargetId;
    if (!targetId) {
      if (m.target === content.TARGET.ENEMY_ALL) targetId = 'boss';        // alpha single enemy
      else if (m.target === content.TARGET.ALLY_ALL) targetId = 'party';   // whole-party token
      else if (m.target === content.TARGET.SELF) targetId = content.seatTargetId(view.seatIndex);
    }

    var round = view.round;
    setStatus('Locking in…');
    var btn = $('submit-btn');
    if (btn) btn.disabled = true;
    api.submitMove(round, view.selectedMoveId, targetId).then(function () {
      view.submittedForRound = round;
      setStatus('Locked in: ' + m.label + '. You can change it until the timer ends.', 'ok');
      updateSubmitState();
    }).catch(function (err) {
      setStatus('Lock-in failed: ' + err.message, 'error');
      updateSubmitState();
    });
  }

  // ===================================================================================
  // SOFT TIMER (visual only)
  // ===================================================================================
  function resetTimerFromSnapshot() {
    // Prefer server-provided endsAtEpochMs; else derive a soft window from now.
    if (typeof view.endsAtEpochMs === 'number' && view.endsAtEpochMs > 0) {
      view.timerEndsAt = view.endsAtEpochMs;
    } else if (isMatchAcceptingMoves()) {
      view.timerEndsAt = Date.now() + cfg.SOFT_TIMER_SECONDS * 1000;
    } else {
      view.timerEndsAt = null;
    }
    view.timerExpired = false;
  }

  function tick() {
    var el = $('timer');
    var waiting = $('waiting-line');
    if (!el) return;

    if (view.matchPhase === 'won') {
      el.textContent = 'Victory! The boss is down.';
      hide(waiting); return;
    }
    if (view.matchPhase === 'lost') {
      el.textContent = 'Party wiped. The boss wins this one.';
      hide(waiting); return;
    }

    if (!view.timerEndsAt) {
      el.textContent = view.round > 0 ? 'Round ' + view.round : 'Waiting for the match to start…';
      hide(waiting);
      return;
    }

    var remainingMs = view.timerEndsAt - Date.now();
    if (remainingMs <= 0) {
      view.timerExpired = true;
      el.textContent = 'Round ' + view.round + ' · time up';
      show(waiting);
      setText('waiting-line', 'Waiting for results…');
      updateSubmitState();
    } else {
      hide(waiting);
      var secs = Math.ceil(remainingMs / 1000);
      el.textContent = 'Round ' + view.round + ' · ' + secs + 's to lock in';
    }
  }

  function startTicking() {
    if (tickTimer) return;
    tickTimer = setInterval(tick, 250);
    tick();
  }

  // ===================================================================================
  // STATE SYNC (poll fallback + Realtime push hook)
  // ===================================================================================
  function applySnapshot(snap) {
    if (!snap) return;
    var prevRound = view.round;

    view.matchPhase = snap.matchPhase || view.matchPhase;
    view.round = (typeof snap.round === 'number') ? snap.round : view.round;
    view.endsAtEpochMs = (typeof snap.endsAtEpochMs === 'number') ? snap.endsAtEpochMs : null;
    view.you = snap.you || view.you;
    view.boss = snap.boss || view.boss;
    view.seats = Array.isArray(snap.seats) ? snap.seats : view.seats;

    // Keep our identity in sync if the server reports it.
    if (view.you) {
      if (typeof view.you.seatIndex === 'number') view.seatIndex = view.you.seatIndex;
      if (view.you.classId) view.classId = view.you.classId;
    }

    // New round → fresh prompt: clear round-local selection and re-arm the timer.
    if (view.round !== prevRound) {
      view.selectedMoveId = null;
      view.selectedTargetId = null;
      view.submittedForRound = null;
      resetTimerFromSnapshot();
    } else if (view.timerEndsAt === null) {
      resetTimerFromSnapshot();
    }

    refreshSections();
    renderClassChoices();
    renderMoves();
    renderReadout();
    tick();
  }

  function renderReadout() {
    // Your own card
    if (view.you) {
      var cls = view.you.classId ? content.getClass(view.you.classId) : null;
      setText('you-class', cls ? cls.label : (view.classId ? view.classId : '—'));
      setText('you-seat', view.seatIndex !== null ? ('Seat ' + view.seatIndex) : '—');
      setText('you-hp', view.you.hp + ' / ' + view.you.maxHp + (view.you.alive === false ? ' (down)' : ''));
      setHpBar('you-hp-bar', view.you.hp, view.you.maxHp, view.you.alive !== false);
    }

    // Boss
    if (view.boss) {
      setText('boss-hp', view.boss.hp + ' / ' + view.boss.maxHp + (view.boss.alive === false ? ' (down)' : ''));
      setHpBar('boss-hp-bar', view.boss.hp, view.boss.maxHp, view.boss.alive !== false);
    }

    // Party list
    var list = $('party-list');
    if (list) {
      list.innerHTML = '';
      view.seats.forEach(function (s) {
        var li = document.createElement('li');
        li.className = 'party-row' + (s.alive === false ? ' down' : '') +
          (s.seatIndex === view.seatIndex ? ' me' : '');
        var cls = s.classId ? content.getClass(s.classId) : null;
        var name = 'Seat ' + s.seatIndex + (s.seatIndex === view.seatIndex ? ' (you)' : '');
        // Safe DOM construction (textContent) — never innerHTML with server-derived data.
        li.appendChild(spanWith('party-row__name', name));
        li.appendChild(spanWith('party-row__class', cls ? cls.label : '—'));
        li.appendChild(spanWith('party-row__hp', s.hp + '/' + s.maxHp));
        list.appendChild(li);
      });
    }
  }

  function setHpBar(id, hp, maxHp, alive) {
    var bar = $(id);
    if (!bar) return;
    var pct = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
    var fill = bar.querySelector('.hp-bar__fill');
    if (fill) {
      fill.style.width = pct + '%';
      fill.className = 'hp-bar__fill' + (!alive ? ' dead' : (pct < 30 ? ' low' : ''));
    }
  }

  function pollOnce() {
    api.getState().then(applySnapshot).catch(function (err) {
      // Soft-fail: state poll errors are non-fatal; keep the last good snapshot.
      setStatus('State unavailable: ' + err.message, 'warn');
    });
  }

  function startStateSync() {
    pollOnce();
    if (!pollTimer) {
      pollTimer = setInterval(pollOnce, cfg.POLL_INTERVAL_MS);
    }
    startTicking();
    // Realtime push hook: if a transport is wired (e.g. via the mock or a future
    // Supabase client), feed `state` and `prompt` events straight into applySnapshot.
    if (global.TPK_REALTIME && typeof global.TPK_REALTIME.subscribe === 'function') {
      global.TPK_REALTIME.subscribe(view.channelId, {
        onState: applySnapshot,
        onPrompt: function (p) {
          // prompt { round, endsAtEpochMs } — treat as a thin snapshot patch.
          applySnapshot({ round: p.round, endsAtEpochMs: p.endsAtEpochMs, matchPhase: 'lockin' });
        }
      });
    }
  }

  // ===================================================================================
  // BOOT
  // ===================================================================================
  function wireButtons() {
    var jb = $('join-btn'); if (jb) jb.addEventListener('click', doJoin);
    var sb = $('submit-btn'); if (sb) sb.addEventListener('click', doSubmit);
  }

  function boot() {
    wireButtons();
    refreshSections();
    setStatus('Connecting to Twitch…');

    global.TPK_AUTH.onConfiguration(function (parsed) {
      if (parsed && parsed.apiBase) api.setApiBase(parsed.apiBase);
    });

    global.TPK_AUTH.onReady(function (auth) {
      view.authorized = true;
      view.channelId = auth.channelId;
      setStatus('Connected. Join a seat to play.', 'ok');
      // Try to detect an existing seat without forcing a join (idempotent state read).
      api.getState().then(function (snap) {
        applySnapshot(snap);
        // If the server already knows our seat, surface the play UI directly.
        if (snap && snap.you && typeof snap.you.seatIndex === 'number') {
          startStateSync();
        }
      }).catch(function () { /* not seated yet; show join */ });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Expose for the mock harness to drive/inspect.
  global.TPK_PANEL = { applySnapshot: applySnapshot, view: view };
})(window);
