'use strict';
/**
 * 2. Kasbon — cakupan wajib:
 *  - buat tunai OK
 *  - buat transfer tanpa bukti -> 400
 *  - buat transfer + bukti OK
 *  - edit saat aktif OK
 *  - hapus kasbon yang sudah ada belanja -> 409
 *  - hapus kasbon kosong -> OK
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { login, buatKasbon, buatBelanja, tutupKasbon, foto, driveUrl } = require('./_helper');

describe('Kasbon', () => {
  it('buat kasbon tunai -> 201, status aktif, rekap nol', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    assert.ok(kasbon.id, 'harus ada id');
    assert.equal(kasbon.status, 'aktif');
    assert.equal(kasbon.metode, 'tunai');
    assert.equal(kasbon.jumlah, 1000000);
    assert.ok(kasbon.rekap, 'respons buat harus memuat rekap');
    assert.equal(kasbon.rekap.diterima, 1000000);
    assert.equal(kasbon.rekap.terpakai, 0);
    assert.equal(kasbon.rekap.sisa, 1000000);
    assert.equal(kasbon.rekap.status, 'AMAN');
  });

  it('kasbon transfer tanpa bukti_transfer -> 400', async () => {
    const client = await login();
    const res = await client.post('/api/kasbon').send({
      tanggal: '2026-10-07',
      jumlah: 500000,
      keperluan: 'Belanja via transfer',
      pemberi: 'Bendahara',
      metode: 'transfer',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('kasbon transfer + bukti_transfer -> 201 + URL bukti benar', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client, {
      jumlah: 500000,
      metode: 'transfer',
      bukti_transfer: foto(),
    });
    assert.equal(kasbon.metode, 'transfer');
    assert.ok(kasbon.bukti_transfer_drive_id, 'harus menyimpan drive file id bukti');
    assert.equal(
      kasbon.bukti_transfer_url,
      driveUrl(kasbon.bukti_transfer_drive_id),
      'bukti_transfer_url harus berbentuk URL Firebase Storage'
    );
  });

  it('validasi: jumlah <= 0 -> 400; metode tak dikenal -> 400', async () => {
    const client = await login();
    for (const jumlah of [0, -100]) {
      const res = await client.post('/api/kasbon').send({
        tanggal: '2026-10-07',
        jumlah,
        keperluan: 'x',
        pemberi: 'Bendahara',
        metode: 'tunai',
      });
      assert.equal(res.status, 400, `jumlah ${jumlah} harus ditolak`);
    }
    const res2 = await client.post('/api/kasbon').send({
      tanggal: '2026-10-07',
      jumlah: 1000,
      keperluan: 'x',
      pemberi: 'Bendahara',
      metode: 'kartu-kredit',
    });
    assert.equal(res2.status, 400, 'metode tak dikenal harus ditolak');
  });

  it('GET /api/kasbon?status=aktif memuat kasbon baru (dengan rekap)', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const res = await client.get('/api/kasbon?status=aktif');
    assert.equal(res.status, 200);
    const ketemu = res.body.kasbon.find((k) => k.id === kasbon.id);
    assert.ok(ketemu, 'kasbon baru harus muncul di daftar aktif');
    assert.ok(ketemu.rekap, 'tiap item daftar harus membawa rekap');
  });

  it('GET /api/kasbon/:id -> { kasbon, belanja, setoran }', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const res = await client.get(`/api/kasbon/${kasbon.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.kasbon.id, kasbon.id);
    assert.ok(Array.isArray(res.body.belanja));
    assert.equal(res.body.setoran, null);
  });

  it('edit kasbon saat aktif -> 200', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const res = await client.put(`/api/kasbon/${kasbon.id}`).send({
      keperluan: 'Belanja sparepart Exca 17 (revisi)',
      jumlah: 1200000,
    });
    assert.equal(res.status, 200);
    const k = res.body.kasbon || res.body;
    assert.equal(k.keperluan, 'Belanja sparepart Exca 17 (revisi)');
    assert.equal(k.jumlah, 1200000);
  });

  it('edit kasbon setelah selesai -> 409', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    await tutupKasbon(client, kasbon.id);
    const res = await client.put(`/api/kasbon/${kasbon.id}`).send({ keperluan: 'ubah' });
    assert.equal(res.status, 409);
  });

  it('hapus kasbon yang SUDAH ada belanja -> 409', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    await buatBelanja(client, kasbon.id);
    const res = await client.delete(`/api/kasbon/${kasbon.id}`);
    assert.equal(res.status, 409);
    assert.ok(res.body.error);
  });

  it('hapus kasbon kosong (tanpa belanja) -> 200 { ok:true }', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const res = await client.delete(`/api/kasbon/${kasbon.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    const cek = await client.get(`/api/kasbon/${kasbon.id}`);
    assert.equal(cek.status, 404);
  });

  it('hapus kasbon yang sudah selesai -> 409', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    await tutupKasbon(client, kasbon.id);
    const res = await client.delete(`/api/kasbon/${kasbon.id}`);
    assert.equal(res.status, 409);
  });
});
