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

  if (USER) {
    nameEl.textContent = USER.nome;
    roleEl.textContent = USER.area_scope ? (USER.role + ' · ' + USER.area_scope) : USER.role;
    loginBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');
    adminControls.classList.toggle('hidden', USER.role !== 'admin');
  } else {
    nameEl.textContent = 'Visitante';
    roleEl.textContent = 'leitura';
    loginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    adminControls.classList.add('hidden');
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
  const all = ['tarefas', 'gantt', 'scurve', 'equipe'];
  let visible = all;
  if (!USER) {
    visible = ['gantt', 'scurve', 'equipe'];
  } else if (USER.role === 'operador') {
    visible = ['tarefas'];
  } else if (USER.role === 'supervisor') {
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
  activateTab(activeTab);
}

function activateTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  if (tab === 'gantt') renderGantt();
  if (tab === 'scurve') {
    renderSCurve();
    // garante que o canvas preencha a área alta após a aba ficar visível
    if (sCurveChart) setTimeout(() => { try { sCurveChart.resize(); } catch (_) {} }, 40);
  }
  if (tab === 'equipe') renderEquipe();
  if (tab === 'tarefas') renderTarefas();
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => activateTab(btn.getAttribute('data-tab')));
});

// ================= Data loading =================
async function loadMeta() {
  const data = await api('/api/meta');
  META = data;
  applyAreaConfigUI();
}

function applyAreaConfigUI() {
  const cfg = META && META.config;
  const sub = document.getElementById('headerSub');
  if (sub) {
    sub.textContent = (cfg && cfg.label) || (AREA_LABELS[CURRENT_AREA] || CURRENT_AREA);
  }
  const help = document.getElementById('areaHelpText');
  if (help) {
    help.textContent = (cfg && cfg.helpText) || '';
    help.style.display = (cfg && cfg.helpText) ? '' : 'none';
  }
  const hoursTitle = document.getElementById('hoursChartTitle');
  if (hoursTitle && cfg) hoursTitle.textContent = cfg.hoursChartTitle || 'Horas por Responsável';
  const hoursSub = document.getElementById('hoursChartSub');
  if (hoursSub && cfg) hoursSub.textContent = cfg.hoursChartSub || 'Planejado vs. Executado';
}
async function loadTasks() {
  const data = await api('/api/tasks');
  TASKS = data.tasks || [];
  if (Object.keys(collapsedState).length === 0 && META.sectorOrder) {
    META.sectorOrder.forEach(s => { collapsedState[s] = true; });
  }
}
async function loadTeam() {
  const data = await api('/api/team');
  TEAM = data.team || [];
}

// ================= Socket.io (real-time) =================
function setupSocket() {
  if (socket) return;
  socket = io();
  socket.on('task-updated', (task) => {
    if (task.area && task.area !== CURRENT_AREA) return;
    const idx = TASKS.findIndex(t => t.id === task.id);
    if (idx >= 0) TASKS[idx] = task;
    else TASKS.push(task);
    renderAll();
  });
  socket.on('progress-reset', async (payload) => {
    if (payload && payload.area && payload.area !== CURRENT_AREA) return;
    await reloadData();
    renderAll();
  });
  socket.on('cronograma-importado', async (payload) => {
    if (payload && payload.area && payload.area !== CURRENT_AREA) return;
    collapsedState = {};
    if (sCurveChart) { sCurveChart.destroy(); sCurveChart = null; }
    await reloadData();
    renderAll();
  });
}

function renderAll() {
  const activeTab = document.querySelector('.tab-btn.active');
  if (!activeTab) return;
  activateTab(activeTab.getAttribute('data-tab'));
}

// ================= Helpers =================
function dayKey(iso) { return iso.slice(0, 10); }
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

async function toggleTask(id, done) {
  if (!USER) {
    alert('Faça login para marcar atividades.');
    renderTarefas();
    return;
  }
  try {
    await api('/api/tasks/' + id + '?area=' + encodeURIComponent(CURRENT_AREA), {
      method: 'PATCH',
      body: JSON.stringify({ done, area: CURRENT_AREA }),
    });
    const idx = TASKS.findIndex(t => t.id === id);
    if (idx >= 0) TASKS[idx].done = done;
    renderAll();
  } catch (e) {
    alert('Erro ao atualizar atividade: ' + e.message);
    renderTarefas();
  }
}

