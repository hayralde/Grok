const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false),
});

const SEED = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'seed_data.json'), 'utf8')
);

const AREAS = ['ELETRICA', 'MECANICA', 'TGM'];
const DEFAULT_AREA = 'ELETRICA';

const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DEFAULT_SUPERVISOR_PASSWORD = process.env.SUPERVISOR_PASSWORD || 'super123';
const DEFAULT_OPERATOR_PASSWORD = process.env.OPERATOR_PASSWORD || '1234';

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      role TEXT,
      nome TEXT,
      tecnico TEXT
    );
  `);

  // Garante colunas do schema atual (tabelas antigas/parciais no Render)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'password_hash'
      ) THEN
        ALTER TABLE users ADD COLUMN password_hash TEXT;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'role'
      ) THEN
        ALTER TABLE users ADD COLUMN role TEXT;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'nome'
      ) THEN
        ALTER TABLE users ADD COLUMN nome TEXT;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'tecnico'
      ) THEN
        ALTER TABLE users ADD COLUMN tecnico TEXT;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'area_scope'
      ) THEN
        ALTER TABLE users ADD COLUMN area_scope TEXT;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'username'
      ) THEN
        ALTER TABLE users ADD COLUMN username TEXT;
      END IF;
    END $$;
  `);

  // Legacy single-area schema (may already exist from previous deploys)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      setor TEXT NOT NULL,
      tag TEXT,
      descricao TEXT,
      nome TEXT NOT NULL,
      tecnico TEXT NOT NULL,
      inicio TIMESTAMPTZ NOT NULL,
      fim TIMESTAMPTZ NOT NULL,
      horas NUMERIC NOT NULL,
      done BOOLEAN NOT NULL DEFAULT FALSE,
      done_by TEXT,
      done_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // ---- Multi-area migration ----
  // Add area column if missing
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tasks' AND column_name = 'area'
      ) THEN
        ALTER TABLE tasks ADD COLUMN area TEXT;
        UPDATE tasks SET area = '${DEFAULT_AREA}' WHERE area IS NULL;
        ALTER TABLE tasks ALTER COLUMN area SET NOT NULL;
        ALTER TABLE tasks ALTER COLUMN area SET DEFAULT '${DEFAULT_AREA}';
        -- Drop old single-column PK and create composite PK
        ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_pkey;
        ALTER TABLE tasks ADD PRIMARY KEY (area, id);
      END IF;
    END $$;
  `);

  // tecnico_tipo: PESSOA (default) | EQUIPE — allows shift/team labels with overlap
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tasks' AND column_name = 'tecnico_tipo'
      ) THEN
        ALTER TABLE tasks ADD COLUMN tecnico_tipo TEXT NOT NULL DEFAULT 'PESSOA';
      END IF;
    END $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tasks_tecnico_tipo_check'
      ) THEN
        ALTER TABLE tasks ADD CONSTRAINT tasks_tecnico_tipo_check
          CHECK (tecnico_tipo IN ('PESSOA','EQUIPE'));
      END IF;
    END $$;
  `);

  // Ensure check constraint on area
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tasks_area_check'
      ) THEN
        ALTER TABLE tasks ADD CONSTRAINT tasks_area_check
          CHECK (area IN ('ELETRICA','MECANICA','TGM'));
      END IF;
    END $$;
  `);

  // Migrate legacy flat meta keys into area-scoped keys for ELETRICA
  const { rows: legacyMeta } = await pool.query(
    `SELECT key, value FROM meta WHERE key IN ('projectStart','projectFinish','sectorOrder')`
  );
  if (legacyMeta.length > 0) {
    for (const r of legacyMeta) {
      await pool.query(
        `INSERT INTO meta (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO NOTHING`,
        [`${DEFAULT_AREA}:${r.key}`, r.value]
      );
    }
    await pool.query(
      `DELETE FROM meta WHERE key IN ('projectStart','projectFinish','sectorOrder')`
    );
  }

  // Seed ELETRICA tasks only if that area is empty
  const { rows: taskCount } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM tasks WHERE area = $1`,
    [DEFAULT_AREA]
  );
  if (taskCount[0].n === 0) {
    console.log('Semeando', SEED.tasks.length, 'tarefas em', DEFAULT_AREA, '...');
    for (const t of SEED.tasks) {
      await pool.query(
        `INSERT INTO tasks (area, id, setor, tag, descricao, nome, tecnico, inicio, fim, horas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (area, id) DO NOTHING`,
        [DEFAULT_AREA, t.id, t.setor, t.tag, t.descricao, t.nome, t.tecnico, t.inicio, t.fim, t.horas]
      );
    }
    await pool.query(
      `INSERT INTO meta (key, value) VALUES ($1,$2),($3,$4),($5,$6)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [
        `${DEFAULT_AREA}:projectStart`, SEED.projectStart,
        `${DEFAULT_AREA}:projectFinish`, SEED.projectFinish,
        `${DEFAULT_AREA}:sectorOrder`, JSON.stringify(SEED.sectorOrder),
      ]
    );
  }

  // area_scope: NULL = todas as áreas; ELETRICA|MECANICA|TGM = restrito
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'area_scope'
      ) THEN
        ALTER TABLE users ADD COLUMN area_scope TEXT;
      END IF;
    END $$;
  `);

  // Ensure empty meta stubs exist for other areas (so UI doesn't break)
  for (const area of AREAS) {
    if (area === DEFAULT_AREA) continue;
    const { rows } = await pool.query(
      `SELECT 1 FROM meta WHERE key = $1`,
      [`${area}:projectStart`]
    );
    if (rows.length === 0) {
      await pool.query(
        `INSERT INTO meta (key, value) VALUES ($1,$2),($3,$4),($5,$6)
         ON CONFLICT (key) DO NOTHING`,
        [
          `${area}:projectStart`, SEED.projectStart,
          `${area}:projectFinish`, SEED.projectFinish,
          `${area}:sectorOrder`, JSON.stringify([]),
        ]
      );
    }
  }

  const { rows: userCount } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (userCount[0].n === 0) {
    console.log('Semeando usuarios...');
    const adminHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, role, nome, tecnico) VALUES ($1,$2,$3,$4,NULL)`,
      ['admin', adminHash, 'admin', 'Administrador']
    );
    const supHash = await bcrypt.hash(DEFAULT_SUPERVISOR_PASSWORD, 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, role, nome, tecnico) VALUES ($1,$2,$3,$4,NULL)`,
      ['supervisor', supHash, 'supervisor', 'Supervisor PCM']
    );
    const opHash = await bcrypt.hash(DEFAULT_OPERATOR_PASSWORD, 10);
    for (const tec of SEED.tecnicos) {
      const username = tec.toLowerCase();
      await pool.query(
        `INSERT INTO users (username, password_hash, role, nome, tecnico) VALUES ($1,$2,$3,$4,$5)`,
        [username, opHash, 'operador', tec, tec]
      );
    }
    console.log('Usuarios criados: admin, supervisor, e', SEED.tecnicos.length, 'operadores.');
  } else {
    // Repara usuários sem senha (schema antigo / tabela parcial)
    const adminHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
    const supHash = await bcrypt.hash(DEFAULT_SUPERVISOR_PASSWORD, 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, role, nome, tecnico)
       VALUES ('admin', $1, 'admin', 'Administrador', NULL)
       ON CONFLICT (username) DO UPDATE SET
         password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash),
         role = COALESCE(users.role, EXCLUDED.role),
         nome = COALESCE(users.nome, EXCLUDED.nome)`,
      [adminHash]
    );
    await pool.query(
      `INSERT INTO users (username, password_hash, role, nome, tecnico)
       VALUES ('supervisor', $1, 'supervisor', 'Supervisor PCM', NULL)
       ON CONFLICT (username) DO UPDATE SET
         password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash),
         role = COALESCE(users.role, EXCLUDED.role),
         nome = COALESCE(users.nome, EXCLUDED.nome)`,
      [supHash]
    );
  }

  // Garante usuário supertgm (supervisor só da área TGM) — mesmo se a tabela já tinha usuários
  const supTgmHash = await bcrypt.hash(DEFAULT_SUPERVISOR_PASSWORD, 10);
  const { rows: st } = await pool.query(`SELECT id FROM users WHERE username = 'supertgm'`);
  if (st.length === 0) {
    await pool.query(
      `INSERT INTO users (username, password_hash, role, nome, tecnico, area_scope)
       VALUES ($1,$2,'supervisor',$3,NULL,'TGM')`,
      ['supertgm', supTgmHash, 'Supervisor TGM']
    );
    console.log('Usuario supertgm criado (supervisor restrito à área TGM).');
  } else {
    await pool.query(
      `UPDATE users SET role = 'supervisor', nome = 'Supervisor TGM', area_scope = 'TGM',
        password_hash = COALESCE(password_hash, $1)
       WHERE username = 'supertgm'`,
      [supTgmHash]
    );
  }
}

function normalizeArea(raw) {
  if (!raw) return null;
  const a = String(raw).trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (a === 'ELETRICA' || a === 'ELECTRICA') return 'ELETRICA';
  if (a === 'MECANICA' || a === 'MECHANICA') return 'MECANICA';
  if (a === 'TGM') return 'TGM';
  return null;
}

module.exports = { pool, init, AREAS, DEFAULT_AREA, normalizeArea };
