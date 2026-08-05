const { pool } = require('./db');
const { buildBackupPayload } = require('./backup');
const googleDrive = require('./googleDrive');

const META_KEY = 'system:last_auto_backup_slot';

// Horários do backup automático, em UTC (0-23), separados por vírgula.
// Padrão: a cada 6h (4x/dia) — 00h, 06h, 12h, 18h UTC, que em Mato Grosso
// (UTC-4) caem por volta de 20h, 02h, 08h e 14h. Sobrescreva com a variável
// de ambiente BACKUP_HOURS_UTC no Render, ex.: "0,4,8,12,16,20" para 6x/dia.
const BACKUP_HOURS_UTC = (process.env.BACKUP_HOURS_UTC || '0,6,12,18')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(n => Number.isFinite(n) && n >= 0 && n <= 23);

let running = false; // trava simples contra execuções concorrentes

async function getLastRunSlot() {
  const { rows } = await pool.query('SELECT value FROM meta WHERE key = $1', [META_KEY]);
  return rows[0]?.value || null;
}

async function setLastRunSlot(slot) {
  await pool.query(
    `INSERT INTO meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [META_KEY, slot]
  );
}

/** Gera o backup e envia ao Google Drive agora, independente do horário/trava de agendamento. */
async function runBackupNow() {
  const payload = await buildBackupPayload();
  const filename = `pcm_backup_auto_${new Date().toISOString().slice(0, 10)}_${String(new Date().getUTCHours()).padStart(2, '0')}h.json`;
  const file = await googleDrive.uploadBackupToDrive(filename, JSON.stringify(payload, null, 2));
  return file;
}

/** Chamado periodicamente: só executa se a hora atual estiver na lista configurada e esse "slot" (dia+hora) ainda não tiver rodado. */
async function checkAndRunScheduled() {
  if (running) return;
  if (!(await googleDrive.isConfigured())) return; // recurso desligado até o admin conectar o Google Drive

  const now = new Date();
  if (!BACKUP_HOURS_UTC.includes(now.getUTCHours())) return;

  const slot = `${now.toISOString().slice(0, 10)}:${now.getUTCHours()}`; // ex.: 2026-08-04:12
  const lastSlot = await getLastRunSlot();
  if (lastSlot === slot) return; // esse horário já rodou hoje

  running = true;
  try {
    const file = await runBackupNow();
    await setLastRunSlot(slot);
    console.log('[backup] Backup automático enviado ao Google Drive:', file.name, file.webViewLink || '');
  } catch (e) {
    console.error('[backup] Falha no backup automático para o Google Drive:', e.message);
    // Não marca o slot como concluído — tenta de novo na próxima checagem (ainda dentro da mesma hora).
  } finally {
    running = false;
  }
}

async function startScheduler() {
  if (!googleDrive.oauthClientConfigured()) {
    console.log('[backup] Backup automático para Google Drive desativado (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET não configurados).');
    return;
  }
  console.log(`[backup] Credenciais OAuth do Google detectadas — backup automático roda ${BACKUP_HOURS_UTC.length}x/dia (${BACKUP_HOURS_UTC.join('h, ')}h UTC) assim que o admin conectar o Google Drive pelo painel.`);
  checkAndRunScheduled().catch(e => console.error('[backup] erro na checagem inicial:', e.message));
  setInterval(() => {
    checkAndRunScheduled().catch(e => console.error('[backup] erro na checagem periódica:', e.message));
  }, 10 * 60 * 1000); // checa a cada 10 minutos
}

module.exports = { startScheduler, runBackupNow };
