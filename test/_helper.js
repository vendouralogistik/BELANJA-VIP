'use strict';
/**
 * Helper bersama seluruh test Belanja VIP.
 *
 * HERMETIK: memaksa TEST_MODE=1 SEBELUM server dimuat, sehingga
 * utils/sheetsDb.js & utils/driveStore.js memakai fake in-memory
 * (interface identik dengan versi Google asli). Tidak ada kredensial,
 * tidak ada akses jaringan ke Google.
 *
 * Tiap pemanggilan login()/freshClient() memuat ulang server.js dari nol
 * (cache modul dibongkar) -> tiap test mendapat database in-memory baru.
 *
 * ASUMSI KONTRAK (wajib dipenuhi server.js milik spesialis backend):
 *  - server.js mengekspor express app (module.exports = app, atau { app }),
 *    dan HANYA listen() saat dijalankan langsung (node server.js),
 *    bukan saat di-require oleh test.
 *  - Di TEST_MODE, backend men-seed user admin:
 *      username = process.env.ADMIN_USERNAME || 'admin'
 *      password = process.env.ADMIN_PASSWORD || 'belanjavip123'
 *    (default 'belanjavip123' adalah nilai default terdokumentasi di
 *    CONTRACT.md, bukan kredensial asli.)
 */

process.env.TEST_MODE = '1';

const assert = require('node:assert/strict');
const path = require('node:path');
const request = require('supertest');

const APP_ROOT = path.join(__dirname, '..');
const SERVER_PATH = path.join(APP_ROOT, 'server.js');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
// Default seed terdokumentasi di CONTRACT.md — ganti via env ADMIN_PASSWORD.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'belanjavip123';

// JPEG 1x1 px valid — cukup sebagai "foto" untuk jalur upload fake.
const FOTO_JPEG_1PX_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////2wBDAf//////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXl5e3x9fn9xEAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKS0VTV1hZWmNkZWZnaGlqc3R1dnd4eXl5fn9x/8AAEQgAAQABAwERAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/AAMBAQEBAQEBAQAAAAAAAAAAAED/2gAIAQEAAT8AH//Z';

function foto(mime = 'image/jpeg') {
  return { data: FOTO_JPEG_1PX_BASE64, mime };
}

/** Bentuk URL tampil foto sesuai CONTRACT.md */
function driveUrl(fileId) {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
}

function freshRequest() {
  for (const key of Object.keys(require.cache)) {
    if (
      key === SERVER_PATH ||
      key.startsWith(path.join(APP_ROOT, 'utils') + path.sep) ||
      key.startsWith(path.join(APP_ROOT, 'routes') + path.sep)
    ) {
      delete require.cache[key];
    }
  }
  let exported;
  try {
    exported = require(SERVER_PATH);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        `GAGAL MEMUAT BACKEND: ${SERVER_PATH} belum ada.\n` +
          'Spesialis backend wajib membuat server.js yang mengekspor express app ' +
          '(tanpa listen saat di-require) + routes/ + utils/sheetsDb.js & utils/driveStore.js ' +
          'dengan mode fake in-memory saat TEST_MODE=1.'
      );
    }
    throw err;
  }
  const app = exported && exported.app ? exported.app : exported;
  if (typeof app !== 'function') {
    throw new Error(
      'server.js tidak mengekspor express app. ' +
        'Kontrak: module.exports = app (atau { app }).'
    );
  }
  return request(app);
}

/**
 * Login sebagai admin seed -> client supertest yang otomatis membawa
 * header Authorization: Bearer <token>.
 */
async function login() {
  const api = freshRequest();
  const res = await api
    .post('/api/login')
    .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  assert.equal(
    res.status,
    200,
    `login admin seed harus 200, dapat ${res.status}: ${JSON.stringify(res.body)}`
  );
  assert.ok(res.body.token, 'login harus mengembalikan { token }');
  assert.ok(res.body.user && res.body.user.username, 'login harus mengembalikan { user }');
  const token = res.body.token;
  const withAuth = (req) => req.set('Authorization', `Bearer ${token}`);
  return {
    api,
    token,
    user: res.body.user,
    get: (url) => withAuth(api.get(url)),
    post: (url) => withAuth(api.post(url)),
    put: (url) => withAuth(api.put(url)),
    delete: (url) => withAuth(api.delete(url)),
  };
}

/** Buat kasbon tunai 1 jt; kembalikan objek kasbon dari respons. */
async function buatKasbon(client, overrides = {}) {
  const res = await client.post('/api/kasbon').send({
    tanggal: '2026-10-07',
    jumlah: 1000000,
    keperluan: 'Belanja sparepart Exca 17',
    pemberi: 'Bendahara',
    metode: 'tunai',
    ...overrides,
  });
  assert.equal(
    res.status,
    201,
    `POST /api/kasbon harus 201, dapat ${res.status}: ${JSON.stringify(res.body)}`
  );
  return res.body.kasbon || res.body;
}

/** Buat satu belanja lengkap (1 item + 1 foto); kembalikan objek belanja. */
async function buatBelanja(client, kasbonId, overrides = {}) {
  const res = await client.post('/api/belanja').send({
    kasbon_id: kasbonId,
    tanggal: '2026-10-07',
    toko: 'Toko Jaya',
    items: [{ nama_barang: 'Filter oli', qty: 2, satuan: 'pcs', harga_satuan: 75000 }],
    biaya_lain: [{ jenis: 'ongkos', jumlah: 20000, keterangan: 'ojek' }],
    fotos: [foto()],
    ...overrides,
  });
  assert.equal(
    res.status,
    201,
    `POST /api/belanja harus 201, dapat ${res.status}: ${JSON.stringify(res.body)}`
  );
  return res.body.belanja || res.body;
}

/** Tutup kasbon dengan setoran; kembalikan hasil GET /api/kasbon/:id sesudahnya. */
async function tutupKasbon(client, kasbonId, setoran = { tanggal: '2026-10-07', jumlah: 0, metode: 'tunai' }) {
  const res = await client.post(`/api/kasbon/${kasbonId}/tutup`).send({ setoran });
  assert.equal(
    res.status,
    200,
    `POST tutup harus 200, dapat ${res.status}: ${JSON.stringify(res.body)}`
  );
  const detail = await client.get(`/api/kasbon/${kasbonId}`);
  assert.equal(detail.status, 200);
  const kasbon = detail.body.kasbon || detail.body;
  assert.equal(kasbon.status, 'selesai', 'kasbon harus berstatus selesai setelah tutup');
  return { kasbon, setoran: detail.body.setoran ?? null, raw: res.body };
}

module.exports = {
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  foto,
  driveUrl,
  freshRequest,
  login,
  buatKasbon,
  buatBelanja,
  tutupKasbon,
};