// ================= TAB: Tarefas =================
document.querySelectorAll('#statusChips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    statusFilter = chip.getAttribute('data-status');
    document.querySelectorAll('#statusChips .chip').forEach(c => c.classList.toggle('active', c === chip));
    renderTarefas();
  });
});

function renderTarefas() {
  const listEl = document.getElementById('tarefasList');
  const subEl = document.getElementById('tarefasSub');
  const titleEl = document.getElementById('tarefasTitle');
  if (!listEl) return;

  let tasks = TASKS.slice();
  if (USER && USER.role === 'operador') {
    titleEl.textContent = 'Minhas Atividades';
    subEl.textContent = 'Atividades atribuídas a você (' + USER.nome + ') · ' + (AREA_LABELS[CURRENT_AREA] || CURRENT_AREA);
  } else {
    titleEl.textContent = 'Atividades';
    subEl.textContent = 'Todas as atividades · ' + (AREA_LABELS[CURRENT_AREA] || CURRENT_AREA);
  }

  const canToggle = !!(USER && (USER.role === 'operador' || USER.role === 'admin' || USER.role === 'supervisor'));

  const dateChipsEl = document.getElementById('dateChips');
  const uniqueDays = [...new Set(tasks.map(t => dayKey(t.inicio)))].sort();
  if (dateChipsEl.childElementCount === 0 || dateChipsEl.dataset.count != uniqueDays.length) {
    dateChipsEl.innerHTML = '';
    dateChipsEl.dataset.count = uniqueDays.length;
    const allChip = document.createElement('button');
    allChip.className = 'chip' + (dateFilter === 'todas' ? ' active' : '');
    allChip.textContent = 'Todas as datas';
    allChip.dataset.date = 'todas';
    dateChipsEl.appendChild(allChip);
    uniqueDays.forEach(d => {
      const c = document.createElement('button');
      c.className = 'chip' + (dateFilter === d ? ' active' : '');
      c.dataset.date = d;
      c.textContent = new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
      dateChipsEl.appendChild(c);
    });
    dateChipsEl.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        dateFilter = chip.dataset.date;
        dateChipsEl.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
        renderTarefas();
      });
    });
  }

  // Filtro por executante (técnico / turno / equipe)
  const techChipsEl = document.getElementById('techChips');
  if (techChipsEl) {
    const uniqueTechs = [...new Set(TASKS.map(t => t.tecnico).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const sig = uniqueTechs.join('|');
    if (techChipsEl.dataset.sig !== sig) {
      techChipsEl.dataset.sig = sig;
      techChipsEl.innerHTML = '';
      const allT = document.createElement('button');
      allT.className = 'chip' + (techFilter === 'todos' ? ' active' : '');
      allT.dataset.tech = 'todos';
      allT.textContent = 'Todos os executantes';
      techChipsEl.appendChild(allT);
      uniqueTechs.forEach(name => {
        const c = document.createElement('button');
        c.className = 'chip' + (techFilter === name ? ' active' : '');
        c.dataset.tech = name;
        c.textContent = name;
        techChipsEl.appendChild(c);
      });
      techChipsEl.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
          techFilter = chip.dataset.tech;
          techChipsEl.querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === chip));
          renderTarefas();
        });
      });
    } else {
      techChipsEl.querySelectorAll('.chip').forEach(c => {
        c.classList.toggle('active', c.dataset.tech === techFilter);
      });
    }
  }

  if (statusFilter === 'pendentes') tasks = tasks.filter(t => !t.done);
  if (statusFilter === 'concluidas') tasks = tasks.filter(t => t.done);
  if (dateFilter !== 'todas') tasks = tasks.filter(t => dayKey(t.inicio) === dateFilter);
  if (techFilter !== 'todos') tasks = tasks.filter(t => t.tecnico === techFilter);

  listEl.innerHTML = tasks.map(t => `
    <div class="tarefa-row">
      <input type="checkbox" class="task-check" data-id="${t.id}" ${t.done ? 'checked' : ''} ${canToggle ? '' : 'disabled'}>
      <div>
        <div class="tf-name">${t.nome}</div>
        <div class="tf-sector">${t.setor}${(!USER || USER.role !== 'operador') ? ' &middot; ' + t.tecnico + (t.tecnico_tipo === 'EQUIPE' ? ' <span class="badge-equipe">EQUIPE</span>' : '') : ''}</div>
      </div>
      <div class="tf-hours">${t.horas}h</div>
      <div class="tf-date">${fmtDate(t.inicio)} ${new Date(t.inicio).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>
    </div>
  `).join('') || '<div style="padding:20px; color:var(--text-dim); text-align:center;">Nenhuma atividade encontrada para este filtro.</div>';

  listEl.querySelectorAll('.task-check').forEach(cb => {
    cb.addEventListener('change', (e) => {
      toggleTask(parseInt(e.target.dataset.id, 10), e.target.checked);
    });
  });
}

