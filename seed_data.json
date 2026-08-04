const { pool } = require('./db');
const pkg = require('../package.json');

/**
 * Monta o dump completo do banco em memória: descobre as tabelas do schema
 * public dinamicamente e devolve cada uma com suas linhas. Usado tanto pelo
 * download manual (GET /api/admin/backup) quanto pelo backup automático
 * (server/backupScheduler.js).
 */
async function buildBackupPayload() {
  const { rows: tableRows } = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  const tabelas = {};
  for (const { table_name } of tableRows) {
    const { rows } = await pool.query(`SELECT * FROM "${table_name}"`);
    tabelas[table_name] = rows;
  }

  return {
    app: 'PCM',
    versao: pkg.version,
    geradoEm: new Date().toISOString(),
    tabelas,
  };
}

function backupFilename(prefix = 'pcm_backup') {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}_${ts}.json`;
}

module.exports = { buildBackupPayload, backupFilename };
