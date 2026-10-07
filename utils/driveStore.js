// utils/driveStore.js — upload foto ke Google Drive + bangun URL tampil.
// TEST_MODE=1 -> fake (kembalikan id "test-file-<uuid>"), interface IDENTIK.
const crypto = require('crypto');

const TEST_MODE = process.env.TEST_MODE === '1';

function err503(msg) { const e = new Error(msg); e.status = 503; throw e; }

let _drive = null;
function driveClient() {
  if (_drive) return _drive;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const folder = process.env.DRIVE_FOLDER_ID;
  if (!raw || !folder) err503('Penyimpanan foto belum dikonfigurasi: isi GOOGLE_SERVICE_ACCOUNT_JSON & DRIVE_FOLDER_ID di env.');
  let sa;
  try { sa = JSON.parse(raw); }
  catch (e) { err503('GOOGLE_SERVICE_ACCOUNT_JSON bukan JSON yang valid.'); }
  const { google } = require('googleapis');
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  _drive = google.drive({ version: 'v3', auth });
  return _drive;
}

// Upload base64 (tanpa prefix) -> drive_file_id.
async function upload(base64, mime, filename) {
  if (!base64) err503('Data foto kosong.');
  if (TEST_MODE) return 'test-file-' + crypto.randomUUID();
  const drive = driveClient();
  const folder = process.env.DRIVE_FOLDER_ID;
  const { Readable } = require('stream');
  const res = await drive.files.create({
    resource: { name: filename || ('foto-' + Date.now() + '.jpg'), parents: [folder] },
    media: { mimeType: mime || 'image/jpeg', body: Readable.from(Buffer.from(base64, 'base64')) },
    fields: 'id',
  });
  return res.data.id;
}

// URL tampil untuk sebuah drive_file_id.
function url(fileId) {
  if (!fileId) return null;
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
}

// Hapus file (best-effort; gagal diabaikan agar tidak mengganggu alur utama).
async function remove(fileId) {
  if (!fileId || TEST_MODE) return true;
  try { await driveClient().files.delete({ fileId }); } catch (e) { /* abaikan */ }
  return true;
}

module.exports = { upload, url, remove };
