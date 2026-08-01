/* HOTFIX loader: base 4.0.2.0 from last good commit, then visitor UI patch */
(function () {
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/gh/hayralde/grok@cad87c3aeb2206e1c35beb1a5e61be097a15b1c0/public/app.js';
  s.onload = function () {
    // Ocultar seletor de disciplina e texto de ajuda para visitante
    const _orig = window.applyUserUI;
    // Patch after load — functions are in global scope of classic script
    try {
      const wrap = function () {
        if (typeof applyUserUI !== 'function') return;
        const _apply = applyUserUI;
        applyUserUI = function () {
          _apply();
          const areaSwitcher = document.getElementById('areaSwitcher');
          const areaHelp = document.getElementById('areaHelpText');
          const headerSub = document.getElementById('headerSub');
          if (!USER) {
            if (areaSwitcher) areaSwitcher.classList.add('hidden');
            if (areaHelp) { areaHelp.textContent = ''; areaHelp.style.display = 'none'; }
            if (headerSub) headerSub.style.display = 'none';
          } else {
            if (areaSwitcher) {
              const hideSwitcher = USER.role === 'operador' || !!USER.area_scope;
              areaSwitcher.classList.toggle('hidden', hideSwitcher);
            }
            if (headerSub) headerSub.style.display = '';
          }
        };
        // Re-run after boot may have already run
        if (typeof USER !== 'undefined') applyUserUI();
      };
      // applyUserUI is not on window when using classic script globals — patch via periodic check
      let n = 0;
      const t = setInterval(function () {
        n++;
        if (typeof applyUserUI === 'function') {
          clearInterval(t);
          const orig = applyUserUI;
          applyUserUI = function () {
            orig();
            const areaSwitcher = document.getElementById('areaSwitcher');
            const areaHelp = document.getElementById('areaHelpText');
            const headerSub = document.getElementById('headerSub');
            if (typeof USER === 'undefined' || !USER) {
              if (areaSwitcher) areaSwitcher.classList.add('hidden');
              if (areaHelp) { areaHelp.textContent = ''; areaHelp.style.display = 'none'; }
              if (headerSub) headerSub.style.display = 'none';
            } else {
              if (areaSwitcher) {
                const hideSwitcher = USER.role === 'operador' || !!USER.area_scope;
                areaSwitcher.classList.toggle('hidden', hideSwitcher);
              }
              if (headerSub) headerSub.style.display = '';
            }
          };
          try { applyUserUI(); } catch (e) {}
        }
        if (n > 50) clearInterval(t);
      }, 100);
    } catch (e) { console.error(e); }
  };
  s.onerror = function () {
    document.body.insertAdjacentHTML('afterbegin',
      '<div style="background:#e5484d;color:#fff;padding:12px;font-family:monospace">Falha ao carregar app.js base. Faça hard refresh ou reenvie o ZIP PCM_v4.0.2.1.</div>'
    );
  };
  document.head.appendChild(s);
})();
