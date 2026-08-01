// ================= State =================
let TOKEN = localStorage.getItem('pcm_token') || null;
let USER = null; // null = visitante (leitura pública, visão supervisor)
let CURRENT_AREA = localStorage.getItem('pcm_area') || 'ELETRICA';
let TASKS = [];
let META = { projectStart: null, projectFinish: null, sectorOrder: [] };
let TEAM = [];
let socket = null;

let statusFilter = 'todas';
let dateFilter = 'todas';
let techFilter = 'todos';
let collapsedState = {};
let sCurveChart = null;
let homeCharts = {}; // area -> Chart
let HOME_DATA = null;
const MARCOS_PALETTE = ['mb-purple','mb-blue','mb-teal','mb-orange','mb-yellow','mb-red','mb-green','mb-gray'];


const AREA_LABELS = {
  ELETRICA: 'Elétrica',
  MECANICA: 'Mecânica',
  TGM: 'TGM',
};

// ================= API helper =================
async function api(path, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;

  let url = path;
  const method = (opts.method || 'GET').toUpperCase();
  if (method === 'GET') {
    const sep = path.includes('?') ? '&' : '?';
    if (!/[?&]area=/.test(path)) url = path + sep + 'area=' + encodeURIComponent(CURRENT_AREA);
  }

  const res = await fetch(url, Object.assign({}, opts, { headers }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Erro ' + res.status));
  return data;
}

// ================= Login (optional modal) =================
const loginModal = document.getElementById('loginModalOverlay');
document.getElementById('loginOpenBtn').addEventListener('click', () => {
  document.getElementById('loginError').classList.add('hidden');
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  loginModal.classList.remove('hidden');
  document.getElementById('loginUsername').focus();
});
document.getElementById('loginCancelBtn').addEventListener('click', () => loginModal.classList.add('hidden'));
loginModal.addEventListener('click', (e) => { if (e.target === loginModal) loginModal.classList.add('hidden'); });
document.getElementById('loginBtn').addEventListener('click', doLogin);
document.getElementById('loginPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
document.getElementById('loginUsername').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  try {
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    TOKEN = data.token;
    USER = data.user;
    localStorage.setItem('pcm_token', TOKEN);
    loginModal.classList.add('hidden');
    applyUserUI();
    await reloadData();
    renderAll();
  } catch (e) {
    errEl.textContent = e.message || 'Usuário ou senha inválidos.';
    errEl.classList.remove('hidden');
  }
}

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('pcm_token');
  TOKEN = null;
  USER = null;
  applyUserUI();
  reloadData().then(renderAll);
});


/** Restringe o seletor de área se o usuário tiver area_scope (ex.: supertgm → só TGM). */
function applyAreaScopeUI() {
  const scope = USER && USER.area_scope ? String(USER.area_scope).toUpperCase() : null;
  document.querySelectorAll('#areaSwitcher .area-btn').forEach(btn => {
    const a = btn.getAttribute('data-area');
    if (!scope) {
      btn.style.display = '';
      btn.disabled = false;
      return;
    }
    const allowed = a === scope;
    btn.style.display = allowed ? '' : 'none';
    btn.disabled = !allowed;
  });
  if (scope && CURRENT_AREA !== scope) {
    CURRENT_AREA = scope;
    localStorage.setItem('pcm_area', CURRENT_AREA);
    document.querySelectorAll('#areaSwitcher .area-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-area') === CURRENT_AREA);
    });
    const sub = document.getElementById('headerSub');
    if (sub) sub.textContent = AREA_LABELS[CURRENT_AREA] || CURRENT_AREA;
  }
}

