const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Simple password-based auth for the dashboard.
// When DASHBOARD_PASSWORD env var is not set, auth is disabled (open mode).
// ---------------------------------------------------------------------------

const PASSWORD = process.env.DASHBOARD_PASSWORD || null;
const AUTH_ENABLED = !!PASSWORD;

/**
 * Hash a value with SHA-256 and return lowercase hex string.
 */
function hash(val) {
  return crypto.createHash('sha256').update(String(val)).digest('hex');
}

/**
 * Express middleware — requires a valid auth token.
 * The token is the SHA-256 hash of the dashboard password.
 */
function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) return next();

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token || token !== hash(PASSWORD)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/**
 * Socket.IO middleware — checks auth token on connection handshake.
 */
function authenticateSocket(socket, next) {
  if (!AUTH_ENABLED) return next();

  const token = socket.handshake.auth?.token;
  if (!token || token !== hash(PASSWORD)) {
    return next(new Error('Unauthorized'));
  }
  next();
}

/**
 * Validate a plain-text password against the stored password.
 */
function validatePassword(plain) {
  if (!AUTH_ENABLED) return true; // no auth = always valid
  return plain === PASSWORD;
}

module.exports = {
  AUTH_ENABLED,
  requireAuth,
  authenticateSocket,
  validatePassword,
  hash,
};
