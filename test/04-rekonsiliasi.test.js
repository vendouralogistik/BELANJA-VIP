'use strict';
/**
 * 4. Rekonsiliasi — cakupan wajib (aturan CONTRACT.md):
 *    sisa < 0 -> NOMBOK; else persen_terpakai >= 90 -> HAMPIR HABIS; else AMAN.
 *
 *  Skenario: kasbon 1.000.000
 *   - belanja 500.000             -> AMAN, sisa 500.000
 *   - + belanja 400.000 (90%)     -> HAMPIR HABIS
 *   - + belanja 200.000 (110%)    -> NOMBOK, sisa -100.000
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { login, buatKasbon, foto } = require('./_helper');

async function belanjaNominal(client, kasbonId, nominal, nama) {
  const res = await client.post('/api/belanja').send({
    kasbon_id: kasbonId,
    tanggal: '2026-10-07',
    toko: 'Toko Jaya',
    items: [{ nama_barang: nama, qty: 1, satuan: 'pcs', harga_satuan: nominal }],
    fotos: [foto()],
  });
  assert.equal(res.status, 201);
  return res.body.belanja || res.body;
}

async function rekap(client, kasbonId) {
  const res = await client.get(`/api/kasbon/${kasbonId}/rekap`);
  assert.equal(res.status, 200, `GET rekap harus 200: ${JSON.stringify(res.body)}`);
  return res.body.rekap || res.body;
}

describe('Rekonsiliasi', () => {
  it('kasbon 1jt, belanja 500rb -> AMAN, sisa 500rb', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client, { jumlah: 1000000 });
    await belanjaNominal(client, kasbon.id, 500000, 'Oli drum');

    const r = await rekap(client, kasbon.id);
    assert.equal(r.diterima, 1000000);
    assert.equal(r.terpakai, 500000);
    assert.equal(r.sisa, 500000);
    assert.equal(r.persen_terpakai, 50);
    assert.equal(r.status, 'AMAN');
  });

  it('tambah belanja 400rb (total 90%) -> HAMPIR HABIS', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client, { jumlah: 1000000 });
    await belanjaNominal(client, kasbon.id, 500000, 'Oli drum');
    await belanjaNominal(client, kasbon.id, 400000, 'Filter set');

    const r = await rekap(client, kasbon.id);
    assert.equal(r.terpakai, 900000);
    assert.equal(r.sisa, 100000);
    assert.equal(r.persen_terpakai, 90);
    assert.equal(r.status, 'HAMPIR HABIS');
  });

  it('tambah belanja 200rb (total 110%) -> NOMBOK, sisa -100rb', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client, { jumlah: 1000000 });
    await belanjaNominal(client, kasbon.id, 500000, 'Oli drum');
    await belanjaNominal(client, kasbon.id, 400000, 'Filter set');
    await belanjaNominal(client, kasbon.id, 200000, 'Grease');

    const r = await rekap(client, kasbon.id);
    assert.equal(r.terpakai, 1100000);
    assert.equal(r.sisa, -100000);
    assert.equal(r.persen_terpakai, 110);
    assert.equal(r.status, 'NOMBOK');
  });

  it('rekap selalu dihitung dari data (computed): edit belanja mengubah rekap', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client, { jumlah: 1000000 });
    const b = await belanjaNominal(client, kasbon.id, 900000, 'Sparepart');

    let r = await rekap(client, kasbon.id);
    assert.equal(r.status, 'HAMPIR HABIS');

    // Kecilkan belanja -> status harus kembali AMAN tanpa input manual apa pun.
    const edit = await client.put(`/api/belanja/${b.id}`).send({
      kasbon_id: kasbon.id,
      tanggal: '2026-10-07',
      toko: 'Toko Jaya',
      items: [{ nama_barang: 'Sparepart', qty: 1, satuan: 'pcs', harga_satuan: 100000 }],
      fotos: b.fotos.map((f) => ({ id: f.id })),
    });
    assert.equal(edit.status, 200);

    r = await rekap(client, kasbon.id);
    assert.equal(r.terpakai, 100000);
    assert.equal(r.sisa, 900000);
    assert.equal(r.status, 'AMAN');
  });

  it('daftar kasbon memuat rekap per kasbon', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client, { jumlah: 1000000 });
    await belanjaNominal(client, kasbon.id, 1100000, 'Nombok test');

    const res = await client.get('/api/kasbon?status=aktif');
    assert.equal(res.status, 200);
    const k = res.body.kasbon.find((x) => x.id === kasbon.id);
    assert.ok(k && k.rekap, 'daftar harus memuat rekap');
    assert.equal(k.rekap.status, 'NOMBOK');
    assert.equal(k.rekap.sisa, -100000);
  });
});
