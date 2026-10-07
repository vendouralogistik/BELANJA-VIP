'use strict';
/**
 * 8. Rekap bulanan & pencarian — cakupan wajib:
 *  - data uji -> GET /api/rekap-bulanan?bulan= -> hasil benar
 *  - GET /api/belanja?q= -> cocok nama barang / nama toko
 *  - filter kasbon_id & rentang tanggal
 *
 * CATATAN: CONTRACT.md menetapkan pencarian lewat GET /api/belanja?q=&kasbon_id=&from=&to=
 * (SPESIFIKASI.md bagian 8 menulis /api/belanja/cari?q= secara ringkas).
 * Test mengacu ke CONTRACT.md sebagai sumber bentuk request/response.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { login, buatKasbon, foto } = require('./_helper');

async function belanja(client, kasbonId, { tanggal, toko, nama, nominal }) {
  const res = await client.post('/api/belanja').send({
    kasbon_id: kasbonId,
    tanggal,
    toko,
    items: [{ nama_barang: nama, qty: 1, satuan: 'pcs', harga_satuan: nominal }],
    fotos: [foto()],
  });
  assert.equal(res.status, 201);
  return res.body.belanja || res.body;
}

async function seedRekap(client) {
  const k1 = await buatKasbon(client, { tanggal: '2026-10-05' });
  const k2 = await buatKasbon(client, { tanggal: '2026-10-06' });
  await belanja(client, k1.id, {
    tanggal: '2026-10-05',
    toko: 'Toko Jaya',
    nama: 'Filter oli',
    nominal: 300000,
  });
  await belanja(client, k1.id, {
    tanggal: '2026-10-06',
    toko: 'Toko Makmur',
    nama: 'V-Belt',
    nominal: 200000,
  });
  await belanja(client, k2.id, {
    tanggal: '2026-10-07',
    toko: 'Toko Jaya',
    nama: 'Oli hidrolik',
    nominal: 100000,
  });
  return { k1, k2 };
}

describe('Rekap bulanan & pencarian', () => {
  it('GET /api/rekap-bulanan?bulan=2026-10 -> angka benar', async () => {
    const client = await login();
    await seedRekap(client);

    const res = await client.get('/api/rekap-bulanan?bulan=2026-10');
    assert.equal(res.status, 200, `harus 200: ${JSON.stringify(res.body)}`);
    const r = res.body;
    assert.equal(r.bulan, '2026-10');
    assert.equal(r.total_belanja, 600000, '300rb + 200rb + 100rb');
    assert.equal(r.jumlah_transaksi, 3);
    assert.equal(r.rata_per_kasbon, 300000, '600rb / 2 kasbon');
    assert.ok(Array.isArray(r.top_toko), 'harus ada top_toko');
    assert.ok(r.top_toko.length <= 5, 'top toko maksimal 5');
    assert.equal(r.top_toko[0].toko, 'Toko Jaya');
    assert.equal(r.top_toko[0].total, 400000, 'Toko Jaya: 300rb + 100rb');
    assert.equal(r.top_toko[1].toko, 'Toko Makmur');
    assert.equal(r.top_toko[1].total, 200000);
  });

  it('bulan tanpa data -> total 0', async () => {
    const client = await login();
    await seedRekap(client);
    const res = await client.get('/api/rekap-bulanan?bulan=2025-01');
    assert.equal(res.status, 200);
    assert.equal(res.body.total_belanja, 0);
    assert.equal(res.body.jumlah_transaksi, 0);
  });

  it('format bulan salah -> 400', async () => {
    const client = await login();
    const res = await client.get('/api/rekap-bulanan?bulan=oktober-2026');
    assert.equal(res.status, 400);
  });

  it('cari q cocok ke nama barang', async () => {
    const client = await login();
    await seedRekap(client);
    const res = await client.get('/api/belanja?q=Filter%20oli');
    assert.equal(res.status, 200);
    assert.equal(res.body.belanja.length, 1);
    assert.equal(res.body.belanja[0].items[0].nama_barang, 'Filter oli');
  });

  it('cari q cocok ke nama toko', async () => {
    const client = await login();
    await seedRekap(client);
    const res = await client.get('/api/belanja?q=Toko%20Makmur');
    assert.equal(res.status, 200);
    assert.equal(res.body.belanja.length, 1);
    assert.equal(res.body.belanja[0].toko, 'Toko Makmur');
  });

  it('cari q tanpa hasil -> array kosong', async () => {
    const client = await login();
    await seedRekap(client);
    const res = await client.get('/api/belanja?q=barang-yang-tidak-ada');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.belanja, []);
  });

  it('filter kasbon_id -> hanya belanja kasbon itu', async () => {
    const client = await login();
    const { k1, k2 } = await seedRekap(client);
    const res = await client.get(`/api/belanja?kasbon_id=${k1.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.belanja.length, 2);
    assert.ok(res.body.belanja.every((b) => b.kasbon_id === k1.id));

    const res2 = await client.get(`/api/belanja?kasbon_id=${k2.id}`);
    assert.equal(res2.body.belanja.length, 1);
  });

  it('filter rentang tanggal from & to', async () => {
    const client = await login();
    await seedRekap(client);
    const res = await client.get('/api/belanja?from=2026-10-06&to=2026-10-06');
    assert.equal(res.status, 200);
    assert.equal(res.body.belanja.length, 1);
    assert.equal(res.body.belanja[0].tanggal, '2026-10-06');
  });
});
