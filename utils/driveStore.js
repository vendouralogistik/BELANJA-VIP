// utils/driveStore.js — upload foto ke Vercel Blob + URL tampil.
// (Riwayat: Google Drive -> Firebase Storage -> Vercel Blob.
//  Drive: Service Account tak punya kuota penyimpanan.
//  Firebase Storage: wajib upgrade Blaze/berbayar.
//  Vercel Blob: gratis di paket Hobby, tanpa kartu kredit, tanpa akun baru.)
// Interface IDENTIK agar routes tidak berubah:
//   upload(base64, mime, filename) -> file_id (URL publik Blob)
//   url(fileId) -> URL tampil
//   remove(fileId) -> hapus (best-effort)
// TEST_MODE=1 -> fake (kembalikan id "test-file-<uuid>").
const crypto = require('crypto');

const TEST_MODE = process.env.TEST_MODE === '1';

function err503(msg) { const e = new Error(msg); e.status = 503; throw e; }

function rwToken() {
  const t = process.env.BLOB_READ_WRITE_TOKEN;
  if (!t) err503('Penyimpanan foto belum dikonfigurasi: isi BLOB_READ_WRITE_TOKEN di env.');
  return t;
}

// Upload base64 (tanpa prefix) -> URL publik (disimpan sebagai file_id).
async function upload(base64, mime, filename) {
  if (!base64) err503('Data foto kosong.');
  if (TEST_MODE) return 'test-file-' + crypto.randomUUID();
  const { put } = require('@vercel/blob');
  const name = 'belanja-vip/' + (filename || ('foto-' + Date.now() + '.jpg'));
  const { url } = await put(name, Buffer.from(base64, 'base64'), {
    access: 'public',
    contentType: mime || 'image/jpeg',
    token: rwToken(),
  });
  return url;
}

// URL tampil untuk sebuah file_id (di production file_id SUDAH berupa URL).
function url(fileId) {
  if (!fileId) return null;
  if (/^https?:\/\//i.test(fileId)) return fileId;
  if (TEST_MODE) return `https://test.public.blob.vercel-storage.com/${fileId}`;
  return fileId;
}

// Hapus file (best-effort; gagal diabaikan agar tidak mengganggu alur utama).
async function remove(fileId) {
  if (!fileId || TEST_MODE) return true;
  try {
    const { del } = require('@vercel/blob');
    await del(fileId, { token: rwToken() });
  } catch (e) { /* abaikan */ }
  return true;
}

module.exports = { upload, url, remove };