// ================= TAB: Gantt =================
document.getElementById('toggleAllGanttBtn')?.addEventListener('click', () => {
  const anyExpanded = Object.values(collapsedState).some(v => !v);
  (META.sectorOrder || []).forEach(s => { collapsedState[s] = anyExpanded; });
  document.getElementById('toggleAllGanttBtn').textContent = anyExpanded ? 'Expandir Todos' : 'Recolher Todos';
  renderGantt();
});

function renderGantt() {
  const ganttLeft = document.getElementById('ganttLeft');
  const ganttTrackArea = document.getElementById('ganttTrackArea');
  const ganttScale = document.getElementById('ganttScale');
  if (!ganttLeft) return;

  if (!META.projectStart || !META.projectFinish) {
    ganttLeft.innerHTML = '<div class="gantt-left-scale">SETOR / ATIVIDADE</div><div style="padding:20px;color:var(--text-dim);">Sem cronograma nesta área.</div>';
    ganttTrackArea.innerHTML = '';
    ganttScale.innerHTML = '';
    return;
  }

  const PROJECT_START = new Date(META.projectStart);
  const PROJECT_FINISH = new Date(META.projectFinish);
  const TOTAL_MS = PROJECT_FINISH - PROJECT_START;
  if (TOTAL_MS <= 0) return;

  ganttScale.innerHTML = '';
  let cur = new Date(PROJECT_START); cur.setHours(0, 0, 0, 0);
  while (cur <= PROJECT_FINISH) {
    const left = ((cur - PROJECT_START) / TOTAL_MS) * 100;
    if (left >= 0) {
      const tick = document.createElement('div');
      tick.className = 'tick';
      tick.style.left = left + '%';
      tick.textContent = cur.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
      ganttScale.appendChild(tick);
    }
    cur = new Date(cur.getTime() + 24 * 3600 * 1000);
  }

  const tasksBySector = {};
  (META.sectorOrder || []).forEach(s => { tasksBySector[s] = []; });
  TASKS.forEach(t => {
    if (!tasksBySector[t.setor]) tasksBySector[t.setor] = [];
    tasksBySector[t.setor].push(t);
  });

  const orderedSectors = [...(META.sectorOrder || [])];
  Object.keys(tasksBySector).forEach(s => {
    if (!orderedSectors.includes(s)) orderedSectors.push(s);
  });

  ganttLeft.innerHTML = '';
  ganttTrackArea.innerHTML = '';

  // Espaço à esquerda alinhado à escala de datas (direita) — evita desvio vertical das barras
  const leftScale = document.createElement('div');
  leftScale.className = 'gantt-left-scale';
  leftScale.textContent = 'SETOR / ATIVIDADE';
  ganttLeft.appendChild(leftScale);

  orderedSectors.forEach(sector => {
    const tasks = tasksBySector[sector];
    if (!tasks || tasks.length === 0) return;
    const sStart = tasks.reduce((m, t) => Math.min(m, new Date(t.inicio)), Infinity);
    const sFinish = tasks.reduce((m, t) => Math.max(m, new Date(t.fim)), -Infinity);
    const doneCount = tasks.filter(t => t.done).length;

    if (collapsedState[sector] === undefined) collapsedState[sector] = true;

    const secLeft = document.createElement('div');
    secLeft.className = 'row-left sector-row' + (collapsedState[sector] ? ' collapsed' : '');
    secLeft.innerHTML = `<span class="chev">&#9660;</span><span class="task-name">${sector}</span><span class="sector-count">${doneCount}/${tasks.length}</span>`;
    secLeft.onclick = () => { collapsedState[sector] = !collapsedState[sector]; renderGantt(); };
    ganttLeft.appendChild(secLeft);

    const secTrack = document.createElement('div');
    secTrack.className = 'gantt-row-track';
    const hoursTotal = tasks.reduce((s, t) => s + (Number(t.horas) || 0), 0);
    const hoursDone = tasks.filter(t => t.done).reduce((s, t) => s + (Number(t.horas) || 0), 0);
    const pctProgress = hoursTotal > 0 ? (hoursDone / hoursTotal) * 100 : (tasks.length ? (doneCount / tasks.length) * 100 : 0);

    const secBar = document.createElement('div');
    secBar.className = 'bar sector-bar';
    secBar.style.left = (((sStart - PROJECT_START) / TOTAL_MS) * 100) + '%';
    secBar.style.width = Math.max((((sFinish - sStart) / TOTAL_MS) * 100), 0.3) + '%';
    secBar.title = sector + ': ' + doneCount + '/' + tasks.length + ' · ' + hoursDone.toFixed(1) + 'h / ' + hoursTotal.toFixed(1) + 'h (' + pctProgress.toFixed(0) + '%)';

    const secFill = document.createElement('div');
    secFill.className = 'sector-bar-fill' + (pctProgress >= 99.9 ? ' complete' : (pctProgress > 0 ? ' progress' : ''));
    secFill.style.width = Math.min(100, Math.max(0, pctProgress)) + '%';
    secBar.appendChild(secFill);

    const secLabel = document.createElement('span');
    secLabel.className = 'sector-bar-pct';
    secLabel.textContent = pctProgress.toFixed(0) + '%';
    secBar.appendChild(secLabel);

    secTrack.appendChild(secBar);
    ganttTrackArea.appendChild(secTrack);

    if (collapsedState[sector]) return;

    tasks.forEach(t => {
      const rowLeft = document.createElement('div');
      rowLeft.className = 'row-left';
      rowLeft.innerHTML = `<span class="task-name" title="${t.nome}">${t.nome}</span><span class="task-tech">${t.tecnico}${t.tecnico_tipo === 'EQUIPE' ? ' ·EQ' : ''}</span>`;
      ganttLeft.appendChild(rowLeft);

      const track = document.createElement('div');
      track.className = 'gantt-row-track';
      const bar = document.createElement('div');
      bar.className = 'bar ' + (t.done ? 'status-done' : 'status-pending');
      bar.style.left = (((new Date(t.inicio) - PROJECT_START) / TOTAL_MS) * 100) + '%';
      bar.style.width = Math.max((((new Date(t.fim) - new Date(t.inicio)) / TOTAL_MS) * 100), 0.15) + '%';
      bar.title = t.nome + ' (' + t.tecnico + ', ' + t.horas + 'h)';
      track.appendChild(bar);
      ganttTrackArea.appendChild(track);
    });
  });

  if (!ganttLeft.children.length) {
    ganttLeft.innerHTML = '<div style="padding:20px;color:var(--text-dim);">Sem atividades nesta área.</div>';
  }
}


