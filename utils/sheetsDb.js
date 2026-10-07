// utils/sheetsDb.js — adapter database Google Sheets (+ fake in-memory saat TEST_MODE=1).
// Interface IDENTIK di kedua mode (semua async):
//   all(tab) -> [row], find(tab, pred) -> [row], findOne(tab, pred) -> row|null,
//   insert(tab, row) -> row (id UUID dibuat otomatis), update(tab, id, patch) -> row,
//   remove(tab, id) -> true. Semua baca/tulis berdasar NAMA KOLOM (header baris 1).
// Jika env Google belum lengkap, semua operasi DB melempar error {status:503}.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const TEST_MODE = process.env.TEST_MODE === '1';

// Header resmi tiap tab — baris 1 spreadsheet. Urutan kolom A dst.
const TAB_HEADERS = {
  users: ['id', 'username', 'password_hash', 'nama', 'created_at'],
  kasbon: ['id', 'user_id', 'tanggal', 'jumlah', 'keperluan', 'pemberi', 'metode',
    'bukti_transfer_drive_id', 'catatan', 'status', 'disetujui_oleh', 'disetujui_at',
    'created_at', 'closed_at'],
  belanja: ['id', 'kasbon_id', 'tanggal', 'toko', 'catatan', 'created_at'],
  belanja_item: ['id', 'belanja_id', 'nama_barang', 'qty', 'satuan', 'harga_satuan'],
  biaya_lain: ['id', 'belanja_id', 'jenis', 'jumlah', 'keterangan'],
  nota_foto: ['id', 'belanja_id', 'drive_file_id', 'created_at'],
  setoran: ['id', 'kasbon_id', 'tanggal', 'jumlah', 'metode', 'bukti_transfer_drive_id',
    'catatan', 'created_at'],
  lpj_share: ['id', 'kasbon_id', 'token', 'created_at'],
};

function err503(msg) { const e = new Error(msg); e.status = 503; throw e; }
function err404(msg) { const e = new Error(msg); e.status = 404; throw e; }

// Indeks 0-based -> huruf kolom spreadsheet (0=A, 26=AA, ...).
function colLetter(n) {
  let s = '';
  n += 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function dbMode() { return TEST_MODE ? 'test' : 'sheets'; }

function configured() {
  return TEST_MODE || (!!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !!process.env.SPREADSHEET_ID);
}

/* ---------------- mode fake in-memory (TEST_MODE=1) ---------------- */
const mem = {};
for (const t of Object.keys(TAB_HEADERS)) mem[t] = [];

const memDb = {
  async all(tab) { return mem[tab].map(r => ({ ...r })); },
  async find(tab, pred) { return mem[tab].filter(pred).map(r => ({ ...r })); },
  async findOne(tab, pred) { const r = mem[tab].find(pred); return r ? { ...r } : null; },
  async insert(tab, row) {
    const rec = { ...row };
    if (!rec.id) rec.id = crypto.randomUUID();
    mem[tab].push(rec);
    return { ...rec };
  },
  async update(tab, id, patch) {
    const i = mem[tab].findIndex(r => r.id === id);
    if (i < 0) err404(`Data ${tab} tidak ditemukan.`);
    mem[tab][i] = { ...mem[tab][i], ...patch, id };
    return { ...mem[tab][i] };
  },
  async remove(tab, id) {
    const i = mem[tab].findIndex(r => r.id === id);
    if (i < 0) err404(`Data ${tab} tidak ditemukan.`);
    mem[tab].splice(i, 1);
    return true;
  },
};

/* ---------------- mode Google Sheets asli ---------------- */
let _sheets = null;
function sheetsClient() {
  if (_sheets) return _sheets;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const sid = process.env.SPREADSHEET_ID;
  if (!raw || !sid) err503('Database belum dikonfigurasi: isi GOOGLE_SERVICE_ACCOUNT_JSON & SPREADSHEET_ID di env.');
  let sa;
  try { sa = JSON.parse(raw); }
  catch (e) { err503('GOOGLE_SERVICE_ACCOUNT_JSON bukan JSON yang valid.'); }
  const { google } = require('googleapis');
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  });
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

function spreadsheetId() {
  const sid = process.env.SPREADSHEET_ID;
  if (!sid) err503('Database belum dikonfigurasi: SPREADSHEET_ID belum diisi.');
  return sid;
}

// Cache baca per tab (TTL singkat) — menekan pola N+1 ke Sheets API.
// Kuota gratis Sheets: 60 read/menit. Tanpa cache, 1x buka dashboard = 4x(jumlah kasbon) reads.
const CACHE_TTL_MS = 15000;
const _tabCache = new Map(); // tab -> { at, data }
function bustCache(tab) { _tabCache.delete(tab); }

