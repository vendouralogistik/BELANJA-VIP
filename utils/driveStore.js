// utils/driveStore.js — upload foto ke Firebase Storage + bangun URL tampil.
// (Awalnya Google Drive; dipindah karena Service Account tidak punya kuota
//  penyimpanan Drive. Interface IDENTIK agar routes tidak berubah.)
// TEST_MODE=1 -> fake (kembalikan id "test-file-<uuid>").
const crypto = require('crypto');

const TEST_MODE = process.env.TEST_MODE === '1';

function err503(msg) { const e = new Error(msg); e.status = 503; throw e; }

let _bucket = null;
function bucket() {
  if (_bucket) return _bucket;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
  if (!raw || !bucketName) err503('Penyimpanan foto belum dikonfigurasi: isi GOOGLE_SERVICE_ACCOUNT_JSON & FIREBASE_STORAGE_BUCKET di env.');
  let sa;
  try { sa = JSON.parse(raw); }
  catch (e) { err503('GOOGLE_SERVICE_ACCOUNT_JSON bukan JSON yang valid.'); }
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(sa),
      storageBucket: bucketName,
    });
  }
  _bucket = admin.storage().bucket(bucketName);
  return _bucket;
}

// Upload base64 (tanpa prefix) -> file_id (path di bucket).
async function upload(base64, mime, filename) {
  if (!base64) err503('Data foto kosong.');
  if (TEST_MODE) return 'test-file-' + crypto.randomUUID();
  const b = bucket();
  const name = 'belanja-vip/' + (filename || ('foto-' + Date.now() + '.jpg'));
  const file = b.file(name);
  await file.save(Buffer.from(base64, 'base64'), {
    contentType: mime || 'image/jpeg',
    resumable: false,
    metadata: { cacheControl: 'public, max-age=31536000' },
  });
  await file.makePublic();
  return name;
}

// URL tampil untuk sebuah file_id.
function url(fileId) {
  if (!fileId) return null;
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || '';
  return `https://storage.googleapis.com/${bucketName}/${fileId}`;
}

// Hapus file (best-effort; gagal diabaikan agar tidak mengganggu alur utama).
async function remove(fileId) {
  if (!fileId || TEST_MODE) return true;
  try { await bucket().file(fileId).delete(); } catch (e) { /* abaikan */ }
  return true;
}

module.exports = { upload, url, remove };
