const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');

const { pool, init, AREAS, DEFAULT_AREA, normalizeArea } = require('./db');
const { signToken, authRequired, authOptional, requireRole } = require('./auth');
const { getAreaConfig, listAreas } = require('./areaConfig');

const RESET_PASSWORD = process.env.RESET_PASSWORD || '654321';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

function resolveArea(req) {
  const raw = (req.query && req.query.area) || (req.body && req.body.area) || DEFAULT_AREA;
  const area = normalizeArea(raw);
  if (!area) return null;
  return area;
}

/** Se o usuário tem area_scope, só pode operar nessa área. */
function enforceUserArea(req, area) {
  if (!req.user || !req.user.area_scope) return null;
  const scoped = normalizeArea(req.user.area_scope);
  if (scoped && area !== scoped) {
    return `Acesso restrito à área ${scoped}.`;
  }
  return null;
}

// ---------- Auth ----------
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Usuario e senha obrigatorios' });

    const uname = String(username).trim().toLowerCase();
    const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(username) = $1', [uname]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Usuario ou senha invalidos' });
    if (!user.password_hash) {
      return res.status(401).json({ error: 'Conta sem senha configurada. Reinicie o serviço ou contate o admin.' });
    }

    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Usuario ou senha invalidos' });

    const token = signToken(user);
    res.json({
      token,
      user: {
        username: user.username,
        role: user.role,
        nome: user.nome,
        tecnico: user.tecnico,
        area_scope: user.area_scope || null,
      },
    });
  } catch (e) {
    console.error('Erro no login:', e);
    res.status(500).json({ error: 'Erro interno no login' });
  }
});

app.get('/api/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/areas', (_req, res) => {
  res.json({ areas: listAreas(), default: DEFAULT_AREA });
});

// ---------- Meta (public read) ----------
app.get('/api/meta', authOptional, async (req, res) => {
  const area = resolveArea(req);
  if (!area) return res.status(400).json({ error: 'Area invalida. Use ELETRICA, MECANICA ou TGM.' });
  const denied = enforceUserArea(req, area);
  if (denied) return res.status(403).json({ error: denied });

  const { rows } = await pool.query(
    `SELECT key, value FROM meta WHERE key LIKE $1`,
    [area + ':%']
  );
  const meta = {};
  rows.forEach(r => {
    const short = r.key.slice(area.length + 1);
    meta[short] = r.value;
  });
  const cfg = getAreaConfig(area);
  res.json({
    area,
    projectStart: meta.projectStart || null,
    projectFinish: meta.projectFinish || null,
    sectorOrder: meta.sectorOrder ? JSON.parse(meta.sectorOrder) : [],
    config: cfg ? {
      label: cfg.label,
      defaultTecnicoTipo: cfg.defaultTecnicoTipo,
      allowOverlap: cfg.allowOverlap,
      operatorLoginRequired: cfg.operatorLoginRequired,
      helpText: cfg.helpText,
      hoursChartTitle: cfg.hoursChartTitle,
      hoursChartSub: cfg.hoursChartSub,
      responsibleLabel: cfg.responsibleLabel,
      doneByRoles: cfg.doneByRoles,
    } : null,
  });
});

// ---------- Tasks (public read; operador logged-in sees only own tasks) ----------
app.get('/api/tasks', authOptional, async (req, res) => {
  const area = resolveArea(req);
  if (!area) return res.status(400).json({ error: 'Area invalida. Use ELETRICA, MECANICA ou TGM.' });
  const denied = enforceUserArea(req, area);
  if (denied) return res.status(403).json({ error: denied });

  let query = 'SELECT * FROM tasks WHERE area = $1 ORDER BY id ASC';
  let params = [area];

  if (req.user && req.user.role === 'operador') {
    query = 'SELECT * FROM tasks WHERE area = $1 AND tecnico = $2 ORDER BY id ASC';
    params = [area, req.user.tecnico];
  }

  const { rows } = await pool.query(query, params);
  res.json({ area, tasks: rows });
});

// Toggle done — requires login
app.patch('/api/tasks/:id', authRequired, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const area = resolveArea(req);
  if (!area) return res.status(400).json({ error: 'Area invalida. Use ELETRICA, MECANICA ou TGM.' });
  const denied = enforceUserArea(req, area);
  if (denied) return res.status(403).json({ error: denied });

  const { done } = req.body || {};
  if (typeof done !== 'boolean') return res.status(400).json({ error: '"done" deve ser true/false' });

  const { rows: existingRows } = await pool.query(
    'SELECT * FROM tasks WHERE area = $1 AND id = $2',
    [area, id]
  );
  const task = existingRows[0];
  if (!task) return res.status(404).json({ error: 'Tarefa nao encontrada' });

  if (req.user.role === 'operador' && task.tecnico !== req.user.tecnico) {
    return res.status(403).json({ error: 'Voce so pode alterar suas proprias atividades' });
  }

  const doneBy = done ? req.user.nome : null;
  const doneAt = done ? new Date().toISOString() : null;

  const { rows } = await pool.query(
    `UPDATE tasks SET done = $1, done_by = $2, done_at = $3
     WHERE area = $4 AND id = $5 RETURNING *`,
    [done, doneBy, doneAt, area, id]
  );
  const updated = rows[0];

  io.emit('task-updated', updated);
  res.json({ task: updated });
});