function isQuotaError(e) {
  const code = e && (e.code || (e.response && e.response.status));
  const msg = String((e && e.message) || '');
  return code === 429 || /quota|rate.?limit/i.test(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ambil semua baris satu tab beserta nomor barisnya (untuk update/hapus).
async function readTab(tab) {
  const now = Date.now();
  const hit = _tabCache.get(tab);
  if (hit && (now - hit.at) < CACHE_TTL_MS) return hit.data;
  const sheets = sheetsClient();
  const ambil = () => sheets.spreadsheets.values.get({ spreadsheetId: spreadsheetId(), range: tab });
  let res;
  try {
    res = await ambil();
  } catch (e) {
    if (!isQuotaError(e)) throw e;
    await sleep(2000); // retry 1x khusus kuota
    try { res = await ambil(); }
    catch (e2) {
      if (isQuotaError(e2)) {
        const err = new Error('Google Sheets sedang sibuk (batas pemakaian sementara tercapai). Tunggu beberapa detik lalu coba lagi.');
        err.status = 429; throw err;
      }
      throw e2;
    }
  }
  const values = res.data.values || [];
  if (values.length === 0) {
    const kosong = { header: TAB_HEADERS[tab], rows: [] };
    _tabCache.set(tab, { at: now, data: kosong });
    return kosong;
  }
  const header = values[0];
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    const obj = {};
    for (let c = 0; c < header.length; c++) {
      const val = c < v.length ? v[c] : '';
      obj[header[c]] = (val === '' ? null : val);
    }
    if (!obj.id) continue; // lewati baris kosong
    rows.push({ rowNum: i + 1, obj });
  }
  const hasil = { header: TAB_HEADERS[tab], rows };
  _tabCache.set(tab, { at: now, data: hasil });
  return hasil;
}

const sheetsDb = {
  async all(tab) { return (await readTab(tab)).rows.map(r => r.obj); },
  async find(tab, pred) { return (await this.all(tab)).filter(pred); },
  async findOne(tab, pred) { const r = (await this.all(tab)).find(pred); return r || null; },
  async insert(tab, row) {
    const rec = { ...row };
    if (!rec.id) rec.id = crypto.randomUUID();
    const headers = TAB_HEADERS[tab];
    const arr = headers.map(h => (rec[h] === null || rec[h] === undefined ? '' : String(rec[h])));
    const sheets = sheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId(),
      range: `${tab}!A:${colLetter(headers.length - 1)}`,
      valueInputOption: 'RAW',
      resource: { values: [arr] },
    });
    bustCache(tab);
    return rec;
  },
  async update(tab, id, patch) {
    const { rows } = await readTab(tab);
    const found = rows.find(r => r.obj.id === id);
    if (!found) err404(`Data ${tab} tidak ditemukan.`);
    const headers = TAB_HEADERS[tab];
    const merged = { ...found.obj, ...patch, id };
    const arr = headers.map(h => (merged[h] === null || merged[h] === undefined ? '' : String(merged[h])));
    const sheets = sheetsClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId(),
      range: `${tab}!A${found.rowNum}:${colLetter(headers.length - 1)}${found.rowNum}`,
      valueInputOption: 'RAW',
      resource: { values: [arr] },
    });
    bustCache(tab);
    return merged;
  },
  async remove(tab, id) {
    const { rows } = await readTab(tab);
    const found = rows.find(r => r.obj.id === id);
    if (!found) err404(`Data ${tab} tidak ditemukan.`);
    const sheets = sheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: spreadsheetId(), fields: 'sheets.properties' });
    const sheet = (meta.data.sheets || []).find(s => s.properties.title === tab);
    if (!sheet) err404(`Tab ${tab} tidak ditemukan.`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: spreadsheetId(),
      resource: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: sheet.properties.sheetId,
              dimension: 'ROWS',
              startIndex: found.rowNum - 1,
              endIndex: found.rowNum,
            },
          },
        }],
      },
    });
    bustCache(tab);
    return true;
  },
};

/* ---------------- init: pastikan tab+header, seed admin ---------------- */
async function seedAdminIfEmpty() {
  const users = await db.all('users');
  if (users.length > 0) return;
  const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'belanjavip123', 10);
  const username = process.env.ADMIN_USERNAME || 'admin';
  await db.insert('users', {
    username,
    password_hash: hash,
    nama: 'Administrator',
    created_at: new Date().toISOString(),
  });
  console.log(`[sheetsDb] seed admin dibuat (username: ${username}).`);
}

async function init() {
  try {
    if (TEST_MODE) {
      await seedAdminIfEmpty();
      return;
    }
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.SPREADSHEET_ID) {
      console.warn('[sheetsDb] env Google belum lengkap — API yang butuh DB akan balas 503.');
      return;
    }
    const sheets = sheetsClient();
    const sid = spreadsheetId();
    // Pastikan 8 tab ada.
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sid, fields: 'sheets.properties' });
    const titles = new Set((meta.data.sheets || []).map(s => s.properties.title));
    for (const tab of Object.keys(TAB_HEADERS)) {
      if (!titles.has(tab)) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: sid,
          resource: { requests: [{ addSheet: { properties: { title: tab } } }] },
        });
        console.log(`[sheetsDb] tab "${tab}" dibuat.`);
      }
      // Pastikan header baris 1 persis.
      const headers = TAB_HEADERS[tab];
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: sid, range: `${tab}!1:1` });
      const first = (r.data.values && r.data.values[0]) || [];
      if (first.length === 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: sid,
          range: `${tab}!A1:${colLetter(headers.length - 1)}1`,
          valueInputOption: 'RAW',
          resource: { values: [headers] },
        });
        console.log(`[sheetsDb] header tab "${tab}" ditulis.`);
      }
    }
    await seedAdminIfEmpty();
  } catch (e) {
    // Boot tetap jalan; request DB akan melempar 503/500 sendiri.
    console.error('[sheetsDb] init gagal:', e.message);
  }
}

const db = TEST_MODE ? memDb : sheetsDb;

module.exports = {
  all: (...a) => db.all(...a),
  find: (...a) => db.find(...a),
  findOne: (...a) => db.findOne(...a),
  insert: (...a) => db.insert(...a),
  update: (...a) => db.update(...a),
  remove: (...a) => db.remove(...a),
  init,
  dbMode,
  configured,
  TAB_HEADERS,
};
