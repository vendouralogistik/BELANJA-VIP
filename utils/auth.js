// utils/auth.js — password bcrypt + JWT + middleware requireAuth.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) {
    // TEST_MODE boleh jalan tanpa secret (untuk npm test). Di luar itu, gagal cepat
    // agar production tidak pernah memakai secret fallback yang bisa ditebak.
    if (process.env.TEST_MODE === '1') return 'test-secret-hanya-untuk-npm-test';
    throw new Error('[auth] JWT_SECRET wajib diisi di env (kecuali TEST_MODE=1).');
  }
  return s;
}

// Hash password baru (10 rounds).
async function hashPassword(pw) {
  return bcrypt.hash(String(pw), 10);
}

// Bandingkan password polos dengan hash.
async function comparePassword(pw, hash) {
  if (!hash) return false;
  return bcrypt.compare(String(pw), hash);
}

// Buat token JWT, berlaku 7 hari.
function signToken(payload) {
  return jwt.sign(payload, jwtSecret(), { expiresIn: '7d' });
}

// Verifikasi token; lempar jika tidak valid/kedaluwarsa.
function verifyToken(token) {
  return jwt.verify(token, jwtSecret());
}

// Middleware: tolak 401 jika header Authorization Bearer tidak ada/tidak valid.
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/);
  if (!m) return res.status(401).json({ error: 'Butuh login (token tidak ada).' });
  try {
    const p = verifyToken(m[1]);
    req.user = { id: p.sub, username: p.username, nama: p.nama };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesi tidak valid / kedaluwarsa, silakan login lagi.' });
  }
}

module.exports = { hashPassword, comparePassword, signToken, verifyToken, requireAuth };