// ================= TAB: Curva S =================
function buildHourBuckets() {
  const PROJECT_START = new Date(META.projectStart);
  const PROJECT_FINISH = new Date(META.projectFinish);
  const buckets = [];
  let cur = new Date(PROJECT_START); cur.setMinutes(0, 0, 0);
  const stepMs = 3 * 3600 * 1000;
  const end = new Date(PROJECT_FINISH.getTime() + stepMs);
  while (cur <= end) { buckets.push(new Date(cur)); cur = new Date(cur.getTime() + stepMs); }
  return buckets;
}

function renderSCurve() {
  const canvas = document.getElementById('sCurveChart');
  if (!canvas) return;

  if (!META.projectStart || !META.projectFinish || TASKS.length === 0) {
    document.getElementById('plannedNowReadout').textContent = '0.0%';
    document.getElementById('realNowReadout').textContent = '0.0%';
    if (sCurveChart) { sCurveChart.destroy(); sCurveChart = null; }
    return;
  }

  const buckets = buildHourBuckets();
  const totalHours = TASKS.reduce((s, t) => s + Number(t.horas), 0);

  const planned = buckets.map(d => {
    const h = TASKS.filter(t => new Date(t.fim) <= d).reduce((s, t) => s + Number(t.horas), 0);
    return totalHours > 0 ? +(h / totalHours * 100).toFixed(2) : 0;
  });
  const real = buckets.map(d => {
    const h = TASKS.filter(t => t.done && new Date(t.fim) <= d).reduce((s, t) => s + Number(t.horas), 0);
    return totalHours > 0 ? +(h / totalHours * 100).toFixed(2) : 0;
  });
  const labels = buckets.map(d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));

  const now = new Date();
  const doneHours = TASKS.filter(t => t.done).reduce((s, t) => s + Number(t.horas), 0);
  const realNow = totalHours > 0 ? (doneHours / totalHours * 100) : 0;
  const plannedNow = totalHours > 0 ? (TASKS.filter(t => new Date(t.fim) <= now).reduce((s, t) => s + Number(t.horas), 0) / totalHours * 100) : 0;
  document.getElementById('plannedNowReadout').textContent = plannedNow.toFixed(1) + '%';
  document.getElementById('realNowReadout').textContent = realNow.toFixed(1) + '%';

  if (sCurveChart) {
    sCurveChart.data.labels = labels;
    sCurveChart.data.datasets[0].data = planned;
    sCurveChart.data.datasets[1].data = real;
    sCurveChart.update();
    return;
  }
  sCurveChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Planejado (%)', data: planned, borderColor: '#F0A430', backgroundColor: 'rgba(240,164,48,0.08)', borderWidth: 2, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2.5, fill: true, tension: 0.25 },
        { label: 'Real (%)', data: real, borderColor: '#33C481', backgroundColor: 'rgba(51,196,129,0.12)', borderWidth: 2.5, pointRadius: 2, pointHoverRadius: 5, fill: true, tension: 0.25 },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 12, right: 16, bottom: 8, left: 4 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#121821',
          titleFont: { family: 'IBM Plex Mono', size: 11 },
          bodyFont: { family: 'IBM Plex Mono', size: 12 },
          borderColor: '#232C36',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (ctx) => ' ' + ctx.dataset.label + ': ' + Number(ctx.parsed.y).toFixed(1) + '%'
          }
        }
      },
      scales: {
        x: {
          grid: { color: '#1A222B' },
          ticks: {
            color: '#8494A3',
            font: { family: 'IBM Plex Mono', size: 11 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12,
            padding: 6
          }
        },
        y: {
          min: 0,
          max: 100,
          grid: { color: '#1A222B' },
          ticks: {
            color: '#8494A3',
            font: { family: 'IBM Plex Mono', size: 11 },
            stepSize: 10,
            padding: 8,
            callback: v => v + '%'
          }
        }
      }
    }
  });
}

