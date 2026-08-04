const { pool } = require('./db');
const { buildBackupPayload } = require('./backup');
const googleDrive = require('./googleDrive');

const META_KEY = 'system:last_auto_backup_date';
// Hora do backup automático, em UTC (0-23). Padrão 06:00 UTC ≈ 02:00 em
// Mato Grosso (UTC-4) — fora do horário de uso do painel. Pode ser
// sobrescrito com a variável de ambiente BACKUP_HOUR_UTC no Render.
const BACKUP_HOUR_UTC = Number.isFinite(Number(process.env.BACKUP_HOUR_UTC))
  ? Number(process.env.BACKUP_HOUR_UTC)
  : 6;

let running = false; // trava simples contra execuções concorrentes

async function getLastRunDate() {
  const { rows } = await pool.query('SELECT value FROM meta WHERE key = $1', [META_KEY]);
  return rows[0]?.value || null;
}

async function setLastRunDate(dateStr) {
  await pool.query(
    `INSERT INTO meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [META_KEY, dateStr]
  );
}

/** Gera o backup e envia ao Google Drive agora, independente do horário/trava diária. */
async function runBackupNow() {
  const payload = await buildBackupPayload();
  const filename = `pcm_backup_auto_${new Date().toISOString().slice(0, 10)}.json`;
  const file = await googleDrive.uploadBackupToDrive(filename, JSON.stringify(payload, null, 2));
  return file;
}

/** Chamado periodicamente: só executa se estiver no horário configurado e ainda não tiver rodado hoje. */
async function checkAndRunScheduled() {
  if (running) return;
  if (!(await googleDrive.isConfigured())) return; // recurso desligado até o admin conectar o Google Drive

  const now = new Date();
  if (now.getUTCHours() !== BACKUP_HOUR_UTC) return;

  const todayKey = now.toISOString().slice(0, 10);
  const lastRun = await getLastRunDate();
  if (lastRun === todayKey) return; // já rodou hoje

  running = true;
  try {
    const file = await runBackupNow();
    await setLastRunDate(todayKey);
    console.log('[backup] Backup automático enviado ao Google Drive:', file.name, file.webViewLink || '');
  } catch (e) {
    console.error('[backup] Falha no backup automático para o Google Drive:', e.message);
    // Não marca a data como concluída — tenta de novo na próxima checagem (ainda dentro da mesma hora).
  } finally {
    running = false;
  }
}

async function startScheduler() {
  if (!googleDrive.oauthClientConfigured()) {
    console.log('[backup] Backup automático para Google Drive desativado (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET não configurados).');
    return;
  }
  console.log(`[backup] Credenciais OAuth do Google detectadas — backup automático roda 1x/dia às ${BACKUP_HOUR_UTC}h UTC assim que o admin conectar o Google Drive pelo painel.`);
  checkAndRunScheduled().catch(e => console.error('[backup] erro na checagem inicial:', e.message));
  setInterval(() => {
    checkAndRunScheduled().catch(e => console.error('[backup] erro na checagem periódica:', e.message));
  }, 10 * 60 * 1000); // checa a cada 10 minutos
}

module.exports = { startScheduler, runBackupNow };
