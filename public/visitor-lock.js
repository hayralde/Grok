/* visitor-only home: remove Gantt/Curva/Equipe for guest; remove Abrir */
(function () {
  function patchTabs() {
    if (typeof setupTabsForRole !== 'function') return false;
    setupTabsForRole = function () {
      const tabbar = document.getElementById('tabbar');
      let visible;
      if (!USER) {
        visible = ['home'];
      } else if (USER.role === 'operador') {
        visible = ['tarefas'];
      } else {
        visible = ['tarefas', 'gantt', 'scurve', 'equipe'];
      }
      tabbar.querySelectorAll('.tab-btn').forEach(btn => {
        const t = btn.getAttribute('data-tab');
        btn.style.display = visible.includes(t) ? '' : 'none';
      });
      const active = document.querySelector('.tab-btn.active');
      const activeTab = active && visible.includes(active.getAttribute('data-tab'))
        ? active.getAttribute('data-tab')
        : visible[0];
      if (typeof activateTab === 'function') activateTab(activeTab);
    };
    return true;
  }

  function hideAbrirButtons() {
    document.querySelectorAll('.home-card-open, [data-open-area]').forEach(el => {
      el.style.display = 'none';
      el.remove();
    });
  }

  function run() {
    if (patchTabs()) {
      try { setupTabsForRole(); } catch (e) {}
    }
    hideAbrirButtons();
    const grid = document.getElementById('homeGrid');
    if (grid && !grid._visitorObs) {
      grid._visitorObs = new MutationObserver(hideAbrirButtons);
      grid._visitorObs.observe(grid, { childList: true, subtree: true });
    }
  }

  let n = 0;
  const t = setInterval(function () {
    n++;
    if (typeof setupTabsForRole === 'function' || n > 60) {
      clearInterval(t);
      run();
    }
  }, 50);
  document.addEventListener('DOMContentLoaded', run);
  window.addEventListener('load', run);
})();
