// routes/kasbon.js — CRUD kasbon + tutup + rekap.
const express = require('express');
const db = require('../utils/sheetsDb');
const auth = require('../utils/auth');
const drive = require('../utils/driveStore');
const {
  asyncHandler, httpError, num, str, isValidDate,
  kasbonRekap, serializeKasbon, serializeSetoran, belanjaFull, simpanFoto, validFoto, idKlien,
} = require('../utils/helpers');

const router = express.Router();
const METODE = ['tunai', 'transfer'];

// Ambil kasbon milik user; 404 jika tidak ada / bukan miliknya.
async function getKasbon(id, userId) {
  const k = await db.findOne('kasbon', r => r.id === id && (!userId || r.user_id === userId));
  if (!k) throw httpError(404, 'Kasbon tidak ditemukan.');
  return k;
}

// GET /api/kasbon?status=aktif|selesai|disetujui -> {kasbon:[...]} (tiap item bawa rekap)
router.get('/', auth.requireAuth, asyncHandler(async (req, res) => {
  const { status } = req.query;
  let list = await db.find('kasbon', r => r.user_id === req.user.id);
  if (status) list = list.filter(k => k.status === status);
  list.sort((a, b) => str(b.tanggal).localeCompare(str(a.tanggal)));
  const out = [];
  for (const k of list) out.push(await serializeKasbon(k, true));
  res.json({ kasbon: out });
}));

// POST /api/kasbon -> 201 kasbon (rekap nol)
router.post('/', auth.requireAuth, asyncHandler(async (req, res) => {
  const { tanggal, jumlah, keperluan, pemberi, metode, catatan, bukti_transfer } = req.body || {};
  // Idempoten: jika ID klien sudah pernah tersimpan (retry sinkronisasi offline),
  // kembalikan data yang ada tanpa membuat duplikat.
  const idem = idKlien(req.body && req.body.id);
  if (idem) {
    const ada = await db.findOne('kasbon', r => r.id === idem && r.user_id === req.user.id);
    if (ada) return res.json({ kasbon: await serializeKasbon(ada, true) });
  }
  if (!isValidDate(tanggal)) throw httpError(400, 'Tanggal tidak valid (format YYYY-MM-DD).');
  if (!(num(jumlah) > 0)) throw httpError(400, 'Jumlah harus lebih dari 0.');
  if (!METODE.includes(metode)) throw httpError(400, 'Metode harus "tunai" atau "transfer".');
  if (!str(keperluan).trim()) throw httpError(400, 'Keperluan wajib diisi.');
  if (!str(pemberi).trim()) throw httpError(400, 'Nama pemberi wajib diisi.');
  let buktiId = null;
  if (metode === 'transfer') {
    if (!validFoto(bukti_transfer)) throw httpError(400, 'Metode transfer wajib melampirkan foto bukti transfer.');
    buktiId = await simpanFoto(bukti_transfer, `bukti-transfer-${Date.now()}.jpg`);
  }
  const row = await db.insert('kasbon', {
    id: idem,
    user_id: req.user.id,
    tanggal,
    jumlah: num(jumlah),
    keperluan: str(keperluan).trim(),
    pemberi: str(pemberi).trim(),
    metode,
    bukti_transfer_drive_id: buktiId,
    catatan: str(catatan).trim(),
    status: 'aktif',
    disetujui_oleh: null,
    disetujui_at: null,
    created_at: new Date().toISOString(),
    closed_at: null,
  });
  res.status(201).json({ kasbon: await serializeKasbon(row, true) });
}));

// GET /api/kasbon/:id -> {kasbon, belanja:[...], setoran}
router.get('/:id', auth.requireAuth, asyncHandler(async (req, res) => {
  const k = await getKasbon(req.params.id, req.user.id);
  const blist = await db.find('belanja', r => r.kasbon_id === k.id);
  const belanja = [];
  for (const b of blist) belanja.push(await belanjaFull(b));
  const setoran = await db.findOne('setoran', r => r.kasbon_id === k.id);
  res.json({
    kasbon: await serializeKasbon(k, true),
    belanja,
    setoran: serializeSetoran(setoran),
  });
}));