// ================= TAB: Equipe =================
function renderEquipe() {
  const cardsRow = document.getElementById('statusCardsRow');
  if (!cardsRow) return;

  const total = TASKS.length;
  const totalHours = TASKS.reduce((s, t) => s + Number(t.horas), 0);
  const doneTasks = TASKS.filter(t => t.done);
  const doneCount = doneTasks.length;
  const doneHours = doneTasks.reduce((s, t) => s + Number(t.horas), 0);
  const pendCount = total - doneCount;
  const pendHours = totalHours - doneHours;
  const pctHoras = totalHours > 0 ? (doneHours / totalHours * 100) : 0;
  const pctAtividades = total > 0 ? (doneCount / total * 100) : 0;

  cardsRow.innerHTML = `
    <div class="kpi">
      <div class="kpi-label">Concluídas</div>
      <div class="kpi-value green">${doneCount}</div>
      <div class="kpi-sub">${doneHours.toFixed(1)} h</div>
      <div class="mini-bar-track"><div class="mini-bar" style="background:var(--green); width:${pctAtividades.toFixed(1)}%;"></div></div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Pendentes</div>
      <div class="kpi-value amber">${pendCount}</div>
      <div class="kpi-sub">${pendHours.toFixed(1)} h</div>
      <div class="mini-bar-track"><div class="mini-bar" style="background:var(--amber); width:${(100 - pctAtividades).toFixed(1)}%;"></div></div>
    </div>
    <div class="kpi">
      <div class="kpi-label">% Horas</div>
      <div class="kpi-value" style="color:var(--blue);">${pctHoras.toFixed(1)}%</div>
      <div class="mini-bar-track" style="margin-top:9px;"><div class="mini-bar" style="background:var(--blue); width:${pctHoras.toFixed(1)}%;"></div></div>
    </div>
    <div class="kpi">
      <div class="kpi-label">% Atividades</div>
      <div class="kpi-value" style="color:var(--purple);">${pctAtividades.toFixed(1)}%</div>
      <div class="mini-bar-track" style="margin-top:9px;"><div class="mini-bar" style="background:var(--purple); width:${pctAtividades.toFixed(1)}%;"></div></div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Total Planejado</div>
      <div class="kpi-value">${total}</div>
      <div class="kpi-sub">${totalHours.toFixed(0)} h</div>
      <div class="mini-bar-track"><div class="mini-bar" style="background:var(--text-dim); width:100%;"></div></div>
    </div>
  `;

  const techBody = document.getElementById('techPanelBody');
  const rows = TEAM.slice().sort((a, b) => b.horas_planejadas - a.horas_planejadas);
  techBody.innerHTML = rows.length
    ? rows.map(d => {
      const planned = Number(d.horas_planejadas) || 0;
      const done = Number(d.horas_concluidas) || 0;
      const pct = planned > 0 ? (done / planned * 100) : 0;
      const color = pct >= 99.9 ? 'var(--green)' : 'var(--amber)';
      const isEquipe = d.tecnico_tipo === 'EQUIPE';
      const label = isEquipe
        ? `${d.tecnico} <span class="badge-equipe">EQUIPE</span>`
        : d.tecnico;
      return `
        <div style="display:flex; align-items:center; gap:14px; padding:6px 0; border-bottom:1px solid var(--border-soft); flex-wrap:wrap;">
          <div style="width:110px; font-family:var(--font-mono); font-size:12px;">${label}</div>
          <div style="flex:1; min-width:120px; height:14px; background:var(--panel-alt); border-radius:3px; overflow:hidden;">
            <div style="height:100%; width:${pct.toFixed(1)}%; background:${color};"></div>
          </div>
          <div style="width:140px; text-align:right; font-family:var(--font-mono); font-size:11px; color:var(--text-muted);">${done.toFixed(1)}h / ${planned.toFixed(1)}h</div>
          <div style="width:80px; text-align:right; font-family:var(--font-mono); font-size:11px; color:var(--text-dim);">${d.tarefas_concluidas}/${d.total_tarefas}</div>
          <div style="width:46px; text-align:right; font-family:var(--font-mono); font-size:13px; font-weight:600; color:${color};">${pct.toFixed(0)}%</div>
        </div>`;
    }).join('')
    : '<div style="padding:12px;color:var(--text-dim);">Nenhum responsável nesta área ainda.</div>';
}

