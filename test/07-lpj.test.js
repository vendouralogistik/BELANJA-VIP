'use strict';
/**
 * 7. LPJ Excel — cakupan wajib:
 *  - GET /api/kasbon/:id/lpj.xlsx -> 200 + content-type spreadsheet
 *  (+ tanpa token -> 401; isi berupa file xlsx valid / diawali 'PK')
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { freshRequest, login, buatKasbon, buatBelanja, tutupKasbon, foto } = require('./_helper');

async function kasbonLengkap(client) {
  const kasbon = await buatKasbon(client, {
    jumlah: 1000000,
    keperluan: 'Belanja sparepart Exca 17',
    pemberi: 'Bendahara',
    metode: 'transfer',
    bukti_transfer: foto(),
  });
  await buatBelanja(client, kasbon.id);
  await tutupKasbon(client, kasbon.id, {
    tanggal: '2026-10-07',
    jumlah: 830000,
    metode: 'tunai',
  });
  return kasbon;
}

function unduhXlsx(client, kasbonId) {
  return client
    .get(`/api/kasbon/${kasbonId}/lpj.xlsx`)
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
      res.on('error', cb);
    });
}

describe('LPJ Excel', () => {
  it('GET /api/kasbon/:id/lpj.xlsx -> 200 + content-type spreadsheet', async () => {
    const client = await login();
    const kasbon = await kasbonLengkap(client);

    const res = await unduhXlsx(client, kasbon.id);
    assert.equal(res.status, 200, `harus 200: ${JSON.stringify(res.body).slice(0, 200)}`);
    const ct = res.headers['content-type'] || '';
    assert.ok(
      ct.includes('spreadsheetml') || ct.includes('excel'),
      `content-type harus spreadsheet, dapat: ${ct}`
    );
    assert.ok(
      /attachment|filename/i.test(res.headers['content-disposition'] || ''),
      'harus ada header content-disposition attachment'
    );
    const buf = res.body;
    assert.ok(Buffer.isBuffer(buf), 'body harus Buffer biner');
    assert.ok(buf.length > 1000, `file xlsx harus punya isi (dapat ${buf.length} byte)`);
    assert.equal(buf.slice(0, 2).toString('ascii'), 'PK', 'xlsx adalah ZIP -> diawali "PK"');
  });

  it('tanpa token -> 401', async () => {
    const client = await login();
    const kasbon = await kasbonLengkap(client);
    const res = await freshRequest().get(`/api/kasbon/${kasbon.id}/lpj.xlsx`);
    assert.equal(res.status, 401);
  });

  it('kasbon id tidak dikenal -> 404', async () => {
    const client = await login();
    const res = await unduhXlsx(client, 'kasbon-tidak-ada');
    assert.equal(res.status, 404);
  });
});
