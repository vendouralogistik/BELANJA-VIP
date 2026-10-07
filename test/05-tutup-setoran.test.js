'use strict';
/**
 * 5. Tutup kasbon + setoran — cakupan wajib:
 *  - tutup tanpa setoran -> 400
 *  - tutup + setoran 0 OK -> status selesai
 *  - edit setoran saat selesai OK
 *  (+ setoran transfer wajib bukti; edit setoran setelah disetujui -> 409)
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { login, buatKasbon, buatBelanja, tutupKasbon, foto, driveUrl } = require('./_helper');

describe('Tutup kasbon & setoran', () => {
  it('tutup TANPA data setoran -> 400', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const res = await client.post(`/api/kasbon/${kasbon.id}/tutup`).send({});
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('tutup + setoran 0 -> 200, status selesai, closed_at terisi', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const { kasbon: k, setoran } = await tutupKasbon(client, kasbon.id, {
      tanggal: '2026-10-07',
      jumlah: 0,
      metode: 'tunai',
      catatan: 'tidak ada sisa',
    });
    assert.equal(k.status, 'selesai');
    assert.ok(k.closed_at, 'closed_at harus terisi');
    assert.ok(setoran, 'setoran harus tercatat');
    assert.equal(setoran.jumlah, 0);
    assert.equal(setoran.metode, 'tunai');
  });

  it('tutup kasbon ber-belanja dengan setoran sisa yang benar', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client, { jumlah: 1000000 });
    await buatBelanja(client, kasbon.id); // total 170000
    const { kasbon: k, setoran } = await tutupKasbon(client, kasbon.id, {
      tanggal: '2026-10-07',
      jumlah: 830000, // 1.000.000 - 170.000
      metode: 'tunai',
    });
    assert.equal(k.status, 'selesai');
    assert.equal(setoran.jumlah, 830000);
    // Rekonsiliasi akhir ideal: diterima - terpakai - disetor = 0
    assert.equal(k.rekap.diterima - k.rekap.terpakai - setoran.jumlah, 0);
  });

  it('setoran transfer tanpa bukti_transfer -> 400', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const res = await client.post(`/api/kasbon/${kasbon.id}/tutup`).send({
      setoran: { tanggal: '2026-10-07', jumlah: 100000, metode: 'transfer' },
    });
    assert.equal(res.status, 400);
  });

  it('setoran transfer + bukti -> OK, URL bukti benar', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const { setoran } = await tutupKasbon(client, kasbon.id, {
      tanggal: '2026-10-07',
      jumlah: 100000,
      metode: 'transfer',
      bukti_transfer: foto(),
    });
    assert.equal(setoran.metode, 'transfer');
    assert.ok(setoran.bukti_transfer_drive_id);
    assert.equal(
      setoran.bukti_transfer_url,
      driveUrl(setoran.bukti_transfer_drive_id)
    );
  });

  it('setoran jumlah negatif -> 400', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const res = await client.post(`/api/kasbon/${kasbon.id}/tutup`).send({
      setoran: { tanggal: '2026-10-07', jumlah: -5000, metode: 'tunai' },
    });
    assert.equal(res.status, 400);
  });

  it('tutup kasbon yang sudah selesai -> 409', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    await tutupKasbon(client, kasbon.id);
    const res = await client.post(`/api/kasbon/${kasbon.id}/tutup`).send({
      setoran: { tanggal: '2026-10-07', jumlah: 0, metode: 'tunai' },
    });
    assert.equal(res.status, 409);
  });

  it('edit setoran saat kasbon selesai -> 200 OK', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const { setoran } = await tutupKasbon(client, kasbon.id, {
      tanggal: '2026-10-07',
      jumlah: 500000,
      metode: 'tunai',
    });
    const res = await client.put(`/api/setoran/${setoran.id}`).send({ jumlah: 450000 });
    assert.equal(res.status, 200, `harus 200: ${JSON.stringify(res.body)}`);
    const s = res.body.setoran || res.body;
    assert.equal(s.jumlah, 450000);
  });

  it('edit setoran setelah kasbon disetujui bendahara -> 409', async () => {
    const client = await login();
    const kasbon = await buatKasbon(client);
    const { setoran } = await tutupKasbon(client, kasbon.id);
    const share = await client.post(`/api/kasbon/${kasbon.id}/share`);
    const setuju = await client.api
      .post( `/api${share.body.url}/setujui`)
      .send({ nama: 'Bendahara' });
    assert.equal(setuju.status, 200);

    const res = await client.put(`/api/setoran/${setoran.id}`).send({ jumlah: 1 });
    assert.equal(res.status, 409, 'setoran terkunci permanen setelah disetujui');
  });
});
