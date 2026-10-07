// routes/belanja.js — CRUD belanja + pencarian/filter.
const express = require('express');
const db = require('../utils/sheetsDb');
const auth = require('../utils/auth');
const drive = require('../utils/driveStore');
const {
  asyncHandler, httpError, num, str, isValidDate,
  belanjaFull, simpanFoto, validFoto,
} = require('../utils/helpers');

const router = express.Router();
const JENIS_BIAYA = ['ongkos', 'parkir', 'lainnya'];

// Kasbon harus ada, milik user, dan berstatus aktif.
async function kasbonAktif(kasbonId, userId) {
  const k = await db.findOne('kasbon', r => r.id === kasbonId && r.user_id === userId);
  if (!k) throw httpError(404, 'Kasbon tidak ditemukan.');
  if (k.status !== 'aktif') throw httpError(409, 'Kasbon sudah ditutup/disetujui — belanja dikunci.');
  return k;
}

// Validasi & normalisasi items + biaya_lain dari body. Total selalu dihitung server.
function validasiIsi(body) {
  const items = Array.isArray(body.items) ? body.items : [];
  const biaya = Array.isArray(body.biaya_lain) ? body.biaya_lain : [];
  if (items.length === 0 && biaya.length === 0) {
    throw httpError(400, 'Belanja wajib berisi minimal 1 barang atau 1 biaya lain.');
  }
  const itemsOk = items.map((it, i) => {
    const nama = str(it.nama_barang).trim();
    if (!nama) throw httpError(400, `Nama barang #${i + 1} wajib diisi.`);
    if (!(num(it.qty) > 0)) throw httpError(400, `Qty "${nama}" harus lebih dari 0.`);
    if (!(num(it.harga_satuan) >= 0)) throw httpError(400, `Harga satuan "${nama}" tidak valid.`);
    return { nama_barang: nama, qty: num(it.qty), satuan: str(it.satuan).trim(), harga_satuan: num(it.harga_satuan) };
  });
  const biayaOk = biaya.map((b, i) => {
    if (!JENIS_BIAYA.includes(b.jenis)) throw httpError(400, `Jenis biaya #${i + 1} harus ongkos/parkir/lainnya.`);
    if (!(num(b.jumlah) > 0)) throw httpError(400, `Jumlah biaya #${i + 1} harus lebih dari 0.`);
    return { jenis: b.jenis, jumlah: num(b.jumlah), keterangan: str(b.keterangan).trim() };
  });
  return { items: itemsOk, biaya: biayaOk };
}

// Simpan anak-anak belanja (item/biaya/foto) ke tab masing-masing.
// fileIds = drive_file_id yang SUDAH berhasil diupload sebelumnya (agar atomik).
async function simpanAnak(belanjaId, items, biaya, fileIds) {
  for (const it of items) {
    await db.insert('belanja_item', { belanja_id: belanjaId, ...it });
  }
  for (const b of biaya) {
    await db.insert('biaya_lain', { belanja_id: belanjaId, ...b });
  }
  for (const fileId of fileIds || []) {
    await db.insert('nota_foto', { belanja_id: belanjaId, drive_file_id: fileId, created_at: new Date().toISOString() });
  }
}

// Upload semua foto ke Drive DULU; kembalikan daftar fileId.
// Dipanggil sebelum tulis baris apa pun agar kegagalan upload tidak menyisakan data yatim.
async function uploadSemua(fotos, prefix) {
  const fileIds = [];
  for (const f of fotos || []) {
    fileIds.push(await simpanFoto(f, `${prefix}-${Date.now()}.jpg`));
  }
  return fileIds;
}

// Hapus anak-anak belanja (dipakai saat PUT ganti total & DELETE).
async function hapusAnak(belanjaId, hapusFileDrive) {
  const [items, biaya, fotos] = await Promise.all([
    db.find('belanja_item', r => r.belanja_id === belanjaId),
    db.find('biaya_lain', r => r.belanja_id === belanjaId),
    db.find('nota_foto', r => r.belanja_id === belanjaId),
  ]);
  for (const r of items) await db.remove('belanja_item', r.id);
  for (const r of biaya) await db.remove('biaya_lain', r.id);
  for (const f of fotos) await db.remove('nota_foto', f.id);
  if (hapusFileDrive) {
    for (const f of fotos) await drive.remove(f.drive_file_id);
  }
}

// GET /api/belanja?kasbon_id=&q=&from=&to= -> {belanja:[...]} (lengkap)
router.get('/', auth.requireAuth, asyncHandler(async (req, res) => {
  const { kasbon_id, q, from, to } = req.query;
  let list = await db.find('belanja', r => true);
  // Batasi ke kasbon milik user.
  const kasbonUser = new Set((await db.find('kasbon', r => r.user_id === req.user.id)).map(k => k.id));
  list = list.filter(b => kasbonUser.has(b.kasbon_id));
  if (kasbon_id) list = list.filter(b => b.kasbon_id === kasbon_id);
  if (from) list = list.filter(b => str(b.tanggal) >= from);
  if (to) list = list.filter(b => str(b.tanggal) <= to);
  let full = [];
  for (const b of list) full.push(await belanjaFull(b));
  const kata = str(q).trim().toLowerCase();
  if (kata) {
    full = full.filter(b =>
      str(b.toko).toLowerCase().includes(kata) ||
      b.items.some(i => str(i.nama_barang).toLowerCase().includes(kata))
    );
  }
  full.sort((a, b) => str(b.tanggal).localeCompare(str(a.tanggal)));
  res.json({ belanja: full });
}));

