/**
 * Bootstrap: carrega o server completo do último commit bom no GitHub.
 * (evita quebra se o arquivo grande não pôde ser enviado via API)
 * Depois do site estável, substitua este arquivo pelo server/index.js completo.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BOOT = path.join(__dirname, '_index_boot.js');
const SRC = 'https://raw.githubusercontent.com/hayralde/grok/c8b6d0c68d1312caacaa80858df74e67bed06a7a/server/index.js';

function ensureBoot() {
  try {
    if (fs.existsSync(BOOT) && fs.statSync(BOOT).size > 5000) return;
  } catch (_) {}
  execSync('curl -fsSL "' + SRC + '" -o "' + BOOT + '"', { stdio: 'inherit' });
}

ensureBoot();

// Injeta versionApi se ainda não estiver no boot
let src = fs.readFileSync(BOOT, 'utf8');
if (!src.includes('registerVersionApi')) {
  src = src.replace(
    "const { getAreaConfig, listAreas } = require('./areaConfig');",
    "const { getAreaConfig, listAreas } = require('./areaConfig');\nconst { registerVersionApi, registerNoCacheStatic } = require('./versionApi');"
  );
  src = src.replace(
    "app.get('/api/areas', (_req, res) => {\n  res.json({ areas: listAreas(), default: DEFAULT_AREA });\n});",
    "app.get('/api/areas', (_req, res) => {\n  res.json({ areas: listAreas(), default: DEFAULT_AREA });\n});\n\nregisterVersionApi(app);"
  );
  src = src.replace(
    "app.use(express.static(path.join(__dirname, '..', 'public')));",
    "registerNoCacheStatic(app);\napp.use(express.static(path.join(__dirname, '..', 'public')));"
  );
  fs.writeFileSync(BOOT, src);
}

require(BOOT);