// ================= Import cronograma (admin) =================
document.getElementById('importBtn')?.addEventListener('click', () => {
  document.getElementById('importFileInput').click();
});
document.getElementById('importFileInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    if (!json.area) {
      const use = confirm(
        'O JSON não tem o campo "area".\\nUsar a área atual (' + CURRENT_AREA + ')?'
      );
      if (!use) { e.target.value = ''; return; }
      json.area = CURRENT_AREA;
    }
    const data = await api('/api/import', { method: 'POST', body: JSON.stringify(json) });
    alert('Cronograma importado: ' + data.totalTarefas + ' atividades em ' + (AREA_LABELS[data.area] || data.area) + '.');
    if (data.area && data.area !== CURRENT_AREA) {
      CURRENT_AREA = data.area;
      localStorage.setItem('pcm_area', CURRENT_AREA);
      syncAreaSwitcher();
    }
    collapsedState = {};
    if (sCurveChart) { sCurveChart.destroy(); sCurveChart = null; }
    await reloadData();
    renderAll();
  } catch (err) {
    alert('Erro ao importar arquivo: ' + err.message);
  } finally {
    e.target.value = '';
  }
});

// ================= Reset (admin) — scoped to current area =================
const resetModal = document.getElementById('resetModalOverlay');
document.getElementById('resetBtn')?.addEventListener('click', () => {
  document.getElementById('resetPasswordInput').value = '';
  document.getElementById('resetErrorMsg').classList.add('hidden');
  document.getElementById('resetAreaLabel').textContent = AREA_LABELS[CURRENT_AREA] || CURRENT_AREA;
  resetModal.classList.remove('hidden');
  document.getElementById('resetPasswordInput').focus();
});
document.getElementById('resetCancelBtn').addEventListener('click', () => resetModal.classList.add('hidden'));
resetModal.addEventListener('click', (e) => { if (e.target === resetModal) resetModal.classList.add('hidden'); });
document.getElementById('resetConfirmBtn').addEventListener('click', async () => {
  const pw = document.getElementById('resetPasswordInput').value;
  try {
    await api('/api/reset?area=' + encodeURIComponent(CURRENT_AREA), {
      method: 'POST',
      body: JSON.stringify({ password: pw, area: CURRENT_AREA }),
    });
    resetModal.classList.add('hidden');
    await reloadData();
    renderAll();
  } catch (e) {
    document.getElementById('resetErrorMsg').textContent = e.message;
    document.getElementById('resetErrorMsg').classList.remove('hidden');
  }
});
document.getElementById('resetPasswordInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('resetConfirmBtn').click();
});

// ================= Init =================
(async function init() {
  await tryRestoreSession();
  await boot();
})();
