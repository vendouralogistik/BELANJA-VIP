'use strict';
/**
 * 1. Auth — cakupan wajib:
 *  - login salah -> 401
 *  - login benar (admin seed) -> token
 *  - tanpa token akses /api/kasbon -> 401
 *  - rute publik (/api/s/:token, /api/version) tanpa token -> OK
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { freshRequest, login, buatKasbon, ADMIN_USERNAME, ADMIN_PASSWORD } = require('./_helper');

describe('Auth', () => {
  it('login dengan password salah -> 401 + { error }', async () => {
    const api = freshRequest();
    const res = await api
      .post('/api/login')
      .send({ username: ADMIN_USERNAME, password: 'password-yang-pasti-salah' });
    assert.equal(res.status, 401);
    assert.ok(res.body.error, 'body harus memuat { error }');
  });

  it('login dengan username salah -> 401', async () => {
    const api = freshRequest();
    const res = await api
      .post('/api/login')
      .send({ username: 'bukan-admin', password: ADMIN_PASSWORD });
    assert.equal(res.status, 401);
  });

  it('login benar (admin seed) -> 200 { token, user }', async () => {
    const api = freshRequest();
    const res = await api
      .post('/api/login')
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.token === 'string' && res.body.token.length > 0, 'harus ada token');
    assert.equal(res.body.user.username, ADMIN_USERNAME);
    assert.ok(res.body.user.nama, 'user harus memuat nama');
  });

  it('tanpa token: GET /api/kasbon -> 401', async () => {
    const api = freshRequest();
    const res = await api.get('/api/kasbon');
    assert.equal(res.status, 401);
    assert.ok(res.body.error);
  });

  it('tanpa token: POST /api/kasbon -> 401', async () => {
    const api = freshRequest();
    const res = await api.post('/api/kasbon').send({ jumlah: 1 });
    assert.equal(res.status, 401);
  });

  it('tanpa token: GET /api/version -> 200 (publik)', async () => {
    const api = freshRequest();
    const res = await api.get('/api/version');
    assert.equal(res.status, 200);
    assert.equal(res.body.version, '1.0.0');
    assert.equal(res.body.dbMode, 'test', 'dalam TEST_MODE dbMode harus "test"');
  });

  it('rute publik LPJ: GET /api/s/:token tanpa token -> 200', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const share = await client.post(`/api/kasbon/${kasbon.id}/share`);
    assert.equal(share.status, 200);
    const url = share.body.url;
    assert.match(url, /^\/s\/.+/);

    const publik = client.api; // instansi SAMA, tanpa header Authorization
    const res = await publik.get(`/api${url}`); // endpoint API: /api/s/:token (url "/s/.." adalah path frontend)
    assert.equal(res.status, 200, `GET ${url} publik harus 200, dapat ${res.status}`);
    assert.ok(res.body.kasbon, 'LPJ publik harus memuat kasbon');
  });

  it('token salah / tidak dikenal: GET /api/s/:token -> 404', async () => {
    const api = freshRequest();
    const res = await api.get('/api/s/token-tidak-ada-123');
    assert.equal(res.status, 404);
  });

  it('GET /api/me dengan token -> 200; logout -> { ok:true }', async () => {
    const client = await login();
    const me = await client.get('/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.username, ADMIN_USERNAME);

    const out = await client.post('/api/logout');
    assert.equal(out.status, 200);
    assert.equal(out.body.ok, true);
  });

  it('ganti password: PUT /api/me/password -> login lama gagal, login baru OK', async () => {
    const client = await login();
    const ganti = await client
      .put('/api/me/password')
      .send({ old_password: ADMIN_PASSWORD, new_password: 'rahasia-baru-1' });
    assert.equal(ganti.status, 200);
    assert.equal(ganti.body.ok, true);

    const percobaanLama = await client.api
      .post('/api/login')
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    assert.equal(percobaanLama.status, 401, 'password lama harus sudah tidak berlaku');

    const percobaanBaru = await client.api
      .post('/api/login')
      .send({ username: ADMIN_USERNAME, password: 'rahasia-baru-1' });
    assert.equal(percobaanBaru.status, 200, 'password baru harus bisa login');
  });
});