// ---------- Reset progress (admin only + password) — scoped to area ----------
app.post('/api/reset', authRequired, requireRole('admin'), async (req, res) => {
  const { password } = req.body || {};
  if (password !== RESET_PASSWORD) return res.status(401).json({ error: 'Senha incorreta' });

  const area = resolveArea(req);
  if (!area) return res.status(400).json({ error: 'Area invalida. Use ELETRICA, MECANICA ou TGM.' });

  await pool.query(
    `UPDATE tasks SET done = FALSE, done_by = NULL, done_at = NULL WHERE area = $1`,
    [area]
  );
  io.emit('progress-reset', { area });
  res.json({ ok: true, area });
});

// ---------- Team summary (public read) ----------
app.get('/api/team', authOptional, async (req, res) => {
  const area = resolveArea(req);
  if (!area) return res.status(400).json({ error: 'Area invalida. Use ELETRICA, MECANICA ou TGM.' });
  const denied = enforceUserArea(req, area);
  if (denied) return res.status(403).json({ error: denied });

  const { rows } = await pool.query(`
    SELECT tecnico,
           COALESCE(MAX(tecnico_tipo), 'PESSOA') AS tecnico_tipo,
           COUNT(*)::int AS total_tarefas,
           COUNT(*) FILTER (WHERE done)::int AS tarefas_concluidas,
           COALESCE(SUM(horas), 0)::float AS horas_planejadas,
           COALESCE(SUM(horas) FILTER (WHERE done), 0)::float AS horas_concluidas
    FROM tasks
    WHERE area = $1
    GROUP BY tecnico
    ORDER BY horas_planejadas DESC
  `, [area]);
  res.json({ area, team: rows });
});

// ---------- Users (admin only) ----------
app.get('/api/users', authRequired, requireRole('admin'), async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, username, role, nome, tecnico FROM users ORDER BY role, username'
  );
  res.json({ users: rows });
});

// ---------- Import cronograma (admin only) — routes by "area" field ----------
// Body: { area, projectStart, projectFinish, sectorOrder, tasks: [...] }
// Only the matching area is replaced; the other two are left untouched.
function normalizeTecnicoTipo(raw, areaDefault) {
  if (raw === undefined || raw === null || raw === '') {
    return areaDefault === 'EQUIPE' ? 'EQUIPE' : 'PESSOA';
  }
  const v = String(raw).trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (v === 'EQUIPE' || v === 'TURNO' || v === 'FORNECEDOR' || v === 'TIME') return 'EQUIPE';
  if (v === 'PESSOA' || v === 'OPERADOR' || v === 'TECNICO') return 'PESSOA';
  return null;
}

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