// POST /api/belanja -> 201 belanja lengkap (satu POST: item + biaya + foto)
router.post('/', auth.requireAuth, asyncHandler(async (req, res) => {
  const { kasbon_id, tanggal, toko, catatan, items, biaya_lain, fotos } = req.body || {};
  await kasbonAktif(kasbon_id, req.user.id);
  if (!isValidDate(tanggal)) throw httpError(400, 'Tanggal tidak valid (format YYYY-MM-DD).');
  if (!str(toko).trim()) throw httpError(400, 'Nama toko/supplier wajib diisi.');
  const isi = validasiIsi({ items, biaya_lain });
  const daftarFoto = Array.isArray(fotos) ? fotos : [];
  if (daftarFoto.length === 0) throw httpError(400, 'Belanja wajib melampirkan minimal 1 foto nota.');
  for (const f of daftarFoto) {
    if (!validFoto(f)) throw httpError(400, 'Ada foto nota yang datanya kosong/tidak valid.');
  }
  // Upload foto DULU sebelum tulis baris apa pun (atomik: gagal upload = tidak ada belanja yatim).
  const fileIds = await uploadSemua(daftarFoto, 'nota');
  const row = await db.insert('belanja', {
    kasbon_id, tanggal,
    toko: str(toko).trim(),
    catatan: str(catatan).trim(),
    created_at: new Date().toISOString(),
  });
  await simpanAnak(row.id, isi.items, isi.biaya, fileIds);
  res.status(201).json(await belanjaFull(row));
}));

// GET /api/belanja/:id -> belanja lengkap
router.get('/:id', auth.requireAuth, asyncHandler(async (req, res) => {
  const b = await db.findOne('belanja', r => r.id === req.params.id);
  if (!b) throw httpError(404, 'Belanja tidak ditemukan.');
  const k = await db.findOne('kasbon', r => r.id === b.kasbon_id && r.user_id === req.user.id);
  if (!k) throw httpError(404, 'Belanja tidak ditemukan.');
  res.json(await belanjaFull(b));
}));

// PUT /api/belanja/:id — hanya jika kasbon aktif. Ganti total: items/biaya/foto.
// fotos = daftar final: {id} untuk foto lama yang dipertahankan, {data,mime} untuk foto baru.
router.put('/:id', auth.requireAuth, asyncHandler(async (req, res) => {
  const b = await db.findOne('belanja', r => r.id === req.params.id);
  if (!b) throw httpError(404, 'Belanja tidak ditemukan.');
  await kasbonAktif(b.kasbon_id, req.user.id);
  const { tanggal, toko, catatan, items, biaya_lain, fotos } = req.body || {};
  if (!isValidDate(tanggal)) throw httpError(400, 'Tanggal tidak valid (format YYYY-MM-DD).');
  if (!str(toko).trim()) throw httpError(400, 'Nama toko/supplier wajib diisi.');
  const isi = validasiIsi({ items, biaya_lain });
  const daftarFoto = Array.isArray(fotos) ? fotos : [];
  if (daftarFoto.length === 0) throw httpError(400, 'Belanja wajib memiliki minimal 1 foto nota.');
  // Sinkronisasi foto: pertahankan id yang dikirim, hapus yang hilang, upload yang baru.
  const fotoLama = await db.find('nota_foto', r => r.belanja_id === b.id);
  const idLama = new Set(fotoLama.map(f => f.id));
  const dipertahankan = [];
  const baru = [];
  for (const f of daftarFoto) {
    if (f.id) {
      if (!idLama.has(f.id)) throw httpError(400, 'Ada foto yang tidak dikenal pada belanja ini.');
      dipertahankan.push(f.id);
    } else if (validFoto(f)) {
      baru.push(f);
    } else {
      throw httpError(400, 'Ada foto nota yang datanya kosong/tidak valid.');
    }
  }
  const dibuang = fotoLama.filter(f => !dipertahankan.includes(f.id));
  // Upload foto baru DULU sebelum ubah baris apa pun (atomik: gagal upload = data lama utuh).
  const fileIdsBaru = await uploadSemua(baru, 'nota');
  // Ganti item & biaya total.
  const [itemsLama, biayaLama] = await Promise.all([
    db.find('belanja_item', r => r.belanja_id === b.id),
    db.find('biaya_lain', r => r.belanja_id === b.id),
  ]);
  for (const r of itemsLama) await db.remove('belanja_item', r.id);
  for (const r of biayaLama) await db.remove('biaya_lain', r.id);
  for (const f of dibuang) {
    await db.remove('nota_foto', f.id);
    await drive.remove(f.drive_file_id);
  }
  for (const it of isi.items) await db.insert('belanja_item', { belanja_id: b.id, ...it });
  for (const bi of isi.biaya) await db.insert('biaya_lain', { belanja_id: b.id, ...bi });
  for (const fileId of fileIdsBaru) {
    await db.insert('nota_foto', { belanja_id: b.id, drive_file_id: fileId, created_at: new Date().toISOString() });
  }
  const updated = await db.update('belanja', b.id, {
    tanggal, toko: str(toko).trim(), catatan: str(catatan).trim(),
  });
  res.json(await belanjaFull(updated));
}));

// DELETE /api/belanja/:id — hanya jika kasbon aktif (hapus item/biaya/foto terkait)
router.delete('/:id', auth.requireAuth, asyncHandler(async (req, res) => {
  const b = await db.findOne('belanja', r => r.id === req.params.id);
  if (!b) throw httpError(404, 'Belanja tidak ditemukan.');
  await kasbonAktif(b.kasbon_id, req.user.id);
  await hapusAnak(b.id, true);
  await db.remove('belanja', b.id);
  res.json({ ok: true });
}));

module.exports = router;
