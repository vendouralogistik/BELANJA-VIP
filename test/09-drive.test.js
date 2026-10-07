'use strict';
/**
 * 9. Drive fake (TEST_MODE) — cakupan wajib:
 *  - upload foto mengembalikan file id
 *  - URL terbentuk benar: https://drive.google.com/thumbnail?id=<FILE_ID>&sz=w1000
 *  - berlaku untuk foto nota (belanja) maupun bukti transfer (kasbon/setoran)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { login, buatKasbon, tutupKasbon, foto, driveUrl } = require('./_helper');

describe('Drive fake (TEST_MODE)', () => {
  it('upload foto nota -> drive_file_id terisi + url terbentuk benar', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const res = await client.post('/api/belanja').send({
      kasbon_id: kasbon.id,
      tanggal: '2026-10-07',
      toko: 'Toko Jaya',
      items: [{ nama_barang: 'Filter oli', qty: 1, satuan: 'pcs', harga_satuan: 50000 }],
      fotos: [foto()],
    });
    assert.equal(res.status, 201);
    const b = res.body.belanja || res.body;
    assert.equal(b.fotos.length, 1);
    const f = b.fotos[0];
    assert.ok(typeof f.drive_file_id === 'string' && f.drive_file_id.length > 0,
      'drive_file_id harus string tak-kosong');
    assert.equal(f.url, driveUrl(f.drive_file_id),
      'url harus https://drive.google.com/thumbnail?id=<FILE_ID>&sz=w1000');
  });

  it('beberapa foto -> tiap foto dapat file id UNIK', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const res = await client.post('/api/belanja').send({
      kasbon_id: kasbon.id,
      tanggal: '2026-10-07',
      toko: 'Toko Jaya',
      items: [{ nama_barang: 'Oli', qty: 1, satuan: 'pcs', harga_satuan: 50000 }],
      fotos: [foto(), foto(), foto()],
    });
    assert.equal(res.status, 201);
    const b = res.body.belanja || res.body;
    assert.equal(b.fotos.length, 3);
    const ids = b.fotos.map((f) => f.drive_file_id);
    assert.equal(new Set(ids).size, 3, 'tiap upload harus menghasilkan file id berbeda');
    for (const f of b.fotos) {
      assert.equal(f.url, driveUrl(f.drive_file_id));
    }
  });

  it('bukti transfer kasbon -> drive_file_id + url benar', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client, { metode: 'transfer', bukti_transfer: foto() });
    assert.ok(kasbon.bukti_transfer_drive_id, 'kasbon transfer harus menyimpan drive id bukti');
    assert.equal(kasbon.bukti_transfer_url, driveUrl(kasbon.bukti_transfer_drive_id));
  });

  it('bukti transfer setoran -> drive_file_id + url benar', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const { setoran } = await tutupKasbon(client, kasbon.id, {
      tanggal: '2026-10-07',
      jumlah: 50000,
      metode: 'transfer',
      bukti_transfer: foto(),
    });
    assert.ok(setoran.bukti_transfer_drive_id);
    assert.equal(setoran.bukti_transfer_url, driveUrl(setoran.bukti_transfer_drive_id));
  });

  it('foto nota tetap terbaca lewat GET /api/belanja/:id', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const buat = await client.post('/api/belanja').send({
      kasbon_id: kasbon.id,
      tanggal: '2026-10-07',
      toko: 'Toko Jaya',
      items: [{ nama_barang: 'Filter oli', qty: 1, satuan: 'pcs', harga_satuan: 50000 }],
      fotos: [foto()],
    });
    const b = buat.body.belanja || buat.body;
    const res = await client.get(`/api/belanja/${b.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.fotos[0].drive_file_id, b.fotos[0].drive_file_id);
    assert.equal(res.body.fotos[0].url, driveUrl(b.fotos[0].drive_file_id));
  });
});
