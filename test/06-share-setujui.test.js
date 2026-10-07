'use strict';
/**
 * 6. Share & persetujuan bendahara — cakupan wajib:
 *  - POST share -> { url: "/s/<token>" }
 *  - GET /s/:token tanpa auth -> OK
 *  - POST setujui tanpa nama -> 400
 *  - setujui OK -> status disetujui
 *  - setujui lagi -> 409
 *  - edit belanja setelah disetujui -> 409
 *  - edit kasbon setelah disetujui -> 409
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { login, buatKasbon, buatBelanja, tutupKasbon } = require('./_helper');

async function alurSiapSetuju(client) {
  const kasbon = await buatKasbon(client);
  const belanja = await buatBelanja(client, kasbon.id);
  await tutupKasbon(client, kasbon.id);
  const share = await client.post(`/api/kasbon/${kasbon.id}/share`);
  assert.equal(share.status, 200, `share harus 200: ${JSON.stringify(share.body)}`);
  return { kasbon, belanja, url: share.body.url, apiUrl: `/api${share.body.url}` };
}

describe('Share & persetujuan bendahara', () => {
  it('POST /api/kasbon/:id/share -> { url: "/s/<token>" }', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const res = await client.post(`/api/kasbon/${kasbon.id}/share`);
    assert.equal(res.status, 200);
    assert.match(res.body.url, /^\/s\/[A-Za-z0-9_-]+$/, 'url harus berbentuk /s/<token>');
  });

  it('satu kasbon = satu token: share ulang -> token sama', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const a = await client.post(`/api/kasbon/${kasbon.id}/share`);
    const b = await client.post(`/api/kasbon/${kasbon.id}/share`);
    assert.equal(a.body.url, b.body.url, 'panggil ulang harus mengembalikan token yang sama');
  });

  it('GET /s/:token tanpa auth -> 200 { kasbon, belanja, setoran, rekap }', async () => {
    const client = await login();
    const { apiUrl } = await alurSiapSetuju(client);

    const publik = client.api; // tanpa token
    const res = await publik.get(apiUrl);
    assert.equal(res.status, 200);
    assert.ok(res.body.kasbon, 'harus memuat kasbon');
    assert.ok(Array.isArray(res.body.belanja), 'harus memuat belanja');
    assert.ok('setoran' in res.body, 'harus memuat setoran');
    assert.ok(res.body.rekap, 'harus memuat rekap');
    assert.equal(res.body.belanja.length, 1);
  });

  it('POST setujui TANPA nama -> 400', async () => {
    const client = await login();
    const { apiUrl } = await alurSiapSetuju(client);
    const publik = client.api;
    for (const body of [{}, { nama: '' }, { nama: '   ' }]) {
      const res = await publik.post(`${apiUrl}/setujui`).send(body);
      assert.equal(res.status, 400, `setujui ${JSON.stringify(body)} harus 400`);
    }
  });

  it('setujui dengan nama -> 200, status kasbon jadi disetujui', async () => {
    const client = await login();
    const { kasbon, apiUrl } = await alurSiapSetuju(client);

    const publik = client.api;
    const res = await publik.post(`${apiUrl}/setujui`).send({ nama: 'Budi Bendahara' });
    assert.equal(res.status, 200, `harus 200: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.disetujui_oleh, 'Budi Bendahara');
    assert.ok(res.body.disetujui_at, 'harus ada disetujui_at');

    const detail = await client.get(`/api/kasbon/${kasbon.id}`);
    assert.equal(detail.body.kasbon.status, 'disetujui');
    assert.equal(detail.body.kasbon.disetujui_oleh, 'Budi Bendahara');
  });

  it('setujui LAGI -> 409', async () => {
    const client = await login();
    const { apiUrl } = await alurSiapSetuju(client);
    const publik = client.api;
    const pertama = await publik.post(`${apiUrl}/setujui`).send({ nama: 'Budi' });
    assert.equal(pertama.status, 200);
    const kedua = await publik.post(`${apiUrl}/setujui`).send({ nama: 'Budi' });
    assert.equal(kedua.status, 409);
  });

  it('setujui kasbon yang masih AKTIF (belum ditutup) -> 409', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const share = await client.post(`/api/kasbon/${kasbon.id}/share`);
    const publik = client.api;
    const res = await publik.post(`/api${share.body.url}/setujui`).send({ nama: 'Budi' });
    assert.equal(res.status, 409, 'hanya kasbon selesai yang bisa disetujui');
  });

  it('setelah disetujui: edit belanja -> 409; hapus belanja -> 409', async () => {
    const client = await login();
    const { kasbon, belanja, apiUrl } = await alurSiapSetuju(client);
    await client.api.post(`${apiUrl}/setujui`).send({ nama: 'Budi' });

    const edit = await client.put(`/api/belanja/${belanja.id}`).send({
      kasbon_id: kasbon.id,
      tanggal: '2026-10-07',
      toko: 'Toko X',
      items: [{ nama_barang: 'x', qty: 1, satuan: 'pcs', harga_satuan: 1000 }],
      fotos: belanja.fotos.map((f) => ({ id: f.id })),
    });
    assert.equal(edit.status, 409, 'edit belanja setelah disetujui harus 409');

    const hapus = await client.delete(`/api/belanja/${belanja.id}`);
    assert.equal(hapus.status, 409, 'hapus belanja setelah disetujui harus 409');
  });

  it('setelah disetujui: edit kasbon -> 409; hapus kasbon -> 409; tutup -> 409', async () => {
    const client = await login();
    const { kasbon, apiUrl } = await alurSiapSetuju(client);
    await client.api.post(`${apiUrl}/setujui`).send({ nama: 'Budi' });

    const edit = await client.put(`/api/kasbon/${kasbon.id}`).send({ keperluan: 'ubah' });
    assert.equal(edit.status, 409, 'edit kasbon setelah disetujui harus 409');

    const hapus = await client.delete(`/api/kasbon/${kasbon.id}`);
    assert.equal(hapus.status, 409);

    const tutup = await client.post(`/api/kasbon/${kasbon.id}/tutup`).send({
      setoran: { tanggal: '2026-10-07', jumlah: 0, metode: 'tunai' },
    });
    assert.equal(tutup.status, 409);
  });

  it('LPJ publik tetap bisa dibuka setelah disetujui (tanpa auth)', async () => {
    const client = await login();
    const { apiUrl } = await alurSiapSetuju(client);
    await client.api.post(`${apiUrl}/setujui`).send({ nama: 'Budi' });

    const res = await client.api.get(apiUrl);
    assert.equal(res.status, 200);
    assert.equal(res.body.kasbon.status, 'disetujui');
  });
});