// PUT /api/kasbon/:id — hanya saat status aktif
router.put('/:id', auth.requireAuth, asyncHandler(async (req, res) => {
  const k = await getKasbon(req.params.id, req.user.id);
  if (k.status !== 'aktif') throw httpError(409, 'Kasbon sudah ditutup/disetujui, tidak bisa diubah.');
  const { tanggal, jumlah, keperluan, pemberi, metode, catatan, bukti_transfer } = req.body || {};
  const patch = {};
  if (tanggal !== undefined) {
    if (!isValidDate(tanggal)) throw httpError(400, 'Tanggal tidak valid (format YYYY-MM-DD).');
    patch.tanggal = tanggal;
  }
  if (jumlah !== undefined) {
    if (!(num(jumlah) > 0)) throw httpError(400, 'Jumlah harus lebih dari 0.');
    patch.jumlah = num(jumlah);
  }
  if (keperluan !== undefined) {
    if (!str(keperluan).trim()) throw httpError(400, 'Keperluan tidak boleh kosong.');
    patch.keperluan = str(keperluan).trim();
  }
  if (pemberi !== undefined) {
    if (!str(pemberi).trim()) throw httpError(400, 'Nama pemberi tidak boleh kosong.');
    patch.pemberi = str(pemberi).trim();
  }
  const metodeBaru = metode !== undefined ? metode : k.metode;
  if (!METODE.includes(metodeBaru)) throw httpError(400, 'Metode harus "tunai" atau "transfer".');
  if (metode !== undefined) patch.metode = metode;
  if (catatan !== undefined) patch.catatan = str(catatan).trim();
  // Bukti transfer: wajib ada jika metode akhir = transfer.
  if (metodeBaru === 'transfer') {
    if (validFoto(bukti_transfer)) {
      const lama = k.bukti_transfer_drive_id;
      patch.bukti_transfer_drive_id = await simpanFoto(bukti_transfer, `bukti-transfer-${Date.now()}.jpg`);
      if (lama) await drive.remove(lama);
    } else if (!k.bukti_transfer_drive_id) {
      throw httpError(400, 'Metode transfer wajib melampirkan foto bukti transfer.');
    }
  } else if (metodeBaru === 'tunai' && k.bukti_transfer_drive_id) {
    // Ganti ke tunai: bersihkan bukti transfer lama agar tidak basi di LPJ.
    await drive.remove(k.bukti_transfer_drive_id);
    patch.bukti_transfer_drive_id = null;
  }
  const updated = await db.update('kasbon', k.id, patch);
  res.json({ kasbon: await serializeKasbon(updated, true) });
}));

// DELETE /api/kasbon/:id — hanya jika aktif DAN belum ada belanja
router.delete('/:id', auth.requireAuth, asyncHandler(async (req, res) => {
  const k = await getKasbon(req.params.id, req.user.id);
  if (k.status !== 'aktif') throw httpError(409, 'Kasbon sudah ditutup/disetujui, tidak bisa dihapus.');
  const ada = await db.find('belanja', r => r.kasbon_id === k.id);
  if (ada.length > 0) throw httpError(409, 'Kasbon tidak bisa dihapus karena sudah ada belanja tercatat.');
  // Bersihkan data terkait agar tidak yatim: tautan share + file bukti di Drive.
  const share = await db.findOne('lpj_share', r => r.kasbon_id === k.id);
  if (share) await db.remove('lpj_share', share.id);
  if (k.bukti_transfer_drive_id) await drive.remove(k.bukti_transfer_drive_id);
  await db.remove('kasbon', k.id);
  res.json({ ok: true });
}));

// POST /api/kasbon/:id/tutup {setoran:{tanggal,jumlah,metode,catatan?,bukti_transfer?}}
router.post('/:id/tutup', auth.requireAuth, asyncHandler(async (req, res) => {
  const k = await getKasbon(req.params.id, req.user.id);
  const s = (req.body && req.body.setoran) || {};
  // Idempoten untuk retry sinkronisasi offline — dicek SEBELUM status,
  // karena percobaan pertama yang sukses sudah mengubah status jadi 'selesai'.
  const idemS = idKlien(s.id);
  if (idemS) {
    const adaS = await db.findOne('setoran', r => r.id === idemS && r.kasbon_id === k.id);
    if (adaS) {
      const ks = await db.findOne('kasbon', r => r.id === k.id);
      return res.json({ kasbon: await serializeKasbon(ks, true), setoran: serializeSetoran(adaS) });
    }
  }
  if (k.status !== 'aktif') throw httpError(409, 'Kasbon tidak dalam status aktif.');
  if (!isValidDate(s.tanggal)) throw httpError(400, 'Tanggal setoran tidak valid (format YYYY-MM-DD).');
  if (!('jumlah' in s) || !(num(s.jumlah) >= 0)) throw httpError(400, 'Jumlah setoran wajib diisi (minimal 0).');
  if (!METODE.includes(s.metode)) throw httpError(400, 'Metode setoran harus "tunai" atau "transfer".');
  let buktiId = null;
  if (s.metode === 'transfer') {
    if (!validFoto(s.bukti_transfer)) throw httpError(400, 'Setoran via transfer wajib melampirkan foto bukti transfer.');
    buktiId = await simpanFoto(s.bukti_transfer, `bukti-setoran-${Date.now()}.jpg`);
  }
  const setoran = await db.insert('setoran', {
    id: idemS,
    kasbon_id: k.id,
    tanggal: s.tanggal,
    jumlah: num(s.jumlah),
    metode: s.metode,
    bukti_transfer_drive_id: buktiId,
    catatan: str(s.catatan).trim(),
    created_at: new Date().toISOString(),
  });
  const updated = await db.update('kasbon', k.id, { status: 'selesai', closed_at: new Date().toISOString() });
  res.json({ kasbon: await serializeKasbon(updated, true), setoran: serializeSetoran(setoran) });
}));

// GET /api/kasbon/:id/rekap -> {diterima, terpakai, sisa, persen_terpakai, status}
router.get('/:id/rekap', auth.requireAuth, asyncHandler(async (req, res) => {
  const k = await getKasbon(req.params.id, req.user.id);
  res.json(await kasbonRekap(k.id, k.jumlah));
}));

module.exports = router;
