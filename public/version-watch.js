/* Auto-reload após deploy no Render — consulta /api/version a cada 10s */
(function () {
  var POLL_MS = 10000;
  var current = null;

  async function check() {
    try {
      var res = await fetch('/api/version', { cache: 'no-store' });
      if (!res.ok) return;
      var data = await res.json();
      if (!data || !data.version) return;
      if (current == null) {
        current = String(data.version);
        return;
      }
      if (String(data.version) !== current) {
        console.info('[PCM] Nova versão no servidor:', current, '→', data.version, '— recarregando…');
        location.reload();
      }
    } catch (e) { /* offline / rede */ }
  }

  check();
  setInterval(check, POLL_MS);
})();
