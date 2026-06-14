/* config-page.js — streamer config page logic (alpha: minimal).
 *
 * Lets the streamer set the API base URL, persisted into the Twitch broadcaster
 * configuration segment so the panel can read it via Twitch.ext.configuration.
 * Keep it simple — this is a controller config, not a game settings screen.
 *
 * Depends on: TPK_CONFIG, TPK_AUTH (for onConfiguration), and window.Twitch.ext directly
 * for the configuration.set write (write path is config-page only).
 */
(function (global) {
  'use strict';

  var cfg = global.TPK_CONFIG;

  function $(id) { return document.getElementById(id); }
  function ext() { return (global.Twitch && global.Twitch.ext) ? global.Twitch.ext : null; }

  function setStatus(msg, kind) {
    var el = $('cfg-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' status--' + kind : '');
  }

  function loadExisting() {
    // Read any previously-saved config so the field shows the current value.
    global.TPK_AUTH.onConfiguration(function (parsed) {
      if (parsed && parsed.apiBase) {
        var input = $('api-base');
        if (input) input.value = parsed.apiBase;
        setStatus('Loaded saved configuration.', 'ok');
      }
    });
  }

  function save() {
    var input = $('api-base');
    var url = input ? input.value.trim() : '';
    if (!url) { setStatus('Enter an API base URL.', 'error'); return; }
    if (!/^https?:\/\//i.test(url)) { setStatus('URL must start with http(s)://', 'error'); return; }

    var e = ext();
    if (!e || !e.configuration || !e.configuration.set) {
      setStatus('Twitch config API unavailable (open this inside the Twitch console).', 'error');
      return;
    }
    var payload = JSON.stringify({ apiBase: url.replace(/\/+$/, '') });
    // version "1", segment "broadcaster" — readable by the panel.
    e.configuration.set('broadcaster', '1', payload);
    setStatus('Saved. Viewers will use: ' + url, 'ok');
  }

  function boot() {
    var input = $('api-base');
    if (input && !input.value) input.value = cfg.API_BASE;

    var btn = $('cfg-save'); if (btn) btn.addEventListener('click', save);

    global.TPK_AUTH.onReady(function () {
      setStatus('Connected as broadcaster. Set your API base URL below.', 'ok');
    });
    loadExisting();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})(window);
