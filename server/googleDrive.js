const { Readable } = require('stream');

/**
 * Integração com Google Drive via Service Account (sem necessidade de login
 * interativo — ideal para um job automático rodando no servidor).
 *
 * Pré-requisitos (feitos uma única vez no Google Cloud Console / Google Drive,
 * fora deste código — ver README):
 *   1. Criar um projeto no Google Cloud e ativar a "Google Drive API".
 *   2. Criar uma Service Account e gerar uma chave JSON.
 *   3. No Google Drive normal (conta pessoal), criar uma pasta para os backups
 *      e compartilhá-la com o e-mail da Service Account (papel "Editor").
 *      Isso é necessário porque Service Accounts não têm cota de
 *      armazenamento própria no Drive pessoal — arquivos criados dentro de
 *      uma pasta compartilhada por um humano contam na cota desse humano.
 *
 * Variáveis de ambiente (configuradas no Render):
 *   GOOGLE_SERVICE_ACCOUNT_JSON  — conteúdo completo do JSON da chave da Service Account
 *   GOOGLE_DRIVE_FOLDER_ID       — ID da pasta do Drive (compartilhada com a Service Account)
 */

function isConfigured() {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_DRIVE_FOLDER_ID);
}

function getDriveClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não configurado');

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch (e) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não é um JSON válido: ' + e.message);
  }

  // Import tardio: só exige o pacote 'googleapis' instalado se o recurso for usado.
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  return google.drive({ version: 'v3', auth });
}

/**
 * Envia um arquivo (texto) para a pasta configurada no Google Drive.
 * Retorna { id, name, webViewLink }.
 */
async function uploadBackupToDrive(filename, contentString) {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID não configurado');

  const drive = getDriveClient();
  const stream = new Readable();
  stream.push(contentString);
  stream.push(null);

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
      mimeType: 'application/json',
    },
    media: { mimeType: 'application/json', body: stream },
    fields: 'id, name, webViewLink',
  });
  return res.data;
}

module.exports = { isConfigured, uploadBackupToDrive };
