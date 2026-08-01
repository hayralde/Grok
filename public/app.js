/* HOTFIX: carrega build estavel + oculta barras do visitante */
(function () {
  var s = document.createElement('script');
  s.src = 'https://raw.githubusercontent.com/hayralde/grok/cad87c3aeb2206e1c35beb1a5e61be097a15b1c0/public/app.js';
  s.crossOrigin = 'anonymous';
  s.onload = function () {
    var n = 0;
    var t = setInterval(function () {
      n++;
      if (typeof applyUserUI === 'function') {
        clearInterval(t);
        var orig = applyUserUI;
        applyUserUI = function () {
          orig();
          var areaSwitcher = document.getElementById('areaSwitcher');
          var areaHelp = document.getElementById('areaHelpText');
          var headerSub = document.getElementById('headerSub');
          if (typeof USER === 'undefined' || !USER) {
            if (areaSwitcher) areaSwitcher.classList.add('hidden');
            if (areaHelp) { areaHelp.textContent = ''; areaHelp.style.display = 'none'; }
            if (headerSub) headerSub.style.display = 'none';
          } else {
            if (areaSwitcher) {
              var hideSwitcher = USER.role === 'operador' || !!USER.area_scope;
              areaSwitcher.classList.toggle('hidden', hideSwitcher);
            }
            if (headerSub) headerSub.style.display = '';
          }
        };
        try { applyUserUI(); } catch (e) {}
      }
      if (n > 80) clearInterval(t);
    }, 50);
  };
  s.onerror = function () {
    document.body.insertAdjacentHTML('afterbegin',
      '<div style="background:#e5484d;color:#fff;padding:12px;font-family:monospace">Falha ao carregar app. Envie o ZIP PCM_v4.0.2.1 no Render.</div>'
    );
  };
  document.head.appendChild(s);
})();
