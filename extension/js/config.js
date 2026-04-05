/**
 * config.js — Boss Battle streamer configuration page.
 *
 * Lets the broadcaster set the boss name and difficulty level.
 * Settings are persisted to localStorage (MVP); a future version
 * could use the Twitch Configuration Service.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'boss_battle_config';

  /* --------------------------------------------------------------------
     DOM references
     -------------------------------------------------------------------- */
  var dom = {
    bossName:   document.getElementById('boss-name'),
    difficulty: document.getElementById('difficulty'),
    saveBtn:    document.getElementById('save-btn'),
    saveStatus: document.getElementById('save-status'),
  };

  /* --------------------------------------------------------------------
     Load / Save helpers
     -------------------------------------------------------------------- */
  function loadConfig() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var cfg = JSON.parse(raw);
        if (cfg.boss_name)  dom.bossName.value   = cfg.boss_name;
        if (cfg.difficulty) dom.difficulty.value  = cfg.difficulty;
      }
    } catch (e) {
      console.warn('[config] Failed to load saved config', e);
    }
  }

  function saveConfig() {
    var cfg = {
      boss_name:  dom.bossName.value.trim() || 'Chat Boss',
      difficulty: dom.difficulty.value,
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
      showStatus('Configuration saved!', false);
    } catch (e) {
      console.error('[config] Failed to save config', e);
      showStatus('Failed to save.', true);
    }
  }

  function showStatus(msg, isError) {
    dom.saveStatus.textContent = msg;
    dom.saveStatus.style.color = isError ? '#ff3333' : '#33ff66';
    setTimeout(function () {
      dom.saveStatus.textContent = '';
    }, 3000);
  }

  /* --------------------------------------------------------------------
     Events
     -------------------------------------------------------------------- */
  dom.saveBtn.addEventListener('click', function () {
    saveConfig();
  });

  /* --------------------------------------------------------------------
     Init
     -------------------------------------------------------------------- */
  function init() {
    loadConfig();
    console.log('[config] initialised');
  }

  if (window.TwitchExt) {
    window.TwitchExt.init(function () { init(); });
    setTimeout(function () { init(); }, 500);
  } else {
    init();
  }
})();
