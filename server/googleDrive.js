const { Readable } = require('stream');
const { pool } = require('./db');

/**
 * Integração com Google Drive via OAuth2 "login com Google" (conta pessoal do
 * admin), NÃO via Service Account.
 *
 * Por quê: desde 2023/2024 o Google deu cota 0GB para Service Accounts e
 * bloqueou o antigo truque de "compartilhar uma pasta pessoal como Editor com
 * a Service Account" — hoje isso sempre falha com "Service Accounts do not
 * have storage quota", mesmo com a pasta corretamente compartilhada. As
 * alternativas oficiais do Google (Shared Drives / domain-wide delegation)
 * só existem em contas Google Workspace pagas, não em Gmail comum.
 *
 * A solução para conta Gmail pessoal é autenticar como o próprio usuário
 * (fluxo OAuth2 "Conectar com Google", feito uma única vez pelo admin no
 * painel) e guardar o refresh_token resultante — os backups automáticos
 * reusam esse refresh_token pra gerar novos access tokens sozinhos,
 * indefinidamente, sem precisar logar de novo.
 *
 * Pré-requisitos no Google Cloud Console (ver README):
 *   1. Ativar a "Google Drive API".
 *   2. Criar credencial OAuth 2.0 Client ID, tipo "Aplicativo da Web", com o
 *      redirect URI apontando para /api/admin/google-auth/callback do PCM.
 *
 * Variáveis de ambiente:
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_DRIVE_FOLDER_ID  (opcional — se não definida, o próprio app cria
 *                            e reaproveita uma pasta "PCM Backups" na raiz do
 *                            Drive da conta conectada)
 *
 * O refresh_token e o ID da pasta auto-criada ficam guardados na tabela
 * `meta` do banco (chaves 'system:google_refresh_token' e
 * 'system:google_drive_folder_id'), não em variável de ambiente — assim o
 * admin só precisa clicar em "Conectar Google Drive" uma vez no painel.
 */

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];

const META_REFRESH_TOKEN = 'system:google_refresh_token';
const META_FOLDER_ID = 'system:google_drive_folder_id';
const META_CONNECTED_EMAIL = 'system:google_connected_email';

async function getMeta(key) {
  const { rows } = await pool.query('SELECT value FROM meta WHERE key = $1', [key]);
  return rows[0]?.value || null;
}
async function setMeta(key, value) {
  await pool.query(
    `INSERT INTO meta (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}
async function deleteMeta(key) {
  await pool.query('DELETE FROM meta WHERE key = $1', [key]);
}

function oauthClientConfigured() {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

function getOAuth2Client(redirectUri) {
  const { google } = require('googleapis');
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri
  );
}

/** URL para onde o navegador do admin deve ser redirecionado para autorizar o acesso. */
function getAuthUrl(redirectUri, state) {
  const client = getOAuth2Client(redirectUri);
  return client.generateAuthUrl({
    access_type: 'offline', // necessário para receber refresh_token
    prompt: 'consent',      // força reconsentimento -> garante novo refresh_token mesmo se já autorizou antes
    scope: SCOPES,
    state,
  });
}

/** Troca o "code" devolvido pelo Google por tokens, guarda o refresh_token e o e-mail conectado. */
async function completeAuth(code, redirectUri) {
  const { google } = require('googleapis');
  const client = getOAuth2Client(redirectUri);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('O Google não retornou um refresh_token. Revogue o acesso em myaccount.google.com/permissions e tente conectar de novo.');
  }
  await setMeta(META_REFRESH_TOKEN, tokens.refresh_token);

  client.setCredentials(tokens);
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();
    if (data.email) await setMeta(META_CONNECTED_EMAIL, data.email);
    return data.email || null;
  } catch (_) {
    return null;
  }
}

async function isConfigured() {
  if (!oauthClientConfigured()) return false;
  const refreshToken = await getMeta(META_REFRESH_TOKEN);
  return !!refreshToken;
}

async function getStatus() {
  return {
    oauthClientConfigured: oauthClientConfigured(),
    connected: await isConfigured(),
    email: await getMeta(META_CONNECTED_EMAIL),
  };
}

async function disconnect() {
  await deleteMeta(META_REFRESH_TOKEN);
  await deleteMeta(META_CONNECTED_EMAIL);
  await deleteMeta(META_FOLDER_ID);
}

async function getAuthorizedDriveClient() {
  const { google } = require('googleapis');
  const refreshToken = await getMeta(META_REFRESH_TOKEN);
  if (!refreshToken) throw new Error('Google Drive não conectado. Use o botão "Conectar Google Drive" (admin).');
  const client = getOAuth2Client(); // redirectUri não é necessário para refresh
  client.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth: client });
}

/** Acha (ou cria, na primeira vez) a pasta de destino dos backups. */
async function resolveFolderId(drive) {
  const envFolder = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (envFolder) return envFolder;

  const cached = await getMeta(META_FOLDER_ID);
  if (cached) return cached;

  const found = await drive.files.list({
    q: "name = 'PCM Backups' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: 'files(id, name)',
    spaces: 'drive',
  });
  if (found.data.files && found.data.files.length) {
    const id = found.data.files[0].id;
    await setMeta(META_FOLDER_ID, id);
    return id;
  }

  const created = await drive.files.create({
    requestBody: { name: 'PCM Backups', mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });
  await setMeta(META_FOLDER_ID, created.data.id);
  return created.data.id;
}

/** Envia um arquivo (texto) para a pasta de backups. Retorna { id, name, webViewLink }. */
async function uploadBackupToDrive(filename, contentString) {
  const drive = await getAuthorizedDriveClient();
  const folderId = await resolveFolderId(drive);

  const stream = new Readable();
  stream.push(contentString);
  stream.push(null);

  const res = await drive.files.create({
    requestBody: { name: filename, parents: [folderId], mimeType: 'application/json' },
    media: { mimeType: 'application/json', body: stream },
    fields: 'id, name, webViewLink',
  });
  return res.data;
}

module.exports = {
  oauthClientConfigured,
  getAuthUrl,
  completeAuth,
  isConfigured,
  getStatus,
  disconnect,
  uploadBackupToDrive,
};
