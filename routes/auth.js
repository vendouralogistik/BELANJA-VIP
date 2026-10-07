// routes/auth.js — login/logout/profil/ganti password.
const express = require('express');
const db = require('../utils/sheetsDb');
const auth = require('../utils/auth');
const { asyncHandler, httpError, str } = require('../utils/helpers');

const router = express.Router();

// POST /api/login {username, password} -> {token, user}
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  const u = await db.findOne('users', r => r.username === str(username).trim());
  if (!u || !(await auth.comparePassword(password, u.password_hash))) {
    throw httpError(401, 'Username / password salah.');
  }
  const token = auth.signToken({ sub: u.id, username: u.username, nama: u.nama });
  res.json({ token, user: { id: u.id, username: u.username, nama: u.nama } });
}));

// POST /api/logout -> {ok:true} (stateless; client membuang token)
router.post('/logout', (req, res) => res.json({ ok: true }));

// GET /api/me -> {id, username, nama}
router.get('/me', auth.requireAuth, asyncHandler(async (req, res) => {
  const u = await db.findOne('users', r => r.id === req.user.id);
  if (!u) throw httpError(401, 'User tidak ditemukan.');
  res.json({ id: u.id, username: u.username, nama: u.nama });
}));

// PUT /api/me {nama} -> user terupdate
router.put('/me', auth.requireAuth, asyncHandler(async (req, res) => {
  const nama = str(req.body && req.body.nama).trim();
  if (!nama) throw httpError(400, 'Nama tidak boleh kosong.');
  const u = await db.update('users', req.user.id, { nama });
  res.json({ id: u.id, username: u.username, nama: u.nama });
}));

// PUT /api/me/password {old_password, new_password} -> {ok:true}
router.put('/me/password', auth.requireAuth, asyncHandler(async (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!new_password || String(new_password).length < 6) {
    throw httpError(400, 'Password baru minimal 6 karakter.');
  }
  const u = await db.findOne('users', r => r.id === req.user.id);
  if (!u || !(await auth.comparePassword(old_password, u.password_hash))) {
    throw httpError(401, 'Password lama salah.');
  }
  await db.update('users', req.user.id, { password_hash: await auth.hashPassword(new_password) });
  res.json({ ok: true });
}));

module.exports = router;
