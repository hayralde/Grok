const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'troque-este-segredo-em-producao';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, tecnico: user.tecnico, nome: user.nome, area_scope: user.area_scope || null },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Nao autenticado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token invalido ou expirado' });
  }
}

/** Optional auth: sets req.user if token present, otherwise continues as guest. */
function authOptional(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    req.user = null;
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Sem permissao para esta acao' });
    }
    next();
  };
}

module.exports = { signToken, authRequired, authOptional, requireRole, JWT_SECRET };
