// routes/lpj.js — export Excel LPJ, tautan berbagi, persetujuan bendahara (publik), edit setoran.
const crypto = require('crypto');
const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../utils/sheetsDb');
const auth = require('../utils/auth');
const {
  asyncHandler, httpError, num, str, isValidDate,
  kasbonRekap, serializeKasbon, serializeSetoran, belanjaFull, simpanFoto, validFoto,
} = require('../utils/helpers');

const router = express.Router();
const METODE = ['tunai', 'transfer'];

async function getKasbon(id, userId) {
  const k = await db.findOne('kasbon', r => r.id === id && (!userId || r.user_id === userId));
  if (!k) throw httpError(404, 'Kasbon tidak ditemukan.');
  return k;
}

// Kumpulkan seluruh data LPJ satu kasbon.
async function dataLpj(kasbonId) {
  const k = await getKasbon(kasbonId);
  const kasbon = await serializeKasbon(k, true);
  const blist = await db.find('belanja', r => r.kasbon_id === kasbonId);
  blist.sort((a, b) => str(a.tanggal).localeCompare(str(b.tanggal)));
  const belanja = [];
  for (const b of blist) belanja.push(await belanjaFull(b));
  const setoranRow = await db.findOne('setoran', r => r.kasbon_id === kasbonId);
  return { kasbon, belanja, setoran: serializeSetoran(setoranRow), rekap: kasbon.rekap };
}

