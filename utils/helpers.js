// utils/helpers.js — logika bisnis bersama: rekap, total, validasi, serializer.
const db = require('./sheetsDb');
const drive = require('./driveStore');

// Ubah nilai sel Sheet (string) jadi number aman.
function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Ubah nilai jadi string aman.
function str(v) {
  return (v === null || v === undefined) ? '' : String(v);
}

// Error HTTP dengan status (400/404/409/503...), ditangani error handler server.js.
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  throw e;
}

// Bungkus handler async agar error diteruskan ke error handler Express.
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Validasi tanggal "YYYY-MM-DD" yang benar-benar ada di kalender.
function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Validasi bulan "YYYY-MM".
function isValidBulan(s) {
  if (typeof s !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) return false;
  return true;
}

// Status rekap: NOMBOK jika sisa<0; HAMPIR HABIS jika terpakai>=90%; selainnya AMAN.
function hitungRekap(diterima, terpakai) {
  diterima = num(diterima); terpakai = num(terpakai);
  const sisa = diterima - terpakai;
  const persen_terpakai = diterima > 0 ? Math.round((terpakai / diterima) * 1000) / 10 : 0;
  const status = sisa < 0 ? 'NOMBOK' : (persen_terpakai >= 90 ? 'HAMPIR HABIS' : 'AMAN');
  return { diterima, terpakai, sisa, persen_terpakai, status };
}

// Total belanja = total item + total biaya lain. Selalu dihitung server.
function totalBelanja(items, biaya) {
  const total_item = items.reduce((a, i) => a + num(i.qty) * num(i.harga_satuan), 0);
  const total_biaya = biaya.reduce((a, b) => a + num(b.jumlah), 0);
  return { total_item, total_biaya, total: total_item + total_biaya };
}

// Satu belanja lengkap: items + biaya_lain + fotos + total (sesuai CONTRACT).
async function belanjaFull(row) {
  const [items, biaya, fotos] = await Promise.all([
    db.find('belanja_item', r => r.belanja_id === row.id),
    db.find('biaya_lain', r => r.belanja_id === row.id),
    db.find('nota_foto', r => r.belanja_id === row.id),
  ]);
  const t = totalBelanja(items, biaya);
  return {
    id: row.id, kasbon_id: row.kasbon_id, tanggal: row.tanggal,
    toko: row.toko, catatan: str(row.catatan), created_at: row.created_at,
    items: items.map(i => ({
      id: i.id, nama_barang: i.nama_barang, qty: num(i.qty), satuan: str(i.satuan),
      harga_satuan: num(i.harga_satuan), subtotal: num(i.qty) * num(i.harga_satuan),
    })),
    biaya_lain: biaya.map(b => ({
      id: b.id, jenis: b.jenis, jumlah: num(b.jumlah), keterangan: str(b.keterangan),
    })),
    fotos: fotos.map(f => ({ id: f.id, drive_file_id: f.drive_file_id, url: drive.url(f.drive_file_id) })),
    total_item: t.total_item, total_biaya: t.total_biaya, total: t.total,
  };
}

// Rekap satu kasbon dari data (terpakai = SUM total belanja).
async function kasbonRekap(kasbonId, diterima) {
  const [blist, allItems, allBiaya] = await Promise.all([
    db.find('belanja', r => r.kasbon_id === kasbonId),
    db.all('belanja_item'),
    db.all('biaya_lain'),
  ]);
  const ids = new Set(blist.map(b => b.id));
  const t = totalBelanja(
    allItems.filter(i => ids.has(i.belanja_id)),
    allBiaya.filter(b => ids.has(b.belanja_id))
  );
  return hitungRekap(diterima, t.total);
}

// Serialize kasbon sesuai CONTRACT (angka jadi number, url bukti transfer).
async function serializeKasbon(row, withRekap) {
  const kasbon = {
    id: row.id, tanggal: row.tanggal, jumlah: num(row.jumlah),
    keperluan: row.keperluan, pemberi: row.pemberi, metode: row.metode,
    bukti_transfer_drive_id: row.bukti_transfer_drive_id || null,
    bukti_transfer_url: drive.url(row.bukti_transfer_drive_id),
    catatan: str(row.catatan), status: row.status,
    disetujui_oleh: row.disetujui_oleh || null, disetujui_at: row.disetujui_at || null,
    created_at: row.created_at, closed_at: row.closed_at || null,
  };
  if (withRekap) kasbon.rekap = await kasbonRekap(row.id, row.jumlah);
  // Jumlah setoran aktual (untuk label "Disetor" yang akurat di Riwayat/LPJ).
  const setoranRow = await db.findOne('setoran', r => r.kasbon_id === row.id);
  kasbon.setoran_jumlah = setoranRow ? num(setoranRow.jumlah) : null;
  return kasbon;
}

// Serialize setoran sesuai CONTRACT.
function serializeSetoran(row) {
  if (!row) return null;
  return {
    id: row.id, kasbon_id: row.kasbon_id, tanggal: row.tanggal, jumlah: num(row.jumlah),
    metode: row.metode,
    bukti_transfer_drive_id: row.bukti_transfer_drive_id || null,
    bukti_transfer_url: drive.url(row.bukti_transfer_drive_id),
    catatan: str(row.catatan), created_at: row.created_at,
  };
}

// Simpan foto {data base64, mime} ke Drive -> drive_file_id (null jika tidak ada).
async function simpanFoto(foto, namaFile) {
  if (!foto || !foto.data) return null;
  return drive.upload(foto.data, foto.mime || 'image/jpeg', namaFile);
}

// Validasi satu entri foto dari client.
function validFoto(f) {
  return f && typeof f.data === 'string' && f.data.length > 0;
}

module.exports = {
  num, str, httpError, asyncHandler, isValidDate, isValidBulan,
  hitungRekap, totalBelanja, belanjaFull, kasbonRekap,
  serializeKasbon, serializeSetoran, simpanFoto, validFoto,
};
