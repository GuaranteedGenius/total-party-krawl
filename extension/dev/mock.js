/* mock.js — DEV ONLY. Local test harness for the viewer panel.
 *
 * Stubs window.Twitch.ext (onAuthorized with a fake JWT + channel/opaque ids) and
 * intercepts window.fetch so the panel exercises the full flow with NO real network.
 * The fake server keeps a tiny in-memory match and advances rounds on a timer, so you
 * can watch the soft timer, the "Waiting for results…" state, and HP updates.
 *
 * THIS FILE MUST NOT SHIP. It lives under extension/dev/ and is loaded only by mock.html.
 */
(function (global) {
  'use strict';

  var log = [];
  function logCall(line) {
    log.unshift(new Date().toISOString().slice(11, 19) + '  ' + line);
    var el = document.getElementById('mock-log');
    if (el) el.textContent = log.slice(0, 40).join('\n');
  }

  // ---- Fake match state (the role the game client + server would own) --------------
  var match = {
    matchPhase: 'lockin',
    round: 1,
    endsAtEpochMs: Date.now() + 20000,
    boss: { hp: 600, maxHp: 600, alive: true },
    seats: [
      { seatIndex: 1, classId: 'class.tank', hp: 152, maxHp: 152, alive: true },
      { seatIndex: 2, classId: 'class.mage', hp: 96, maxHp: 96, alive: true }
    ],
    // Our identity: seatIndex assigned on join.
    me: { seatIndex: null, classId: null, hp: 0, maxHp: 0, alive: true, lockedMove: null }
  };

  function youSnapshot() {
    if (match.me.seatIndex === null) return null;
    return {
      seatIndex: match.me.seatIndex,
      classId: match.me.classId,
      hp: match.me.hp,
      maxHp: match.me.maxHp,
      alive: match.me.alive,
      lockedMove: match.me.lockedMove
    };
  }

  function fullSnapshot() {
    // seats list includes us once we are seated.
    var seats = match.seats.slice();
    if (match.me.seatIndex !== null) {
      seats.push({
        seatIndex: match.me.seatIndex, classId: match.me.classId,
        hp: match.me.hp, maxHp: match.me.maxHp, alive: match.me.alive
      });
      seats.sort(function (a, b) { return a.seatIndex - b.seatIndex; });
    }
    return {
      matchPhase: match.matchPhase,
      round: match.round,
      endsAtEpochMs: match.endsAtEpochMs,
      you: youSnapshot(),
      boss: match.boss,
      seats: seats
    };
  }

  function classBase(classId) {
    var bases = {
      'class.tank': { hp: 152 }, 'class.mage': { hp: 96 }, 'class.healer': { hp: 112 }
    };
    return bases[classId] || { hp: 100 };
  }

  function jsonResponse(obj, status) {
    return Promise.resolve(new Response(JSON.stringify(obj), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' }
    }));
  }

  // ---- Intercept fetch -------------------------------------------------------------
  global.fetch = function (url, opts) {
    opts = opts || {};
    var method = (opts.method || 'GET').toUpperCase();
    var path = String(url).replace(/^https?:\/\/[^/]+/, '');
    var auth = (opts.headers && (opts.headers.Authorization || opts.headers['Authorization'])) || '';
    var hasAuth = /^Bearer\s+.+/.test(auth);

    if (!hasAuth) {
      logCall('REJECT ' + method + ' ' + path + ' (missing Bearer)');
      return jsonResponse({ error: 'missing auth' }, 401);
    }

    var body = {};
    if (opts.body) { try { body = JSON.parse(opts.body); } catch (e) {} }

    if (path === '/api/join' && method === 'POST') {
      var already = match.me.seatIndex !== null;
      if (!already) {
        match.me.seatIndex = 0; // give us seat 0
      }
      logCall('POST /api/join -> seat ' + match.me.seatIndex + (already ? ' (already)' : ''));
      return jsonResponse({ seatIndex: match.me.seatIndex, classId: match.me.classId, alreadySeated: already });
    }

    if (path === '/api/class' && method === 'POST') {
      match.me.classId = body.classId;
      var base = classBase(body.classId);
      match.me.maxHp = base.hp;
      match.me.hp = base.hp;
      logCall('POST /api/class -> ' + body.classId);
      return jsonResponse({ ok: true, classId: body.classId });
    }

    if (path === '/api/move' && method === 'POST') {
      match.me.lockedMove = { round: body.round, moveId: body.moveId, targetId: body.targetId };
      logCall('POST /api/move round=' + body.round + ' move=' + body.moveId + ' target=' + body.targetId);
      return jsonResponse({ ok: true });
    }

    if (path === '/api/state' && method === 'GET') {
      logCall('GET /api/state -> round ' + match.round + ' phase ' + match.matchPhase);
      return jsonResponse(fullSnapshot());
    }

    logCall('404 ' + method + ' ' + path);
    return jsonResponse({ error: 'not found' }, 404);
  };

  // ---- Stub Twitch.ext -------------------------------------------------------------
  var authCb = null;
  var fakeJwt = 'DEV.' + btoa('{"alg":"HS256"}') + '.devsig';
  global.Twitch = {
    ext: {
      onAuthorized: function (cb) {
        authCb = cb;
        setTimeout(function () {
          logCall('onAuthorized fired (dev JWT)');
          cb({
            channelId: 'dev-channel-123',
            clientId: 'dev-client',
            token: fakeJwt,
            userId: 'U-dev',
            opaqueUserId: 'OU-dev-abc'
          });
        }, 150);
      },
      onContext: function () {},
      configuration: {
        broadcaster: null,
        onChanged: function () {},
        set: function () {}
      }
    }
  };

  // ---- Drive the fake match: advance rounds so the timer cycle is visible ----------
  // Every ~24s: apply a little damage and start a new round (new prompt).
  function advanceRound() {
    // Apply mock results: boss takes damage, our HP nudges.
    match.boss.hp = Math.max(0, match.boss.hp - 50);
    if (match.boss.hp === 0) { match.boss.alive = false; match.matchPhase = 'won'; }

    if (match.me.seatIndex !== null && match.me.alive) {
      match.me.hp = Math.max(0, match.me.hp - 8);
      if (match.me.hp === 0) match.me.alive = false;
    }

    if (match.matchPhase !== 'won' && match.matchPhase !== 'lost') {
      match.round += 1;
      match.matchPhase = 'lockin';
      match.endsAtEpochMs = Date.now() + 20000;
      logCall('--- new round ' + match.round + ' (prompt) ---');
    }
  }

  // Expose manual controls for the harness buttons.
  global.MOCK = {
    nextRound: advanceRound,
    snapshot: fullSnapshot,
    damageMe: function (n) {
      if (match.me.seatIndex === null) return;
      match.me.hp = Math.max(0, match.me.hp - (n || 20));
      if (match.me.hp === 0) match.me.alive = false;
    },
    winNow: function () { match.boss.hp = 0; match.boss.alive = false; match.matchPhase = 'won'; }
  };

  // Auto-advance loop (slightly longer than the 20s soft timer so you SEE the
  // "Waiting for results…" state before the next prompt).
  setInterval(advanceRound, 24000);

  logCall('mock harness loaded — fetch + Twitch.ext stubbed, no real network');
})(window);