app.post('/api/import', authRequired, requireRole('admin'), async (req, res) => {
  const body = req.body || {};
  const area = normalizeArea(body.area);
  if (!area) {
    return res.status(400).json({
      error: 'Campo "area" obrigatorio e deve ser ELETRICA, MECANICA ou TGM.',
    });
  }

  // Trava: disciplina do arquivo deve coincidir com a disciplina ativa no painel (query area)
  const expected = normalizeArea(req.query && req.query.area);
  if (expected && expected !== area) {
    return res.status(400).json({
      error: 'Disciplina divergente: o arquivo e de ' + area
        + ', mas o painel esta em ' + expected
        + '. Selecione a disciplina correta no header ou use o JSON da disciplina ' + expected + '.',
    });
  }
  if (!expected) {
    return res.status(400).json({
      error: 'Informe a disciplina ativa do painel (query area=ELETRICA|MECANICA|TGM) para validar o import.',
    });
  }

  const deniedImport = enforceUserArea(req, area);
  if (deniedImport) return res.status(403).json({ error: deniedImport });

  const areaCfg = getAreaConfig(area);
  if (!areaCfg) {
    return res.status(400).json({ error: 'Configuracao da area nao encontrada.' });
  }

  const { projectStart, projectFinish, sectorOrder, tasks } = body;

  if (!projectStart || !projectFinish || !Array.isArray(sectorOrder) || !Array.isArray(tasks)) {
    return res.status(400).json({
      error: 'JSON invalido. Esperado: { area, projectStart, projectFinish, sectorOrder: [], tasks: [] }',
    });
  }
  if (tasks.length === 0) {
    return res.status(400).json({ error: 'A lista de tarefas ("tasks") esta vazia.' });
  }

  const requiredFields = ['id', 'setor', 'tag', 'descricao', 'tecnico', 'inicio', 'fim', 'horas'];
  const normalized = [];
  const seenIds = new Set();

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    for (const f of requiredFields) {
      if (t[f] === undefined || t[f] === null || t[f] === '') {
        return res.status(400).json({
          error: `Tarefa na posicao ${i} esta sem o campo obrigatorio "${f}".`,
        });
      }
    }
    const inicioMs = new Date(t.inicio).getTime();
    const fimMs = new Date(t.fim).getTime();
    if (isNaN(inicioMs) || isNaN(fimMs)) {
      return res.status(400).json({
        error: `Tarefa id=${t.id}: "inicio" ou "fim" nao e uma data valida (use ISO 8601).`,
      });
    }
    if (fimMs <= inicioMs) {
      return res.status(400).json({
        error: `Tarefa id=${t.id}: "fim" deve ser posterior a "inicio".`,
      });
    }
    if (seenIds.has(t.id)) {
      return res.status(400).json({ error: `id duplicado no arquivo: ${t.id}` });
    }
    seenIds.add(t.id);

    // tecnicoTipo: se omitido, usa o padrão da ÁREA (TGM→EQUIPE, demais→PESSOA)
    const rawTipo = t.tecnicoTipo !== undefined ? t.tecnicoTipo
      : (t.tecnico_tipo !== undefined ? t.tecnico_tipo : undefined);
    const tipo = normalizeTecnicoTipo(rawTipo, areaCfg.defaultTecnicoTipo);
    if (!tipo) {
      return res.status(400).json({
        error: `Tarefa id=${t.id}: tecnicoTipo invalido (use PESSOA ou EQUIPE).`,
      });
    }

    normalized.push({
      id: t.id,
      setor: t.setor,
      tag: t.tag,
      descricao: t.descricao,
      nome: t.nome || [t.tag, t.descricao].filter(Boolean).join(' - '),
      tecnico: String(t.tecnico).trim(),
      tecnico_tipo: tipo,
      inicio: t.inicio,
      fim: t.fim,
      inicioMs,
      fimMs,
      horas: t.horas,
    });
  }

  // Sobreposição: só valida se a CONFIG DA ÁREA não permite overlap
  // (ELETRICA/MECANICA: false → checa PESSOA; TGM: true → não checa)
  if (!areaCfg.allowOverlap) {
    const byPerson = {};
    for (const t of normalized) {
      // No modo restrito, só pessoas físicas entram na checagem;
      // EQUIPE explícito na tarefa ainda pode coexistir se alguém mandar, mas
      // o padrão da área já força PESSOA quando omitido.
      if (t.tecnico_tipo === 'EQUIPE') continue;
      const key = t.tecnico.toUpperCase();
      if (!byPerson[key]) byPerson[key] = [];
      byPerson[key].push(t);
    }
    for (const [name, list] of Object.entries(byPerson)) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          if (intervalsOverlap(a.inicioMs, a.fimMs, b.inicioMs, b.fimMs)) {
            return res.status(400).json({
              error: `Sobreposicao de tecnico na area ${area} (modo sem sobreposicao): id ${a.id} e id ${b.id} (${name}).`,
            });
          }
        }
      }
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM tasks WHERE area = $1', [area]);
    for (const t of normalized) {
      await client.query(
        `INSERT INTO tasks (area, id, setor, tag, descricao, nome, tecnico, tecnico_tipo, inicio, fim, horas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [area, t.id, t.setor, t.tag, t.descricao, t.nome, t.tecnico, t.tecnico_tipo, t.inicio, t.fim, t.horas]
      );
    }
    await client.query(
      `INSERT INTO meta (key, value) VALUES ($1,$2),($3,$4),($5,$6)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [
        `${area}:projectStart`, projectStart,
        `${area}:projectFinish`, projectFinish,
        `${area}:sectorOrder`, JSON.stringify(sectorOrder),
      ]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Erro ao importar: ' + err.message });
  } finally {
    client.release();
  }

  const equipes = normalized.filter(t => t.tecnico_tipo === 'EQUIPE').length;
  io.emit('cronograma-importado', { area });
  res.json({
    ok: true,
    area,
    areaLabel: areaCfg.label,
    modoPadrao: areaCfg.defaultTecnicoTipo,
    allowOverlap: areaCfg.allowOverlap,
    totalTarefas: normalized.length,
    tarefasEquipe: equipes,
    tarefasPessoa: normalized.length - equipes,
  });
});

// ---------- Static frontend ----------
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ---------- Socket.io ----------
io.on('connection', (socket) => {
  socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;

init()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Servidor rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Erro ao iniciar (verifique DATABASE_URL):', err);
    process.exit(1);
  });
