/* harness.test.js — DEV ONLY, node-run static integration check (no jsdom, no network).
 *
 * Builds a minimal fake DOM + window, installs a stubbed Twitch.ext and fetch, then
 * loads the REAL panel scripts in a vm and drives the flow:
 *   authorize -> join -> pick class -> select move -> submit -> snapshot -> timer expiry.
 *
 * Run:  node extension/dev/harness.test.js
 * This is a reasoning/verification aid, not a shipped artifact.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ok  - ' + msg); }
  else { console.log('  FAIL- ' + msg); failures++; }
}

// ---- Minimal fake DOM --------------------------------------------------------------
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    children: [],
    _attrs: {},
    style: {},
    _classes: new Set(),
    _listeners: {},
    _text: '',
    disabled: false,
    get className() { return Array.from(this._classes).join(' '); },
    set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    classList: {
      add: function (c) { el._classes.add(c); },
      remove: function (c) { el._classes.delete(c); },
      contains: function (c) { return el._classes.has(c); }
    },
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); this.children = []; },
    get innerHTML() { return this._html || ''; },
    set innerHTML(v) { this._html = String(v); this.children = []; },
    setAttribute: function (k, v) { this._attrs[k] = v; },
    getAttribute: function (k) { return this._attrs[k]; },
    appendChild: function (c) { this.children.push(c); c.parentNode = this; return c; },
    addEventListener: function (ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    click: function () { (this._listeners['click'] || []).forEach(function (f) { f({}); }); },
    querySelector: function (sel) {
      // only need .hp-bar__fill lookups
      const cls = sel.replace('.', '');
      function find(node) {
        for (const ch of node.children) {
          if (ch._classes && ch._classes.has(cls)) return ch;
          const r = find(ch); if (r) return r;
        }
        return null;
      }
      return find(this);
    }
  };
  return el;
}

const byId = {};
function reg(id, tag) { const e = makeEl(tag); e._attrs.id = id; byId[id] = e; return e; }

// Register the ids the panel touches.
[
  'status-line', 'join-section', 'class-section', 'play-section',
  'join-btn', 'class-choices', 'timer', 'waiting-line', 'waiting-line',
  'move-list', 'target-label', 'target-list', 'submit-btn',
  'you-seat', 'you-class', 'you-hp', 'you-hp-bar', 'boss-hp', 'boss-hp-bar', 'party-list'
].forEach(function (id) { reg(id, 'div'); });
// give hp bars a fill child
['you-hp-bar', 'boss-hp-bar'].forEach(function (id) { byId[id].appendChild(makeEl('div')).classList.add('hp-bar__fill'); });

const documentStub = {
  readyState: 'complete',
  getElementById: function (id) { return byId[id] || null; },
  createElement: function (tag) { return makeEl(tag); },
  addEventListener: function () {}
};

// ---- Fake window + Twitch.ext + fetch (reuse mock.js logic inline) ------------------
const sandbox = { console: console, setTimeout: setTimeout, setInterval: function () { return 0; }, clearInterval: function () {}, Date: Date, JSON: JSON, Math: Math, Promise: Promise, btoa: function (s) { return Buffer.from(s).toString('base64'); }, Response: class { constructor(b, o) { this._b = b; this.status = (o && o.status) || 200; this.ok = this.status >= 200 && this.status < 300; } text() { return Promise.resolve(this._b); } } };
sandbox.window = sandbox;
sandbox.document = documentStub;

// in-memory match
const match = {
  matchPhase: 'lockin', round: 1, endsAtEpochMs: Date.now() + 20000,
  boss: { hp: 600, maxHp: 600, alive: true },
  seats: [{ seatIndex: 1, classId: 'class.tank', hp: 152, maxHp: 152, alive: true }],
  me: { seatIndex: null, classId: null, hp: 0, maxHp: 0, alive: true, lockedMove: null }
};
let lastMovePost = null;
function snap() {
  const seats = match.seats.slice();
  if (match.me.seatIndex !== null) seats.push({ seatIndex: match.me.seatIndex, classId: match.me.classId, hp: match.me.hp, maxHp: match.me.maxHp, alive: match.me.alive });
  seats.sort((a, b) => a.seatIndex - b.seatIndex);
  return { matchPhase: match.matchPhase, round: match.round, endsAtEpochMs: match.endsAtEpochMs, you: match.me.seatIndex === null ? null : { seatIndex: match.me.seatIndex, classId: match.me.classId, hp: match.me.hp, maxHp: match.me.maxHp, alive: match.me.alive, lockedMove: match.me.lockedMove }, boss: match.boss, seats: seats };
}
sandbox.fetch = function (url, opts) {
  opts = opts || {};
  const method = (opts.method || 'GET').toUpperCase();
  const p = String(url).replace(/^https?:\/\/[^/]+/, '');
  const auth = opts.headers && opts.headers.Authorization;
  if (!/^Bearer\s+.+/.test(auth || '')) return Promise.resolve(new sandbox.Response(JSON.stringify({ error: 'no auth' }), { status: 401 }));
  let body = {}; if (opts.body) try { body = JSON.parse(opts.body); } catch (e) {}
  if (p === '/api/join') { const already = match.me.seatIndex !== null; if (!already) match.me.seatIndex = 0; return Promise.resolve(new sandbox.Response(JSON.stringify({ seatIndex: match.me.seatIndex, classId: match.me.classId, alreadySeated: already }))); }
  if (p === '/api/class') { match.me.classId = body.classId; match.me.maxHp = 96; match.me.hp = 96; return Promise.resolve(new sandbox.Response(JSON.stringify({ ok: true, classId: body.classId }))); }
  if (p === '/api/move') { lastMovePost = body; match.me.lockedMove = body; return Promise.resolve(new sandbox.Response(JSON.stringify({ ok: true }))); }
  if (p === '/api/state') return Promise.resolve(new sandbox.Response(JSON.stringify(snap())));
  return Promise.resolve(new sandbox.Response(JSON.stringify({ error: '404' }), { status: 404 }));
};
let authCb = null;
sandbox.Twitch = { ext: { onAuthorized: function (cb) { authCb = cb; }, onContext: function () {}, configuration: { broadcaster: null, onChanged: function () {}, set: function () {} } } };

// ---- Load the real scripts in order ------------------------------------------------
vm.createContext(sandbox);
const base = path.join(__dirname, '..');
['js/config.js', 'js/content.js', 'js/twitch-auth.js', 'js/api.js', 'js/panel.js'].forEach(function (rel) {
  const code = fs.readFileSync(path.join(base, rel), 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
});

// ---- Drive the flow ----------------------------------------------------------------
async function run() {
  console.log('CONTENT ids check');
  const C = sandbox.TPK_CONTENT;
  assert(C.ORDERED_CLASS_IDS.join(',') === 'class.tank,class.mage,class.healer', 'class ids match contract');
  assert(C.movesForClass('class.mage').map(m => m.id).join(',') === 'basic.attack,mage.fireball,mage.flame_burst', 'mage moves match spec');
  assert(C.movesForClass('class.tank').map(m => m.id).join(',') === 'basic.attack,tank.taunt,tank.shield_bash', 'tank moves match spec');
  assert(C.movesForClass('class.healer').map(m => m.id).join(',') === 'basic.attack,healer.heal,healer.mend', 'healer moves match spec');
  assert(C.seatTargetId(3) === 'seat.3', 'seat target id format');

  console.log('FLOW: authorize');
  authCb({ channelId: 'c1', clientId: 'cl', token: 'JWT', userId: 'u', opaqueUserId: 'ou' });
  await tick(50);
  assert(sandbox.TPK_AUTH.getAuth().token === 'JWT', 'auth captured token');

  console.log('FLOW: join');
  byId['join-btn'].click();
  await tick(50);
  assert(sandbox.TPK_PANEL.view.seatIndex === 0, 'joined seat 0');
  assert(!byId['class-section']._classes.has('hidden'), 'class section shown after join');

  console.log('FLOW: pick class (mage)');
  // class cards are rebuilt via innerHTML in production; the harness drives pickClass via the view.
  // Simulate the click path by calling the exposed snapshot after setClass through API.
  await sandbox.TPK_API.setClass('class.mage');
  sandbox.TPK_PANEL.applySnapshot(snap());
  await tick(20);
  assert(sandbox.TPK_PANEL.view.classId === 'class.mage', 'class set to mage');
  assert(!byId['play-section']._classes.has('hidden'), 'play section shown after class');

  console.log('FLOW: select move + target + submit');
  // move-list buttons exist as child elements; find the fireball button and click it.
  const fireballBtn = findChild(byId['move-list'], b => b.getAttribute('data-move-id') === 'mage.fireball');
  assert(!!fireballBtn, 'fireball move button rendered');
  fireballBtn.click();
  await tick(20);
  assert(sandbox.TPK_PANEL.view.selectedMoveId === 'mage.fireball', 'fireball selected');
  assert(sandbox.TPK_PANEL.view.selectedTargetId === 'boss', 'enemy_one auto-targets boss');
  assert(byId['submit-btn'].disabled === false, 'submit enabled with complete selection');
  byId['submit-btn'].click();
  await tick(40);
  assert(lastMovePost && lastMovePost.moveId === 'mage.fireball' && lastMovePost.targetId === 'boss' && lastMovePost.round === 1, 'POST /api/move payload correct {round,moveId,targetId}');

  console.log('FLOW: readout reflects snapshot');
  assert(byId['boss-hp']._text === '600 / 600', 'boss hp rendered');
  assert(byId['you-hp']._text.indexOf('96 / 96') === 0, 'your hp rendered');
  assert(byId['party-list'].children.length >= 1, 'party list populated');

  console.log('FLOW: ALLY_ONE target picker (healer heal)');
  await sandbox.TPK_API.setClass('class.healer');
  match.me.classId = 'class.healer';
  sandbox.TPK_PANEL.applySnapshot(snap());
  await tick(20);
  const healBtn = findChild(byId['move-list'], b => b.getAttribute('data-move-id') === 'healer.heal');
  assert(!!healBtn, 'heal move button rendered for healer');
  healBtn.click();
  await tick(20);
  assert(sandbox.TPK_PANEL.view.selectedMoveId === 'healer.heal', 'heal selected');
  assert(sandbox.TPK_PANEL.view.selectedTargetId === null, 'ally_one needs explicit target (none yet)');
  assert(byId['submit-btn'].disabled === true, 'submit disabled until ally target chosen');
  const allyBtn = findChild(byId['target-list'], b => true);
  assert(!!allyBtn, 'ally target buttons rendered');
  allyBtn.click();
  await tick(20);
  assert(sandbox.TPK_PANEL.view.selectedTargetId && sandbox.TPK_PANEL.view.selectedTargetId.indexOf('seat.') === 0, 'ally target is a seat id');
  assert(byId['submit-btn'].disabled === false, 'submit enabled after ally target chosen');
  // revert to mage for the remaining assertions
  match.me.classId = 'class.mage';

  console.log('FLOW: new round clears selection');
  match.round = 2; match.endsAtEpochMs = Date.now() + 20000;
  sandbox.TPK_PANEL.applySnapshot(snap());
  await tick(20);
  assert(sandbox.TPK_PANEL.view.selectedMoveId === null, 'selection cleared on new round');
  assert(sandbox.TPK_PANEL.view.submittedForRound === null, 'submitted flag cleared on new round');

  console.log('FLOW: timer expiry shows waiting');
  // Force the soft timer into the past and run a tick.
  sandbox.TPK_PANEL.view.timerEndsAt = Date.now() - 1000;
  // tick() is internal; trigger via applySnapshot (calls tick) after expiring.
  sandbox.TPK_PANEL.applySnapshot(snap());
  await tick(20);
  assert(sandbox.TPK_PANEL.view.timerExpired === true, 'timer marked expired');
  assert(byId['waiting-line']._text === 'Waiting for results…', 'waiting message shown after expiry');

  console.log('FLOW: win state');
  match.matchPhase = 'won'; sandbox.TPK_PANEL.applySnapshot(snap()); await tick(10);
  assert(byId['timer']._text.indexOf('Victory') === 0, 'victory message shown');

  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
}

function findChild(node, pred) {
  for (const ch of node.children) { if (pred(ch)) return ch; const r = findChild(ch, pred); if (r) return r; }
  return null;
}
function tick(ms) { return new Promise(r => setTimeout(r, ms)); }
run();
