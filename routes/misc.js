// routes/misc.js — rekap bulanan, version, wake.
const express = require('express');
const db = require('../utils/sheetsDb');
const auth = require('../utils/auth');
const { asyncHandler, httpError, num, str, isValidBulan, totalBelanja } = require('../utils/helpers');

const router = express.Router();

// GET /api/rekap-bulanan?bulan=YYYY-MM (auth)
router.get('/rekap-bulanan', auth.requireAuth, asyncHandler(async (req, res) => {
  const bulan = str(req.query.bulan);
  if (!isValidBulan(bulan)) throw httpError(400, 'Parameter bulan wajib format YYYY-MM.');
  const kasbonUser = new Set((await db.find('kasbon', r => r.user_id === req.user.id)).map(k => k.id));
  const blist = (await db.all('belanja'))
    .filter(b => kasbonUser.has(b.kasbon_id) && str(b.tanggal).slice(0, 7) === bulan);
  const [allItems, allBiaya] = await Promise.all([db.all('belanja_item'), db.all('biaya_lain')]);
  const ids = new Set(blist.map(b => b.id));
  const t = totalBelanja(
    allItems.filter(i => ids.has(i.belanja_id)),
    allBiaya.filter(x => ids.has(x.belanja_id))
  );
  // Top 5 toko per bulan.
  const perToko = {};
  for (const b of blist) {
    const bIds = new Set([b.id]);
    const tb = totalBelanja(
      allItems.filter(i => bIds.has(i.belanja_id)),
      allBiaya.filter(x => bIds.has(x.belanja_id))
    );
    perToko[b.toko] = (perToko[b.toko] || 0) + tb.total;
  }
  const top_toko = Object.entries(perToko)
    .map(([toko, total]) => ({ toko, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  const kasbonTerlibat = new Set(blist.map(b => b.kasbon_id)).size;
  res.json({
    bulan,
    total_belanja: t.total,
    jumlah_transaksi: blist.length,
    rata_per_kasbon: kasbonTerlibat > 0 ? Math.round(t.total / kasbonTerlibat) : 0,
    top_toko,
  });
}));

// GET /api/version -> {version, dbMode, spreadsheet_name?}
router.get('/version', (req, res) => {
  res.json({ version: '1.0.0', dbMode: db.dbMode(), spreadsheet_name: process.env.SPREADSHEET_NAME || null });
});

// GET /api/wake -> {ok:true} / 503 jika env Google belum lengkap
router.get('/wake', (req, res) => {
  if (!db.configured()) {
    return res.status(503).json({ ok: false, error: 'Database belum dikonfigurasi (env Google belum lengkap).' });
  }
  res.json({ ok: true });
});

module.exports = router;
