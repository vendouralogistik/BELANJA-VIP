'use strict';
/**
 * 3. Belanja — cakupan wajib:
 *  - ke kasbon aktif OK (total = item + biaya, dihitung server;
 *    kirim total ngawur -> server harus mengabaikan)
 *  - tanpa foto -> 400
 *  - tanpa item & tanpa biaya -> 400
 *  - ke kasbon selesai -> 409
 *  - edit & hapus saat aktif OK
 *  - setelah tutup kasbon: edit -> 409
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { login, buatKasbon, tutupKasbon, foto, driveUrl } = require('./_helper');

function belanjaDasar(kasbonId, overrides = {}) {
  return {
    kasbon_id: kasbonId,
    tanggal: '2026-10-07',
    toko: 'Toko Jaya',
    items: [{ nama_barang: 'Filter oli', qty: 2, satuan: 'pcs', harga_satuan: 75000 }],
    biaya_lain: [{ jenis: 'ongkos', jumlah: 20000, keterangan: 'ojek' }],
    fotos: [foto()],
    ...overrides,
  };
}

describe('Belanja', () => {
  it('buat belanja ke kasbon aktif -> 201; total dihitung server (total ngawur diabaikan)', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    // 2x75000 = 150000 (item) + 20000 (biaya) = 170000. Kirim total ngawur:
    const res = await client
      .post('/api/belanja')
      .send({ ...belanjaDasar(kasbon.id), total: 99999999, total_item: 1, total_biaya: 2 });
    assert.equal(res.status, 201, `harus 201, dapat ${res.status}: ${JSON.stringify(res.body)}`);
    const b = res.body.belanja || res.body;
    assert.equal(b.total_item, 150000, 'total_item = 2 x 75000');
    assert.equal(b.total_biaya, 20000, 'total_biaya = 20000');
    assert.equal(b.total, 170000, 'total = item + biaya; angka kiriman client diabaikan');
    assert.equal(b.items[0].subtotal, 150000);
    assert.equal(b.fotos.length, 1);
    assert.ok(b.fotos[0].drive_file_id, 'foto harus punya drive_file_id');
    assert.equal(b.fotos[0].url, driveUrl(b.fotos[0].drive_file_id));
  });

  it('belanja TANPA foto -> 400', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const res = await client.post('/api/belanja').send(belanjaDasar(kasbon.id, { fotos: [] }));
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('belanja tanpa item DAN tanpa biaya -> 400', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const res = await client
      .post('/api/belanja')
      .send(belanjaDasar(kasbon.id, { items: [], biaya_lain: [] }));
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('belanja hanya biaya_lain (tanpa item) -> tetap OK', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const res = await client
      .post('/api/belanja')
      .send(
        belanjaDasar(kasbon.id, {
          items: [],
          biaya_lain: [{ jenis: 'parkir', jumlah: 5000, keterangan: '' }],
        })
      );
    assert.equal(res.status, 201);
    const b = res.body.belanja || res.body;
    assert.equal(b.total, 5000);
  });

  it('belanja ke kasbon yang sudah SELESAI -> 409', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    await tutupKasbon(client, kasbon.id);
    const res = await client.post('/api/belanja').send(belanjaDasar(kasbon.id));
    assert.equal(res.status, 409);
    assert.ok(res.body.error);
  });

  it('belanja ke kasbon_id tidak dikenal -> 404', async () => {
    const client = await login();
    const res = await client.post('/api/belanja').send(belanjaDasar('kasbon-tidak-ada'));
    assert.equal(res.status, 404);
  });

  it('GET /api/belanja/:id -> belanja lengkap', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const buat = await client.post('/api/belanja').send(belanjaDasar(kasbon.id));
    const b = buat.body.belanja || buat.body;
    const res = await client.get(`/api/belanja/${b.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 170000);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.biaya_lain.length, 1);
    assert.equal(res.body.fotos.length, 1);
  });

  it('edit belanja saat kasbon aktif -> 200 (ganti total)', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const buat = await client.post('/api/belanja').send(belanjaDasar(kasbon.id));
    const b = buat.body.belanja || buat.body;
    const res = await client.put(`/api/belanja/${b.id}`).send({
      ...belanjaDasar(kasbon.id),
      items: [{ nama_barang: 'Filter oli', qty: 1, satuan: 'pcs', harga_satuan: 75000 }],
      biaya_lain: [],
      fotos: b.fotos.map((f) => ({ id: f.id })),
      total: 12345, // ngawur lagi -> harus diabaikan
    });
    assert.equal(res.status, 200, `harus 200, dapat ${res.status}: ${JSON.stringify(res.body)}`);
    const upd = res.body.belanja || res.body;
    assert.equal(upd.total, 75000, 'total baru = 1 x 75000');
  });

  it('hapus belanja saat kasbon aktif -> 200 { ok:true }', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const buat = await client.post('/api/belanja').send(belanjaDasar(kasbon.id));
    const b = buat.body.belanja || buat.body;
    const res = await client.delete(`/api/belanja/${b.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const cek = await client.get(`/api/belanja/${b.id}`);
    assert.equal(cek.status, 404);
  });

  it('setelah tutup kasbon: edit belanja -> 409; hapus belanja -> 409', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const buat = await client.post('/api/belanja').send(belanjaDasar(kasbon.id));
    const b = buat.body.belanja || buat.body;
    await tutupKasbon(client, kasbon.id);

    const edit = await client.put(`/api/belanja/${b.id}`).send(belanjaDasar(kasbon.id));
    assert.equal(edit.status, 409, 'edit setelah tutup harus 409');

    const hapus = await client.delete(`/api/belanja/${b.id}`);
    assert.equal(hapus.status, 409, 'hapus setelah tutup harus 409');
  });
});