/* ---------- GET /api/kasbon/:id/lpj.xlsx (auth) ---------- */
router.get('/kasbon/:id/lpj.xlsx', auth.requireAuth, asyncHandler(async (req, res) => {
  await getKasbon(req.params.id, req.user.id);
  const { kasbon, belanja, setoran, rekap } = await dataLpj(req.params.id);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Belanja VIP';
  wb.created = new Date();

  // Sheet 1: Info kasbon
  const info = wb.addWorksheet('Info');
  info.columns = [{ width: 22 }, { width: 45 }];
  const barisInfo = [
    ['LPJ BELANJA SPAREPART', ''],
    ['Tanggal kasbon', kasbon.tanggal],
    ['Jumlah diterima (Rp)', kasbon.jumlah],
    ['Keperluan', kasbon.keperluan],
    ['Pemberi / bendahara', kasbon.pemberi],
    ['Metode', kasbon.metode],
    ['Bukti transfer', kasbon.bukti_transfer_url || '-'],
    ['Catatan', kasbon.catatan],
    ['Status', kasbon.status],
    ['Disetujui oleh', kasbon.disetujui_oleh || '-'],
    ['Disetujui pada', kasbon.disetujui_at || '-'],
  ];
  barisInfo.forEach(r => info.addRow(r));
  info.getCell('A1').font = { bold: true, size: 14 };
  info.getColumn(2).numFmt = '#,##0';

  // Sheet 2: Belanja (item + biaya lain + foto)
  const bl = wb.addWorksheet('Belanja');
  bl.columns = [
    { header: 'No', width: 5 }, { header: 'Tanggal', width: 13 },
    { header: 'Toko', width: 20 }, { header: 'Jenis', width: 12 },
    { header: 'Deskripsi', width: 32 }, { header: 'Qty', width: 8 },
    { header: 'Satuan', width: 8 }, { header: 'Harga/Jumlah (Rp)', width: 18 },
    { header: 'Subtotal (Rp)', width: 18 }, { header: 'Foto nota', width: 40 },
  ];
  let no = 1, grand = 0;
  for (const b of belanja) {
    const fotoUrl = b.fotos.map(f => f.url).join(' ');
    for (const it of b.items) {
      bl.addRow([no++, b.tanggal, b.toko, 'Item', it.nama_barang, it.qty, it.satuan, it.harga_satuan, it.subtotal, fotoUrl]);
    }
    for (const bi of b.biaya_lain) {
      bl.addRow([no++, b.tanggal, b.toko, 'Biaya: ' + bi.jenis, bi.keterangan || bi.jenis, '', '', bi.jumlah, bi.jumlah, fotoUrl]);
    }
    grand += b.total;
  }
  bl.addRow([]);
  const tr = bl.addRow(['', '', '', '', 'TOTAL BELANJA', '', '', '', grand, '']);
  tr.font = { bold: true };
  [8, 9].forEach(c => { bl.getColumn(c).numFmt = '#,##0'; });
  bl.getRow(1).font = { bold: true };

  // Sheet 3: Setoran
  const st = wb.addWorksheet('Setoran');
  st.columns = [
    { header: 'Tanggal', width: 13 }, { header: 'Jumlah (Rp)', width: 18 },
    { header: 'Metode', width: 12 }, { header: 'Catatan', width: 32 },
    { header: 'Bukti transfer', width: 40 },
  ];
  st.getRow(1).font = { bold: true };
  if (setoran) {
    st.addRow([setoran.tanggal, setoran.jumlah, setoran.metode, setoran.catatan, setoran.bukti_transfer_url || '-']);
    st.getColumn(2).numFmt = '#,##0';
  }

  // Sheet 4: Rekap
  const rk = wb.addWorksheet('Rekap');
  rk.columns = [{ width: 24 }, { width: 22 }];
  const disetor = setoran ? setoran.jumlah : 0;
  [
    ['Diterima (Rp)', rekap.diterima],
    ['Terpakai (Rp)', rekap.terpakai],
    ['Disetor kembali (Rp)', disetor],
    ['Sisa (Rp)', rekap.sisa],
    ['Status', rekap.status],
  ].forEach(r => rk.addRow(r));
  rk.getColumn(2).numFmt = '#,##0';
  rk.getRow(1).font = { bold: true };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="lpj-${req.params.id}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

/* ---------- POST /api/kasbon/:id/share (auth) -> {url:"/s/<token>"} ---------- */
router.post('/kasbon/:id/share', auth.requireAuth, asyncHandler(async (req, res) => {
  await getKasbon(req.params.id, req.user.id);
  let share = await db.findOne('lpj_share', r => r.kasbon_id === req.params.id);
  if (!share) {
    share = await db.insert('lpj_share', {
      kasbon_id: req.params.id,
      token: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    });
  }
  res.json({ url: `/s/${share.token}` });
}));

/* ---------- GET /api/s/:token — LPJ publik tanpa login ---------- */
router.get('/s/:token', asyncHandler(async (req, res) => {
  const share = await db.findOne('lpj_share', r => r.token === req.params.token);
  if (!share) throw httpError(404, 'Tautan LPJ tidak valid.');
  res.json(await dataLpj(share.kasbon_id));
}));

/* ---------- POST /api/s/:token/setujui {nama} — persetujuan bendahara ---------- */
router.post('/s/:token/setujui', asyncHandler(async (req, res) => {
  const nama = str(req.body && req.body.nama).trim();
  if (!nama) throw httpError(400, 'Nama bendahara wajib diisi.');
  const share = await db.findOne('lpj_share', r => r.token === req.params.token);
  if (!share) throw httpError(404, 'Tautan LPJ tidak valid.');
  const k = await getKasbon(share.kasbon_id);
  if (k.status === 'disetujui') throw httpError(409, 'LPJ ini sudah disetujui sebelumnya.');
  if (k.status !== 'selesai') throw httpError(409, 'Kasbon belum ditutup, belum bisa disetujui.');
  const now = new Date().toISOString();
  await db.update('kasbon', k.id, { status: 'disetujui', disetujui_oleh: nama, disetujui_at: now });
  res.json({ ok: true, disetujui_oleh: nama, disetujui_at: now });
}));

/* ---------- PUT /api/setoran/:id (auth) — hanya saat kasbon "selesai" ---------- */
router.put('/setoran/:id', auth.requireAuth, asyncHandler(async (req, res) => {
  const s = await db.findOne('setoran', r => r.id === req.params.id);
  if (!s) throw httpError(404, 'Setoran tidak ditemukan.');
  const k = await getKasbon(s.kasbon_id, req.user.id);
  if (k.status !== 'selesai') throw httpError(409, 'Setoran hanya bisa diubah selama kasbon berstatus selesai (belum disetujui).');
  const { tanggal, jumlah, metode, catatan, bukti_transfer } = req.body || {};
  const patch = {};
  if (tanggal !== undefined) {
    if (!isValidDate(tanggal)) throw httpError(400, 'Tanggal tidak valid (format YYYY-MM-DD).');
    patch.tanggal = tanggal;
  }
  if (jumlah !== undefined) {
    if (!(num(jumlah) >= 0)) throw httpError(400, 'Jumlah setoran tidak valid (minimal 0).');
    patch.jumlah = num(jumlah);
  }
  const metodeBaru = metode !== undefined ? metode : s.metode;
  if (!METODE.includes(metodeBaru)) throw httpError(400, 'Metode harus "tunai" atau "transfer".');
  if (metode !== undefined) patch.metode = metode;
  if (catatan !== undefined) patch.catatan = str(catatan).trim();
  if (metodeBaru === 'transfer') {
    if (validFoto(bukti_transfer)) {
      const lama = s.bukti_transfer_drive_id;
      patch.bukti_transfer_drive_id = await simpanFoto(bukti_transfer, `bukti-setoran-${Date.now()}.jpg`);
      if (lama) await drive.remove(lama);
    } else if (!s.bukti_transfer_drive_id) {
      throw httpError(400, 'Setoran via transfer wajib melampirkan foto bukti transfer.');
    }
  } else if (metodeBaru === 'tunai' && s.bukti_transfer_drive_id) {
    // Ganti ke tunai: bersihkan bukti transfer lama agar tidak basi di LPJ.
    await drive.remove(s.bukti_transfer_drive_id);
    patch.bukti_transfer_drive_id = null;
  }
  const updated = await db.update('setoran', s.id, patch);
  res.json({ setoran: serializeSetoran(updated) });
}));

module.exports = router;
