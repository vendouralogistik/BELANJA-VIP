// server.js — setup Express Belanja VIP.
// Boot TANPA env Google tetap bisa: endpoint yang butuh DB balas 503 dengan pesan jelas.
// Export `app` untuk test; listen hanya jika dijalankan langsung.
const express = require('express');
const path = require('path');
const db = require('./utils/sheetsDb');

const app = express();

// JSON body s/d 15 MB (foto base64 dari HP).
app.use(express.json({ limit: '15mb' }));

// Frontend statis.
app.use(express.static(path.join(__dirname, 'public')));

// Tunggu init DB (tab + seed admin) sebelum melayani /api — init tidak pernah reject.
const dbReady = db.init();
app.use('/api', async (req, res, next) => {
  try { await dbReady; next(); } catch (e) { next(e); }
});

// Routes.
app.use('/api', require('./routes/auth'));
app.use('/api/kasbon', require('./routes/kasbon'));
app.use('/api/belanja', require('./routes/belanja'));
app.use('/api', require('./routes/lpj'));
app.use('/api', require('./routes/misc'));

// 404 khusus /api (selain itu biarkan static/SPA).
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));

// Error handler JSON: {error:"pesan"} + status (400/401/404/409/503).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error('[server]', err);
  res.status(status).json({ error: err.message || 'Terjadi kesalahan server.' });
});

module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Belanja VIP jalan di port ${port} (dbMode=${db.dbMode()})`);
  });
}
