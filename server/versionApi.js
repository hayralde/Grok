/**
 * Endpoint /api/version — clientes consultam a cada 10s e recarregam após deploy.
 */
const APP_VERSION = require('../package.json').version || '0';
const APP_STARTED_AT = new Date().toISOString();

function registerVersionApi(app) {
  app.get('/api/version', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ version: APP_VERSION, startedAt: APP_STARTED_AT });
  });
}

function registerNoCacheStatic(app) {
  app.use((req, res, next) => {
    if (req.path === '/' || req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }
    next();
  });
}

module.exports = { registerVersionApi, registerNoCacheStatic, APP_VERSION, APP_STARTED_AT };
