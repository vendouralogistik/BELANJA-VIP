/* public/offline.js — Mode offline Belanja VIP
 *
 * Cara kerja:
 * - Operasi TULIS (POST/PUT/DELETE tertentu) yang gagal karena jaringan
 *   masuk ANTREAN (IndexedDB) dan langsung terlihat di layar (optimistic UI).
 * - Operasi BACA (GET) yang gagal karena jaringan disajikan dari cache
 *   terakhir, digabung dengan isi antrean, dan diberi label "data lama".
 * - Begitu online, antrean dikirim otomatis berurutan (FIFO) ke server.
 * - Server idempoten: ID dibuat di HP (UUID), retry tidak menggandakan data.
 */
(function () {
  'use strict';

  /* ================= IndexedDB ================= */
  const DB = 'bv_offline', VER = 1;
  let dbp = null;
  function buka() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      try {
        const rq = indexedDB.open(DB, VER);
        rq.onupgradeneeded = () => {
          const d = rq.result;
          if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'cid' });
          if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache', { keyPath: 'key' });
        };
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => reject(rq.error);
      } catch (e) { reject(e); }
    });
    return dbp;
  }
  function txDone(t) {
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error || new Error('DB gagal'));
      t.onabort = () => reject(t.error || new Error('DB dibatalkan'));
    });
  }
  async function dbPut(store, val) {
    const db = await buka();
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).put(val);
    await txDone(t);
  }
  async function dbDel(store, key) {
    const db = await buka();
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).delete(key);
    await txDone(t);
  }
  async function dbGet(store, key) {
    const db = await buka();
    const t = db.transaction(store, 'readonly');
    const rq = t.objectStore(store).get(key);
    const hasil = await new Promise((res, rej) => {
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => rej(rq.error);
    });
    await txDone(t).catch(() => {});
    return hasil;
  }
  async function dbAll(store) {
    const db = await buka();
    const t = db.transaction(store, 'readonly');
    const rq = t.objectStore(store).getAll();
    const hasil = await new Promise((res, rej) => {
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror = () => rej(rq.error);
    });
    await txDone(t).catch(() => {});
    return hasil;
  }

  /* ================= Helper angka/teks ================= */
  function rupiah(n) {
    n = Number(n) || 0;
    return 'Rp ' + n.toLocaleString('id-ID');
  }
  function fmtWaktu(ts) {
    try {
      return new Date(ts).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  // Cerminan utils/helpers.js
  function totalBelanja(items, biaya) {
    const ti = (items || []).reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.harga_satuan) || 0), 0);
    const tb = (biaya || []).reduce((a, b) => a + (Number(b.jumlah) || 0), 0);
    return { total_item: ti, total_biaya: tb, total: ti + tb };
  }
  function hitungRekap(diterima, terpakai) {
    diterima = Number(diterima) || 0; terpakai = Number(terpakai) || 0;
    const sisa = diterima - terpakai;
    const persen = diterima > 0 ? Math.round((terpakai / diterima) * 1000) / 10 : 0;
    const status = sisa < 0 ? 'NOMBOK' : (persen >= 90 ? 'HAMPIR HABIS' : 'AMAN');
    return { diterima, terpakai, sisa, persen_terpakai: persen, status };
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  /* ================= Konfigurasi operasi ================= */
  // Operasi tulis yang boleh diantrekan saat offline.
  const POLA_ANTRE = [
    /^POST \/kasbon$/,
    /^PUT \/kasbon\/[^/]+$/,
    /^DELETE \/kasbon\/[^/]+$/,
    /^POST \/belanja$/,
    /^PUT \/belanja\/[^/]+$/,
    /^DELETE \/belanja\/[^/]+$/,
    /^POST \/kasbon\/[^/]+\/tutup$/,
    /^PUT \/setoran\/[^/]+$/,
  ];
  function bisaDiantrekan(method, path) {
    return POLA_ANTRE.some((re) => re.test(method + ' ' + path));
  }

  function buatDeskripsi(method, path, body, info) {
    if (info && info.desc) return info.desc;
    const b = body || {};
    if (method === 'POST' && path === '/kasbon')
      return 'Kasbon baru "' + (b.keperluan || '') + '" ' + rupiah(b.jumlah);
    if (method === 'PUT' && /^\/kasbon\/[^/]+$/.test(path)) return 'Ubah kasbon';
    if (method === 'DELETE' && /^\/kasbon\/[^/]+$/.test(path)) return 'Hapus kasbon';
    if (method === 'POST' && path === '/belanja')
      return 'Belanja di ' + (b.toko || 'toko') + ' ' + rupiah(totalBelanja(b.items, b.biaya_lain).total);
    if (method === 'PUT' && /^\/belanja\/[^/]+$/.test(path)) return 'Ubah belanja';
    if (method === 'DELETE' && /^\/belanja\/[^/]+$/.test(path)) return 'Hapus belanja';
    if (/\/tutup$/.test(path)) return 'Tutup kasbon + setoran ' + rupiah((b.setoran || {}).jumlah);
    if (method === 'PUT' && /^\/setoran\/[^/]+$/.test(path)) return 'Ubah setoran';
    return method + ' ' + path;
  }

  /* ================= Outbox ================= */
  async function opsSemua() {
    try {
      const semua = await dbAll('outbox');
      return semua.sort((a, b) => a.ts - b.ts);
    } catch (e) { return []; }
  }
  async function opsAktif() {
    return (await opsSemua()).filter((o) => o.status === 'pending');
  }

  // Bentuk hasil optimis agar UI tetap jalan seperti saat online.
  function kasbonOptimis(b) {
    return Object.assign({}, b, {
      status: 'aktif', disetujui_oleh: null, disetujui_at: null, closed_at: null,
      created_at: new Date().toISOString(),
      bukti_transfer_url: null,
      rekap: hitungRekap(b.jumlah, 0),
      _offline: true,
    });
  }
  function belanjaOptimis(b) {
    const t = totalBelanja(b.items, b.biaya_lain);
    return Object.assign({}, b, {
      created_at: new Date().toISOString(),
      items: (b.items || []).map((it, i) => Object.assign({}, it, {
        id: 'it-' + i, subtotal: (Number(it.qty) || 0) * (Number(it.harga_satuan) || 0),
      })),
      biaya_lain: (b.biaya_lain || []).map((x, i) => Object.assign({}, x, { id: 'by-' + i })),
      fotos: (b.fotos || []).map((f, i) => ({
        id: 'ft-' + i,
        url: f && f.data ? 'data:' + (f.mime || 'image/jpeg') + ';base64,' + f.data : null,
      })),
      total_item: t.total_item, total_biaya: t.total_biaya, total: t.total,
      _offline: true,
    });
  }
  function hasilOptimis(op) {
    const { method, path, body } = op;
    if (method === 'POST' && path === '/kasbon') return { kasbon: kasbonOptimis(body), _offline: true };
    if (method === 'PUT' && /^\/kasbon\/[^/]+$/.test(path))
      return { kasbon: Object.assign({ id: path.split('/')[2] }, body, { _offline: true }) };
    if (method === 'DELETE') return { ok: true, _offline: true };
    if (method === 'POST' && path === '/belanja') return Object.assign(belanjaOptimis(body), { _offline: true });
    if (method === 'PUT' && /^\/belanja\/[^/]+$/.test(path))
      return Object.assign(belanjaOptimis(Object.assign({ id: path.split('/')[2] }, body)), { _offline: true });
    if (/\/tutup$/.test(path)) {
      const s = body.setoran || {};
      return {
        kasbon: { id: path.split('/')[2], status: 'selesai', _offline: true },
        setoran: Object.assign({}, s, { _offline: true }),
        _offline: true,
      };
    }
    if (method === 'PUT' && /^\/setoran\/[^/]+$/.test(path))
      return { setoran: Object.assign({ id: path.split('/')[2] }, body, { _offline: true }) };
    return { ok: true, _offline: true };
  }

  async function antre(method, path, body, info) {
    info = info || {};
    // Hapus entitas yang masih antre dibuat → batalkan pembuatannya, tak perlu ke server.
    if (method === 'DELETE') {
      const idTarget = decodeURIComponent(path.split('/').pop());
      const semua = await opsSemua();
      const buat = semua.find((o) => o.method === 'POST' && o.body && o.body.id === idTarget && o.status === 'pending');
      if (buat) {
        await dbDel('outbox', buat.cid);
        perbaruiBadge();
        if (window.toast) toast('Dibatalkan (belum sempat terkirim).', 'sukses');
        return { ok: true, _offline: true, _dibatalkan: true };
      }
    }
    const op = {
      cid: 'op-' + uuid(),
      ts: Date.now(),
      method, path, body: body || {},
      info: {
        desc: buatDeskripsi(method, path, body, info),
        kasbon_id: info.kasbon_id || body.kasbon_id || null,
        totalLama: info.totalLama || 0,
      },
      status: 'pending',
      error: null,
    };
    await dbPut('outbox', op);
    perbaruiBadge();
    if (window.toast) toast('📴 Offline — tersimpan di HP, otomatis terkirim saat ada internet.', 'sukses');
    return hasilOptimis(op);
  }

  /* ================= Gabung cache + antrean (optimistic read) ================= */
  function totalDariBelanja(b) {
    if (typeof b.total === 'number') return b.total;
    return totalBelanja(b.items, b.biaya_lain).total;
  }

  // Selisih terpakai akibat operasi pending untuk satu kasbon.
  function deltaTerpakai(kasbonId, ops) {
    let d = 0;
    for (const op of ops) {
      if (op.method === 'POST' && op.path === '/belanja' && op.body.kasbon_id === kasbonId) {
        d += totalBelanja(op.body.items, op.body.biaya_lain).total;
      } else if ((op.method === 'PUT' || op.method === 'DELETE') && /^\/belanja\/[^/]+$/.test(op.path)) {
        if (op.info && op.info.kasbon_id === kasbonId) {
          const baru = op.method === 'PUT' ? totalBelanja(op.body.items, op.body.biaya_lain).total : 0;
          d += baru - (op.info.totalLama || 0);
        }
      }
    }
    return d;
  }

  function gabungDaftarKasbon(list, ops) {
    list = list.slice();
    for (const op of ops) {
      const m = op.path.match(/^\/(kasbon|belanja|setoran)(?:\/([^/]+))?(\/tutup)?$/);
      if (op.method === 'POST' && op.path === '/kasbon') {
        if (!list.some((k) => k.id === op.body.id)) list.unshift(kasbonOptimis(op.body));
      } else if ((op.method === 'PUT' || op.method === 'DELETE') && m && m[1] === 'kasbon' && m[2] && !m[3]) {
        const id = decodeURIComponent(m[2]);
        if (op.method === 'DELETE') list = list.filter((k) => k.id !== id);
        else list = list.map((k) => (k.id === id ? Object.assign({}, k, op.body) : k));
      } else if (op.method === 'POST' && m && m[1] === 'kasbon' && m[3]) {
        const id = decodeURIComponent(m[2]);
        list = list.map((k) => (k.id === id ? Object.assign({}, k, { status: 'selesai' }) : k));
      }
    }
    return list;
  }

  function gabungDetailKasbon(data, id, ops) {
    const d = clone(data);
    d.belanja = d.belanja || [];
    for (const op of ops) {
      if (op.method === 'POST' && op.path === '/belanja' && op.body.kasbon_id === id) {
        if (!d.belanja.some((b) => b.id === op.body.id)) d.belanja.unshift(belanjaOptimis(op.body));
      } else if ((op.method === 'PUT' || op.method === 'DELETE') && /^\/belanja\/[^/]+$/.test(op.path)) {
        const bid = decodeURIComponent(op.path.split('/')[2]);
        if (op.method === 'DELETE') d.belanja = d.belanja.filter((b) => b.id !== bid);
        else {
          const nb = belanjaOptimis(Object.assign({ id: bid }, op.body));
          // pertahankan kasbon_id & foto lama bila body tak menyebutkannya
          const lama = d.belanja.find((b) => b.id === bid) || {};
          if (!nb.kasbon_id) nb.kasbon_id = lama.kasbon_id;
          d.belanja = d.belanja.map((b) => (b.id === bid ? nb : b));
        }
      } else if (op.method === 'PUT' && op.path === '/kasbon/' + id) {
        d.kasbon = Object.assign({}, d.kasbon, op.body);
      } else if (op.method === 'POST' && op.path === '/kasbon/' + id + '/tutup') {
        d.kasbon = Object.assign({}, d.kasbon, { status: 'selesai' });
        d.setoran = Object.assign({}, op.body.setoran, { _offline: true });
      } else if (op.method === 'PUT' && /^\/setoran\/[^/]+$/.test(op.path) && d.setoran) {
        d.setoran = Object.assign({}, d.setoran, op.body);
      }
    }
    return d;
  }

  function gabungDaftarBelanja(list, ops, filter) {
    list = list.slice();
    for (const op of ops) {
      if (op.method === 'POST' && op.path === '/belanja') {
        if (!list.some((b) => b.id === op.body.id)) list.unshift(belanjaOptimis(op.body));
      } else if ((op.method === 'PUT' || op.method === 'DELETE') && /^\/belanja\/[^/]+$/.test(op.path)) {
        const bid = decodeURIComponent(op.path.split('/')[2]);
        if (op.method === 'DELETE') list = list.filter((b) => b.id !== bid);
        else {
          const lama = list.find((b) => b.id === bid) || {};
          const nb = belanjaOptimis(Object.assign({ id: bid }, op.body));
          if (!nb.kasbon_id) nb.kasbon_id = lama.kasbon_id;
          list = list.map((b) => (b.id === bid ? nb : b));
        }
      }
    }
    // Terapkan filter pencarian offline sebisanya.
    if (filter) {
      if (filter.kasbon_id) list = list.filter((b) => b.kasbon_id === filter.kasbon_id);
      if (filter.from) list = list.filter((b) => (b.tanggal || '') >= filter.from);
      if (filter.to) list = list.filter((b) => (b.tanggal || '') <= filter.to);
      if (filter.q) {
        const q = filter.q.toLowerCase();
        list = list.filter((b) =>
          (b.toko || '').toLowerCase().includes(q) ||
          (b.items || []).some((i) => (i.nama_barang || '').toLowerCase().includes(q)));
      }
    }
    return list;
  }

  async function dataGabungan(kunci) {
    const c = await dbGet('cache', kunci).catch(() => null);
    const ops = await opsAktif();
    let data = c ? clone(c.data) : null;
    const ts = c ? c.ts : Date.now();

    let m = kunci.match(/^GET \/kasbon\/([^/?]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (!data) {
        const op = ops.find((o) => o.method === 'POST' && o.path === '/kasbon' && o.body.id === id);
        if (op) data = { kasbon: kasbonOptimis(op.body), belanja: [], setoran: null };
      }
      if (data) data = gabungDetailKasbon(data, id, ops);
    } else if ((m = kunci.match(/^GET \/kasbon\/([^/]+)\/rekap$/))) {
      const id = decodeURIComponent(m[1]);
      const detail = await dataGabungan('GET /kasbon/' + id);
      if (detail && detail.kasbon) {
        const terpakai = (detail.belanja || []).reduce((a, b) => a + totalDariBelanja(b), 0);
        data = hitungRekap(detail.kasbon.jumlah, terpakai);
      }
    } else if (kunci.startsWith('GET /kasbon?')) {
      if (!data) data = { kasbon: [] };
      data.kasbon = gabungDaftarKasbon(data.kasbon || [], ops);
      for (const k of data.kasbon) {
        const d = deltaTerpakai(k.id, ops);
        const base = (k.rekap && k.rekap.terpakai) || 0;
        k.rekap = hitungRekap((k.rekap && k.rekap.diterima) || k.jumlah, base + d);
      }
    } else if (kunci.startsWith('GET /belanja?') || kunci === 'GET /belanja') {
      if (!data) data = { belanja: [] };
      const qp = {};
      const qi = kunci.indexOf('?');
      if (qi > 0) kunci.slice(qi + 1).split('&').forEach((p) => {
        const kv = p.split('=');
        qp[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
      });
      data.belanja = gabungDaftarBelanja(data.belanja || [], ops, qp);
    }
    // Kunci lain (rekap-bulanan, /me, dsb): tampilkan cache apa adanya.

    if (!data) return null;
    data._offline = true;
    data._cacheWaktu = ts;
    return data;
  }

  /* ================= Sinkronisasi ================= */
  let sedang = false;
  async function fetchLangsung(op) {
    if (typeof window.apiMentah !== 'function') throw new Error('apiMentah belum siap.');
    return window.apiMentah(op.path, { method: op.method, body: JSON.stringify(op.body) });
  }
  async function invalidasiCache() {
    // Setelah sinkron, biarkan cache dibangun ulang dari server.
    const semua = await dbAll('cache').catch(() => []);
    for (const c of semua) {
      if (/^GET \/(kasbon|belanja|rekap)/.test(c.key)) await dbDel('cache', c.key).catch(() => {});
    }
  }
  async function sinkronkan(manual) {
    if (sedang) return { ok: false, alasan: 'sibuk' };
    if (!navigator.onLine) { perbaruiBadge(); return { ok: false, alasan: 'offline' }; }
    const ops = await opsSemua();
    const antre = ops.filter((o) => o.status === 'pending' || (manual && o.status === 'gagal'));
    if (!antre.length) { perbaruiBadge(); return { ok: true, kosong: true }; }
    sedang = true;
    perbaruiBadge();
    let terkirim = 0, gagal = 0;
    for (const op of antre) {
      try {
        await fetchLangsung(op);
        await dbDel('outbox', op.cid);
        terkirim++;
      } catch (e) {
        if (e && e.kodeOffline) break; // jaringan putus lagi — sisanya tetap antre
        op.status = 'gagal';
        op.error = (e && e.message) || 'Gagal terkirim';
        await dbPut('outbox', op).catch(() => {});
        gagal++;
      }
      perbaruiBadge();
    }
    sedang = false;
    if (terkirim) await invalidasiCache();
    perbaruiBadge();
    if (terkirim && window.toast) toast('✅ ' + terkirim + ' data offline terkirim ke server.', 'sukses');
    if (gagal && window.toast) toast('⚠️ ' + gagal + ' data gagal terkirim — lihat di Antrean.', 'gagal');
    if (terkirim && typeof window.render === 'function') {
      try { window.render(); } catch (e) { /* abaikan */ }
    }
    return { ok: true, terkirim, gagal };
  }

  /* ================= UI: badge & banner ================= */
  async function jumlahAntre() {
    const ops = await opsSemua();
    return {
      pending: ops.filter((o) => o.status === 'pending').length,
      gagal: ops.filter((o) => o.status === 'gagal').length,
    };
  }
  async function perbaruiBadge() {
    const el = document.getElementById('badgeAntrean');
    if (!el) return;
    const j = await jumlahAntre();
    const total = j.pending + j.gagal;
    if (total > 0) {
      el.style.display = '';
      el.innerHTML = '⏳ ' + total + ' antre';
      el.classList.toggle('badge-gagal', j.gagal > 0);
    } else {
      el.style.display = 'none';
    }
    perbaruiBanner();
  }
  function perbaruiBanner() {
    const el = document.getElementById('bannerOffline');
    if (!el) return;
    if (!navigator.onLine) {
      el.style.display = '';
      el.innerHTML = '📴 <strong>Mode offline</strong> — perubahan disimpan di HP dan terkirim otomatis saat ada internet.';
    } else {
      el.style.display = 'none';
    }
  }
  function labelOfflineHTML(data) {
    if (!data || !data._offline) return '';
    return '<div class="label-offline">📴 Data terakhir ' + fmtWaktu(data._cacheWaktu) +
      ' — akan diperbarui saat online.</div>';
  }

  /* ================= API publik ================= */
  window.Offline = {
    bisaDiantrekan,
    antre,
    dataGabungan,
    sinkronkan,
    sedangSinkron: () => sedang,
    cacheSimpan: (key, data) => dbPut('cache', { key, data: clone(data), ts: Date.now() }).catch(() => {}),
    daftar: opsSemua,
    hapus: async (cid) => { await dbDel('outbox', cid); perbaruiBadge(); },
    hapusGagal: async () => {
      const ops = await opsSemua();
      for (const o of ops) if (o.status === 'gagal') await dbDel('outbox', o.cid);
      perbaruiBadge();
    },
    jumlahAntre,
    perbaruiBadge,
    perbaruiBanner,
    labelOfflineHTML,
    fmtWaktu,
    online: () => navigator.onLine,
  };

  // Picu sinkronisasi saat kembali online + berkala.
  window.addEventListener('online', () => { perbaruiBanner(); perbaruiBadge(); sinkronkan(); });
  window.addEventListener('offline', () => { perbaruiBanner(); perbaruiBadge(); });
  setInterval(() => {
    jumlahAntre().then((j) => {
      if ((j.pending + j.gagal) > 0 && navigator.onLine && !sedang) sinkronkan();
    }).catch(() => {});
  }, 30000);
})();