function applyUserUI() {
  const nameEl = document.getElementById('userName');
  const roleEl = document.getElementById('userRole');
  const loginBtn = document.getElementById('loginOpenBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const adminControls = document.getElementById('adminControls');
  const areaSwitcher = document.getElementById('areaSwitcher');
  const areaHelp = document.getElementById('areaHelpText');
  const headerSub = document.getElementById('headerSub');

  if (USER) {
    nameEl.textContent = USER.nome;
    roleEl.textContent = USER.area_scope ? (USER.role + ' · ' + USER.area_scope) : USER.role;
    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
    adminControls.classList.toggle('hidden', USER.role !== 'admin');
    if (areaSwitcher) {
      const hideSwitcher = USER.role === 'operador' || !!USER.area_scope;
      areaSwitcher.classList.toggle('hidden', hideSwitcher);
    }
    if (headerSub) headerSub.style.display = '';
  } else {
    nameEl.textContent = 'Visitante';
    roleEl.textContent = 'leitura';
    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    adminControls.classList.add('hidden');
    if (areaSwitcher) areaSwitcher.classList.add('hidden');
    if (areaHelp) {
      areaHelp.textContent = '';
      areaHelp.style.display = 'none';
    }
    if (headerSub) headerSub.style.display = 'none';
  }
  setupTabsForRole();
  applyAreaScopeUI();
}

// ================= Area switcher =================
document.querySelectorAll('#areaSwitcher .area-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const area = btn.getAttribute('data-area');
    if (area === CURRENT_AREA) return;
    if (USER && USER.area_scope && area !== String(USER.area_scope).toUpperCase()) return;
    CURRENT_AREA = area;
    localStorage.setItem('pcm_area', CURRENT_AREA);
    document.querySelectorAll('#areaSwitcher .area-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-area') === CURRENT_AREA);
    });
    document.getElementById('headerSub').textContent = AREA_LABELS[CURRENT_AREA] || CURRENT_AREA;
    collapsedState = {};
    dateFilter = 'todas';
    techFilter = 'todos';
    document.getElementById('dateChips').innerHTML = '';
    const _tc = document.getElementById('techChips'); if (_tc) { _tc.innerHTML = ''; _tc.dataset.sig = ''; }
    if (sCurveChart) { sCurveChart.destroy(); sCurveChart = null; }
    await reloadData();
    renderAll();
  });
});

function syncAreaSwitcher() {
  document.querySelectorAll('#areaSwitcher .area-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-area') === CURRENT_AREA);
  });
  document.getElementById('headerSub').textContent = AREA_LABELS[CURRENT_AREA] || CURRENT_AREA;
}

// ================= Boot =================
async function tryRestoreSession() {
  if (!TOKEN) return;
  try {
    const data = await api('/api/me');
    USER = data.user;
  } catch (e) {
    localStorage.removeItem('pcm_token');
    TOKEN = null;
    USER = null;
  }
}

async function boot() {
  syncAreaSwitcher();
  applyUserUI();
  applyAreaScopeUI();
  await reloadData();
  setupSocket();
  renderAll();
}

async function reloadData() {
  await loadMeta();
  await loadTasks();
  await loadTeam();
}

function setupTabsForRole() {
  const tabbar = document.getElementById('tabbar');
  let visible;
  if (!USER) {
    visible = ['home', 'gantt', 'scurve', 'equipe'];
  } else if (USER.role === 'operador') {
    visible = ['tarefas'];
  } else if (USER.role === 'supervisor') {
    visible = ['home', 'tarefas', 'gantt', 'scurve', 'equipe'];
  } else {
    visible = ['home', 'tarefas', 'gantt', 'scurve', 'equipe'];
  }

  tabbar.querySelectorAll('.tab-btn').forEach(btn => {
    const t = btn.getAttribute('data-tab');
    btn.style.display = visible.includes(t) ? '' : 'none';
  });

  const active = document.querySelector('.tab-btn.active');
  const activeTab = active && visible.includes(active.getAttribute('data-tab'))
    ? active.getAttribute('data-tab')
    : visible[0];
  activateTab(activeTab);
}

function activateTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  if (tab === 'home') {
    renderHome();
    setTimeout(() => {
      Object.values(homeCharts).forEach(ch => { try { ch.resize(); } catch (_) {} });
    }, 50);
  }
  if (tab === 'gantt') renderGantt();
  if (tab === 'scurve') {
    renderSCurve();
    if (sCurveChart) setTimeout(() => { try { sCurveChart.resize(); } catch (_) {} }, 40);
  }
  if (tab === 'equipe') renderEquipe();
  if (tab === 'tarefas') renderTarefas();
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.getAttribute('data-tab')));
});

// REST OF FILE CONTINUES IN NEXT PUSH - TEMP
alert('app.js incompleto - recarregue após deploy completo');
