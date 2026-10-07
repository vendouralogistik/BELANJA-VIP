/* ============================================================
   Belanja VIP — frontend SPA (tanpa framework, tanpa build step)
   Semua teks Bahasa Indonesia. Kontrak API: app/CONTRACT.md
   ============================================================ */
'use strict';

/* ---------------- util dasar ---------------- */
const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
const viewEl = () => document.getElementById('view');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const fmtRp = new Intl.NumberFormat('id-ID');
function rupiah(n) { return 'Rp ' + fmtRp.format(Math.round(Number(n) || 0)); }

const NAMA_BULAN = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
function fmtTgl(iso) {
  if (!iso) return '-';
  const p = String(iso).slice(0, 10).split('-');
  if (p.length !== 3) return esc(iso);
  return parseInt(p[2], 10) + ' ' + NAMA_BULAN[parseInt(p[1], 10) - 1] + ' ' + p[0];
}
function fmtTglWaktu(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return esc(iso);
  return d.getDate() + ' ' + NAMA_BULAN[d.getMonth()] + ' ' + d.getFullYear() +
    ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function bulanIni() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/* ---------------- token & API ---------------- */
const TOKEN_KEY = 'bv_token';
const getToken = () => localStorage.getItem(TOKEN_KEY);
const setToken = (t) => { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); };

async function api(path, opts) {
  opts = opts || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  const t = getToken();
  if (t) headers['Authorization'] = 'Bearer ' + t;
  let res;
  try {
    res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body
    });
  } catch (e) {
    throw new Error('Tidak bisa terhubung ke server. Periksa koneksi internet lalu coba lagi.');
  }
  if (res.status === 401) {
    if (getToken()) {
      setToken(null);
      if (!location.hash.startsWith('#/s/') && location.hash !== '#/login') location.hash = '#/login';
      throw new Error('Sesi login berakhir, silakan login kembali.');
    }
    let d = null;
    try { d = await res.json(); } catch (e) { /* abaikan */ }
    throw new Error((d && d.error) || 'Username atau password salah.');
  }
  const ct = res.headers.get('content-type') || '';
  let data = null;
  if (ct.indexOf('application/json') >= 0) {
    try { data = await res.json(); } catch (e) { data = null; }
  }
  if (!res.ok) {
    const msg = (data && data.error) || ('Terjadi kesalahan (kode ' + res.status + '). Coba lagi.');
    throw new Error(msg);
  }
  return data;
}

/* ---------------- toast & loading ---------------- */
let toastTimer = null;
function toast(msg, tipe) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'tampil' + (tipe ? ' ' + tipe : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3500);
}
function layarLoading(teks) {
  viewEl().innerHTML = '<div class="loading"><div class="spinner"></div><div>' + esc(teks || 'Memuat...') + '</div></div>';
}

/* ---------------- badge status ---------------- */
function badgeRekap(status) {
  const cls = status === 'NOMBOK' ? 'b-merah' : (status === 'HAMPIR HABIS' ? 'b-kuning' : 'b-hijau');
  return '<span class="badge ' + cls + '">' + esc(status) + '</span>';
}
function badgeKasbon(status) {
  const cls = status === 'aktif' ? 'b-biru' : (status === 'selesai' ? 'b-kuning' : 'b-hijau');
  const label = status === 'aktif' ? 'Aktif' : (status === 'selesai' ? 'Selesai' : 'Disetujui');
  return '<span class="badge ' + cls + '">' + label + '</span>';
}

/* ---------------- kompres foto (canvas) ---------------- */
function kompresFoto(file) {
  return new Promise((resolve, reject) => {
    if (!file || file.type.indexOf('image/') !== 0) {
      reject(new Error('File "' + (file && file.name) + '" bukan gambar.'));
      return;
    }
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      const MAKS = 800;
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      const skala = Math.min(1, MAKS / Math.max(w, h));
      w = Math.max(1, Math.round(w * skala));
      h = Math.max(1, Math.round(h * skala));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      const base64 = dataUrl.split(',')[1] || '';
      if (!base64) { reject(new Error('Gagal mengompres foto.')); return; }
      resolve({ data: base64, mime: 'image/jpeg' });
    };
    img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('Gagal membaca foto.')); };
    img.src = objUrl;
  });
}

async function fileListKeFoto(fileList) {
  const hasil = [];
  for (let i = 0; i < fileList.length; i++) {
    hasil.push(await kompresFoto(fileList[i]));
  }
  return hasil;
}

/* ---------------- auth ---------------- */
async function logout() {
  try { await api('/logout', { method: 'POST' }); } catch (e) { /* token dibuang walau gagal */ }
  setToken(null);
  location.hash = '#/login';
  toast('Berhasil keluar.');
}

/* ---------------- router ---------------- */
function parseHash() {
  let h = location.hash || '#/';
  if (h.charAt(0) === '#') h = h.slice(1);
  const qi = h.indexOf('?');
  let path = qi >= 0 ? h.slice(0, qi) : h;
  const query = {};
  if (qi >= 0) {
    h.slice(qi + 1).split('&').forEach((p) => {
      const kv = p.split('=');
      if (kv[0]) query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
  }
  return { path: path || '/', query: query };
}

const RUTE = [
  { re: /^\/login$/, fn: layarLogin, publik: true },
  { re: /^\/$/, fn: layarDashboard, nav: 'beranda' },
  { re: /^\/kasbon$/, fn: layarKasbonDaftar, nav: 'kasbon' },
  { re: /^\/kasbon\/baru$/, fn: layarKasbonForm, nav: 'kasbon' },
  { re: /^\/kasbon\/([^/]+)\/edit$/, fn: layarKasbonEdit, nav: 'kasbon' },
  { re: /^\/kasbon\/([^/]+)\/tutup$/, fn: layarTutupKasbon, nav: 'kasbon' },
  { re: /^\/kasbon\/([^/]+)$/, fn: layarKasbonDetail, nav: 'kasbon' },
  { re: /^\/belanja$/, fn: layarBelanjaCari, nav: 'belanja' },
  { re: /^\/belanja\/baru$/, fn: layarBelanjaForm, nav: 'belanja' },
  { re: /^\/belanja\/([^/]+)\/edit$/, fn: layarBelanjaEdit, nav: 'belanja' },
  { re: /^\/belanja\/([^/]+)$/, fn: layarBelanjaDetail, nav: 'belanja' },
  { re: /^\/lpj\/([^/]+)$/, fn: layarLPJ, nav: 'kasbon' },
  { re: /^\/rekap$/, fn: layarRekap, nav: 'rekap' },
  { re: /^\/riwayat$/, fn: layarRiwayat, nav: 'lainnya' },
  { re: /^\/pengaturan$/, fn: layarPengaturan, nav: 'lainnya' },
  { re: /^\/lainnya$/, fn: layarLainnya, nav: 'lainnya' },
  { re: /^\/s\/([^/]+)$/, fn: layarSharePublik, publik: true }
];

async function render() {
  const { path, query } = parseHash();
  const rute = RUTE.find((r) => r.re.test(path));
  const tanpaNav = !rute || rute.publik;
  document.body.classList.toggle('tanpa-nav', tanpaNav);
  if (!rute) {
    location.hash = getToken() ? '#/' : '#/login';
    return;
  }
  if (!rute.publik && !getToken()) {
    location.hash = '#/login';
    return;
  }
  $$('#bottomnav a').forEach((a) => {
    a.classList.toggle('aktif', rute.nav && a.dataset.nav === rute.nav);
  });
  const m = path.match(rute.re);
  try {
    await rute.fn(m ? m.slice(1) : [], query);
  } catch (e) {
    viewEl().innerHTML = '<div class="kosong"><span class="emoji">&#9888;&#65039;</span>' +
      '<p>' + esc(e.message) + '</p>' +
      '<button class="btn btn-sekunder btn-kecil" onclick="history.back()">Kembali</button></div>';
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);

/* Ganti hash TANPA menambah entri riwayat browser — dipakai untuk filter/pencarian
   di dalam satu layar (chip status kasbon, pilih bulan rekap). Tanpa ini, tiap ganti
   filter menumpuk riwayat dan tombol back HP hanya memuat ulang layar yang sama. */
function gantiHash(hash) {
  if (location.hash === hash) { render(); return; }
  history.replaceState(null, '', hash);
  render();
}

/* ================= 1. LOGIN ================= */
async function layarLogin() {
  if (getToken()) { location.hash = '#/'; return; }
  viewEl().innerHTML =
    '<div class="tengah mb" style="margin-top:24px">' +
      '<div style="font-size:56px">&#128176;</div>' +
      '<h1 class="judul-halaman">Belanja VIP</h1>' +
      '<p class="subjudul">Catatan kasbon &amp; LPJ belanja sparepart</p>' +
    '</div>' +
    '<div class="card">' +
      '<form id="formLogin">' +
        '<div class="field"><label for="li-user">Username</label>' +
          '<input type="text" id="li-user" autocomplete="username" required></div>' +
        '<div class="field"><label for="li-pass">Password</label>' +
          '<input type="password" id="li-pass" autocomplete="current-password" required></div>' +
        '<button class="btn btn-primer" type="submit">Masuk</button>' +
      '</form>' +
    '</div>';
  $('#formLogin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#formLogin button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Masuk...';
    try {
      const data = await api('/login', {
        method: 'POST',
        body: JSON.stringify({ username: $('#li-user').value.trim(), password: $('#li-pass').value })
      });
      setToken(data.token);
      toast('Selamat datang, ' + (data.user && data.user.nama ? data.user.nama : '') + '!', 'sukses');
      location.hash = '#/';
    } catch (err) {
      toast(err.message, 'gagal');
      btn.disabled = false; btn.textContent = 'Masuk';
    }
  });
}

/* ================= 2. DASHBOARD ================= */
async function layarDashboard() {
  layarLoading('Memuat dashboard...');
  const [res, me] = await Promise.all([
    api('/kasbon?status=aktif'),
    api('/me').catch(() => null)
  ]);
  const daftar = res.kasbon || [];
  if (me) $('#topbarUser').textContent = me.nama || me.username;

  let tDiterima = 0, tTerpakai = 0;
  daftar.forEach((k) => {
    const r = k.rekap || {};
    tDiterima += Number(r.diterima) || 0;
    tTerpakai += Number(r.terpakai) || 0;
  });
  const tSisa = tDiterima - tTerpakai;
  const persen = tDiterima > 0 ? (tTerpakai / tDiterima) * 100 : 0;
  const statusG = tSisa < 0 ? 'NOMBOK' : (persen >= 90 ? 'HAMPIR HABIS' : 'AMAN');

  let kartu = daftar.map((k) => {
    const r = k.rekap || {};
    return '<div class="card klik" onclick="location.hash=\'#/kasbon/' + esc(k.id) + '\'">' +
      '<div class="row"><strong>' + esc(k.keperluan) + '</strong>' + badgeRekap(r.status || 'AMAN') + '</div>' +
      '<div class="row"><span class="label">' + fmtTgl(k.tanggal) + ' &middot; ' + esc(k.pemberi || '') + '</span></div>' +
      '<div class="ringkasan">' +
        '<div class="kotak"><div class="l">Diterima</div><div class="v">' + rupiah(r.diterima) + '</div></div>' +
        '<div class="kotak"><div class="l">Terpakai</div><div class="v">' + rupiah(r.terpakai) + '</div></div>' +
        '<div class="kotak"><div class="l">Sisa</div><div class="v ' + ((r.sisa || 0) < 0 ? 'v-merah' : 'v-hijau') + '">' + rupiah(r.sisa) + '</div></div>' +
      '</div></div>';
  }).join('');

  if (!daftar.length) {
    kartu = '<div class="kosong"><span class="emoji">&#128188;</span><p>Belum ada kasbon aktif.<br>Buat kasbon baru untuk mulai mencatat belanja.</p></div>';
  }

  viewEl().innerHTML =
    '<h1 class="judul-halaman">Dashboard</h1>' +
    '<p class="subjudul">Ringkasan kasbon yang sedang berjalan</p>' +
    '<div class="card">' +
      '<div class="row"><h3>Ringkasan Kasbon Aktif</h3>' + badgeRekap(statusG) + '</div>' +
      '<div class="ringkasan">' +
        '<div class="kotak"><div class="l">Diterima</div><div class="v">' + rupiah(tDiterima) + '</div></div>' +
        '<div class="kotak"><div class="l">Terpakai</div><div class="v">' + rupiah(tTerpakai) + '</div></div>' +
        '<div class="kotak"><div class="l">Sisa</div><div class="v ' + (tSisa < 0 ? 'v-merah' : 'v-hijau') + '">' + rupiah(tSisa) + '</div></div>' +
      '</div>' +
      '<div class="label tengah">' + daftar.length + ' kasbon aktif</div>' +
    '</div>' +
    '<div class="row mb"><h3 style="margin:0">Kasbon Aktif</h3>' +
      '<a class="btn btn-primer btn-kecil" href="#/kasbon/baru">+ Kasbon Baru</a></div>' +
    kartu;
}

/* ================= 3. KASBON ================= */
async function layarKasbonDaftar(params, query) {
  const status = query.status || 'aktif';
  layarLoading('Memuat kasbon...');
  const res = await api('/kasbon?status=' + encodeURIComponent(status));
  const daftar = res.kasbon || [];

  const chip = (s, label) =>
    '<button class="chip-filter' + (status === s ? ' aktif' : '') + '" data-status="' + s + '">' + label + '</button>';

  let isi = daftar.map((k) => {
    const r = k.rekap || {};
    return '<div class="card klik" onclick="location.hash=\'#/kasbon/' + esc(k.id) + '\'">' +
      '<div class="row"><strong>' + esc(k.keperluan) + '</strong>' + badgeKasbon(k.status) + '</div>' +
      '<div class="row"><span class="label">' + fmtTgl(k.tanggal) + ' &middot; ' + esc(k.pemberi || '') +
        ' &middot; ' + (k.metode === 'transfer' ? 'Transfer' : 'Tunai') + '</span>' + badgeRekap(r.status || 'AMAN') + '</div>' +
      '<div class="row mt"><span class="label">Diterima</span><span class="nilai">' + rupiah(k.jumlah) + '</span></div>' +
      '<div class="row"><span class="label">Terpakai</span><span class="nilai">' + rupiah(r.terpakai) + '</span></div>' +
      '<div class="row"><span class="label">Sisa</span><span class="nilai ' + ((r.sisa || 0) < 0 ? 'v-merah' : 'v-hijau') + '">' + rupiah(r.sisa) + '</span></div>' +
    '</div>';
  }).join('');
  if (!daftar.length) isi = '<div class="kosong"><span class="emoji">&#128188;</span><p>Tidak ada kasbon berstatus ini.</p></div>';

  viewEl().innerHTML =
    '<h1 class="judul-halaman">Kasbon</h1>' +
    '<p class="subjudul">Uang masuk dari bendahara</p>' +
    '<div class="mb">' + chip('aktif', 'Aktif') + chip('selesai', 'Selesai') + chip('disetujui', 'Disetujui') + '</div>' +
    isi +
    '<a class="btn btn-primer no-print" href="#/kasbon/baru">+ Buat Kasbon Baru</a>';

  $$('.chip-filter').forEach((c) => c.addEventListener('click', () => {
    gantiHash('#/kasbon?status=' + c.dataset.status);
  }));
}

function formKasbonHTML(k) {
  k = k || {};
  const metode = k.metode || 'tunai';
  return '<div class="field"><label for="k-tanggal">Tanggal terima</label>' +
      '<input type="date" id="k-tanggal" value="' + esc(k.tanggal || todayISO()) + '" required></div>' +
    '<div class="field"><label for="k-jumlah">Jumlah (Rp)</label>' +
      '<input type="number" id="k-jumlah" min="1" step="1" inputmode="numeric" value="' + esc(k.jumlah || '') + '" placeholder="cth: 1000000" required></div>' +
    '<div class="field"><label for="k-keperluan">Keperluan</label>' +
      '<input type="text" id="k-keperluan" value="' + esc(k.keperluan || '') + '" placeholder="cth: Belanja sparepart Exca 17" required></div>' +
    '<div class="field"><label for="k-pemberi">Nama pemberi / bendahara</label>' +
      '<input type="text" id="k-pemberi" value="' + esc(k.pemberi || '') + '" required></div>' +
    '<div class="field"><label>Metode terima</label><div class="radio-row">' +
      '<label class="radio-pil"><input type="radio" name="k-metode" value="tunai"' + (metode === 'tunai' ? ' checked' : '') + '><span>&#128181; Tunai</span></label>' +
      '<label class="radio-pil"><input type="radio" name="k-metode" value="transfer"' + (metode === 'transfer' ? ' checked' : '') + '><span>&#128179; Transfer</span></label>' +
    '</div></div>' +
    '<div class="field" id="wrap-bukti" style="display:' + (metode === 'transfer' ? 'block' : 'none') + '">' +
      '<label for="k-bukti">Foto bukti transfer <span style="color:#dc2626">*</span></label>' +
      '<input type="file" id="k-bukti" accept="image/*">' +
      '<div class="bantuan">Wajib diisi jika metode Transfer. Foto dikompres otomatis sebelum dikirim.</div>' +
      '<div class="foto-grid" id="prev-bukti"></div>' +
    '</div>' +
    '<div class="field"><label for="k-catatan">Catatan (opsional)</label>' +
      '<textarea id="k-catatan">' + esc(k.catatan || '') + '</textarea></div>';
}

function pasangToggleBukti() {
  $$('input[name="k-metode"]').forEach((r) => r.addEventListener('change', () => {
    const transfer = $('input[name="k-metode"]:checked').value === 'transfer';
    $('#wrap-bukti').style.display = transfer ? 'block' : 'none';
  }));
  const inp = $('#k-bukti');
  if (inp) inp.addEventListener('change', async () => {
    const prev = $('#prev-bukti');
    prev.innerHTML = '';
    if (!inp.files.length) return;
    try {
      const f = await kompresFoto(inp.files[0]);
      prev.innerHTML = '<div class="foto-thumb"><img src="data:' + f.mime + ';base64,' + f.data + '"></div>';
      inp.dataset.foto = JSON.stringify(f);
    } catch (e) { toast(e.message, 'gagal'); inp.value = ''; }
  });
}

async function layarKasbonForm() {
  viewEl().innerHTML =
    '<h1 class="judul-halaman">Kasbon Baru</h1>' +
    '<p class="subjudul">Catat uang yang diterima dari bendahara</p>' +
    '<div class="card"><form id="formKasbon">' + formKasbonHTML() +
      '<button class="btn btn-primer" type="submit">Simpan Kasbon</button>' +
    '</form></div>';
  pasangToggleBukti();
  $('#formKasbon').addEventListener('submit', async (e) => {
    e.preventDefault();
    const metode = $('input[name="k-metode"]:checked').value;
    const jumlah = Number($('#k-jumlah').value);
    if (!(jumlah > 0)) { toast('Jumlah harus lebih dari 0.', 'gagal'); return; }
    let bukti = null;
    if (metode === 'transfer') {
      if (!$('#k-bukti').dataset.foto) { toast('Metode Transfer wajib melampirkan foto bukti transfer.', 'gagal'); return; }
      bukti = JSON.parse($('#k-bukti').dataset.foto);
    }
    const btn = $('#formKasbon button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Menyimpan...';
    try {
      const body = {
        tanggal: $('#k-tanggal').value,
        jumlah: jumlah,
        keperluan: $('#k-keperluan').value.trim(),
        pemberi: $('#k-pemberi').value.trim(),
        metode: metode,
        catatan: $('#k-catatan').value.trim()
      };
      if (bukti) body.bukti_transfer = bukti;
      const res = await api('/kasbon', { method: 'POST', body: JSON.stringify(body) });
      toast('Kasbon tersimpan.', 'sukses');
      location.hash = '#/kasbon/' + res.kasbon.id;
    } catch (err) {
      toast(err.message, 'gagal');
      btn.disabled = false; btn.textContent = 'Simpan Kasbon';
    }
  });
}

async function layarKasbonEdit(params) {
  const id = params[0];
  layarLoading('Memuat kasbon...');
  const res = await api('/kasbon/' + encodeURIComponent(id));
  const k = res.kasbon;
  if (k.status !== 'aktif') { toast('Kasbon sudah ' + k.status + ', tidak bisa diubah.', 'gagal'); location.hash = '#/kasbon/' + id; return; }
  viewEl().innerHTML =
    '<h1 class="judul-halaman">Ubah Kasbon</h1>' +
    '<p class="subjudul">' + esc(k.keperluan) + '</p>' +
    '<div class="card"><form id="formKasbon">' + formKasbonHTML(k) +
      '<button class="btn btn-primer" type="submit">Simpan Perubahan</button>' +
    '</form></div>';
  pasangToggleBukti();
  $('#formKasbon').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#formKasbon button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Menyimpan...';
    try {
      const body = {
        tanggal: $('#k-tanggal').value,
        jumlah: Number($('#k-jumlah').value),
        keperluan: $('#k-keperluan').value.trim(),
        pemberi: $('#k-pemberi').value.trim(),
        metode: $('input[name="k-metode"]:checked').value,
        catatan: $('#k-catatan').value.trim()
      };
      await api('/kasbon/' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify(body) });
      toast('Kasbon diperbarui.', 'sukses');
      location.hash = '#/kasbon/' + id;
    } catch (err) {
      toast(err.message, 'gagal');
      btn.disabled = false; btn.textContent = 'Simpan Perubahan';
    }
  });
}

async function layarKasbonDetail(params) {
  const id = params[0];
  layarLoading('Memuat kasbon...');
  const res = await api('/kasbon/' + encodeURIComponent(id));
  const k = res.kasbon;
  const daftarBelanja = res.belanja || [];
  const setoran = res.setoran || null;
  // Rekap segar dari endpoint khusus
  let rekap = k.rekap;
  try { rekap = await api('/kasbon/' + encodeURIComponent(id) + '/rekap'); } catch (e) { /* pakai rekap bawaan */ }

  const aktif = k.status === 'aktif';
  const selesai = k.status === 'selesai';

  let buktiHtml = '';
  if (k.bukti_transfer_url) {
    buktiHtml = '<div class="row"><span class="label">Bukti transfer</span></div>' +
      '<a href="' + esc(k.bukti_transfer_url) + '" target="_blank" rel="noopener">' +
      '<img src="' + esc(k.bukti_transfer_url) + '" style="width:120px;border-radius:8px;border:1px solid #e2e8f0" alt="Bukti transfer"></a>';
  }

  let belanjaHtml = daftarBelanja.map((b) =>
    '<div class="card klik" style="padding:10px 12px" onclick="location.hash=\'#/belanja/' + esc(b.id) + '\'">' +
      '<div class="row"><strong>' + esc(b.toko) + '</strong><span class="nilai">' + rupiah(totalBelanja(b)) + '</span></div>' +
      '<div class="row"><span class="label">' + fmtTgl(b.tanggal) + '</span></div>' +
    '</div>'
  ).join('');
  if (!daftarBelanja.length) belanjaHtml = '<div class="kosong" style="padding:16px"><p>Belum ada belanja tercatat.</p></div>';

  let setoranHtml = '';
  if (setoran) {
    setoranHtml = '<div class="card"><h3>Setoran Sisa</h3>' +
      '<div class="row"><span class="label">Tanggal</span><span>' + fmtTgl(setoran.tanggal) + '</span></div>' +
      '<div class="row"><span class="label">Jumlah</span><span class="nilai">' + rupiah(setoran.jumlah) + '</span></div>' +
      '<div class="row"><span class="label">Metode</span><span>' + (setoran.metode === 'transfer' ? 'Transfer' : 'Tunai') + '</span></div>' +
      (setoran.bukti_transfer_url ? '<div class="mt"><a href="' + esc(setoran.bukti_transfer_url) + '" target="_blank" rel="noopener"><img src="' + esc(setoran.bukti_transfer_url) + '" style="width:120px;border-radius:8px;border:1px solid #e2e8f0" alt="Bukti setoran"></a></div>' : '') +
      (setoran.catatan ? '<div class="label mt">' + esc(setoran.catatan) + '</div>' : '') +
      (selesai ? '<button class="btn btn-sekunder btn-kecil mt" id="btnEditSetoran">Ubah Setoran</button>' : '') +
    '</div>';
  }

  let aksi = '<div class="aksi-grid no-print">';
  if (aktif) {
    aksi += '<a class="btn btn-primer" href="#/belanja/baru?kasbon=' + esc(k.id) + '">+ Belanja</a>' +
      '<a class="btn btn-sekunder" href="#/lpj/' + esc(k.id) + '">LPJ</a>' +
      '<button class="btn btn-sekunder" id="btnBagikan">Bagikan</button>' +
      '<a class="btn btn-kuning" href="#/kasbon/' + esc(k.id) + '/tutup">Tutup Kasbon</a>' +
      '<a class="btn btn-sekunder" href="#/kasbon/' + esc(k.id) + '/edit">Ubah</a>' +
      '<button class="btn btn-merah" id="btnHapusKasbon">Hapus</button>';
  } else {
    aksi += '<a class="btn btn-primer" href="#/lpj/' + esc(k.id) + '">Lihat LPJ</a>' +
      '<button class="btn btn-sekunder" id="btnBagikan">Bagikan</button>';
  }
  aksi += '</div>';
  if (!aktif) {
    aksi += '<div class="kotak-info mt">Kasbon berstatus <strong>' + esc(k.status) + '</strong> — data dikunci dan tidak bisa diubah.</div>';
  }

  viewEl().innerHTML =
    '<h1 class="judul-halaman">' + esc(k.keperluan) + '</h1>' +
    '<p class="subjudul">' + badgeKasbon(k.status) + ' ' + badgeRekap((rekap || {}).status || 'AMAN') + '</p>' +
    '<div class="card"><h3>Rekap</h3>' +
      '<div class="ringkasan">' +
        '<div class="kotak"><div class="l">Diterima</div><div class="v">' + rupiah(rekap.diterima) + '</div></div>' +
        '<div class="kotak"><div class="l">Terpakai</div><div class="v">' + rupiah(rekap.terpakai) + ' <span class="label">(' + Math.round(rekap.persen_terpakai || 0) + '%)</span></div></div>' +
        '<div class="kotak"><div class="l">Sisa</div><div class="v ' + ((rekap.sisa || 0) < 0 ? 'v-merah' : 'v-hijau') + '">' + rupiah(rekap.sisa) + '</div></div>' +
      '</div>' +
      '<div class="row"><span class="label">Jumlah</span><span class="nilai besar">' + rupiah(k.jumlah) + '</span></div>' +
      '<div class="row"><span class="label">Tanggal</span><span>' + fmtTgl(k.tanggal) + '</span></div>' +
      '<div class="row"><span class="label">Pemberi</span><span>' + esc(k.pemberi || '-') + '</span></div>' +
      '<div class="row"><span class="label">Metode</span><span>' + (k.metode === 'transfer' ? 'Transfer' : 'Tunai') + '</span></div>' +
      (k.catatan ? '<div class="row"><span class="label">Catatan</span><span>' + esc(k.catatan) + '</span></div>' : '') +
      buktiHtml +
    '</div>' +
    '<h3>Daftar Belanja (' + daftarBelanja.length + ')</h3>' + belanjaHtml +
    setoranHtml + aksi + '<div id="shareBox"></div>';

  const btnBagikan = $('#btnBagikan');
  if (btnBagikan) btnBagikan.addEventListener('click', () => bagikanKasbon(k.id));

  const btnEditSetoran = $('#btnEditSetoran');
  if (btnEditSetoran) btnEditSetoran.addEventListener('click', () => formEditSetoran(k.id, setoran));

  const btnHapus = $('#btnHapusKasbon');
  if (btnHapus) btnHapus.addEventListener('click', async () => {
    if (daftarBelanja.length) { toast('Kasbon tidak bisa dihapus karena sudah ada belanja tercatat.', 'gagal'); return; }
    if (!confirm('Hapus kasbon "' + k.keperluan + '"? Tindakan ini tidak bisa dibatalkan.')) return;
    try {
      await api('/kasbon/' + encodeURIComponent(id), { method: 'DELETE' });
      toast('Kasbon dihapus.', 'sukses');
      location.hash = '#/kasbon';
    } catch (err) { toast(err.message, 'gagal'); }
  });
}

/* ================= 5. SETORAN / TUTUP KASBON ================= */
async function layarTutupKasbon(params) {
  const id = params[0];
  layarLoading('Memuat kasbon...');
  const res = await api('/kasbon/' + encodeURIComponent(id));
  const k = res.kasbon;
  if (k.status !== 'aktif') { toast('Kasbon sudah ' + k.status + '.', 'gagal'); location.hash = '#/kasbon/' + id; return; }
  const r = k.rekap || {};
  viewEl().innerHTML =
    '<h1 class="judul-halaman">Tutup Kasbon</h1>' +
    '<p class="subjudul">' + esc(k.keperluan) + '</p>' +
    '<div class="kotak-peringatan">Menutup kasbon akan <strong>mengunci</strong> seluruh belanja. ' +
      'Catat setoran sisa ke bendahara di bawah ini (boleh 0 jika tidak ada sisa).</div>' +
    '<div class="card"><div class="row"><span class="label">Diterima</span><span class="nilai">' + rupiah(r.diterima) + '</span></div>' +
      '<div class="row"><span class="label">Terpakai</span><span class="nilai">' + rupiah(r.terpakai) + '</span></div>' +
      '<div class="row"><span class="label">Sisa (seharusnya disetor)</span><span class="nilai ' + ((r.sisa || 0) < 0 ? 'v-merah' : 'v-hijau') + '">' + rupiah(r.sisa) + '</span></div></div>' +
    '<div class="card"><h3>Setoran Sisa</h3><form id="formTutup">' +
      '<div class="field"><label for="s-tanggal">Tanggal setoran</label>' +
        '<input type="date" id="s-tanggal" value="' + todayISO() + '" required></div>' +
      '<div class="field"><label for="s-jumlah">Jumlah disetor (Rp, boleh 0)</label>' +
        '<input type="number" id="s-jumlah" min="0" step="1" inputmode="numeric" value="' + Math.max(0, Math.round(r.sisa || 0)) + '" required></div>' +
      '<div class="field"><label>Metode setoran</label><div class="radio-row">' +
        '<label class="radio-pil"><input type="radio" name="s-metode" value="tunai" checked><span>&#128181; Tunai</span></label>' +
        '<label class="radio-pil"><input type="radio" name="s-metode" value="transfer"><span>&#128179; Transfer</span></label>' +
      '</div></div>' +
      '<div class="field" id="wrap-sbukti" style="display:none">' +
        '<label for="s-bukti">Foto bukti transfer <span style="color:#dc2626">*</span></label>' +
        '<input type="file" id="s-bukti" accept="image/*"><div class="foto-grid" id="prev-sbukti"></div></div>' +
      '<div class="field"><label for="s-catatan">Catatan (opsional)</label><textarea id="s-catatan"></textarea></div>' +
      '<button class="btn btn-kuning" type="submit">Tutup Kasbon &amp; Simpan Setoran</button>' +
    '</form></div>';

  $$('input[name="s-metode"]').forEach((x) => x.addEventListener('change', () => {
    $('#wrap-sbukti').style.display = $('input[name="s-metode"]:checked').value === 'transfer' ? 'block' : 'none';
  }));
  $('#s-bukti').addEventListener('change', async () => {
    if (!$('#s-bukti').files.length) return;
    try {
      const f = await kompresFoto($('#s-bukti').files[0]);
      $('#prev-sbukti').innerHTML = '<div class="foto-thumb"><img src="data:' + f.mime + ';base64,' + f.data + '"></div>';
      $('#s-bukti').dataset.foto = JSON.stringify(f);
    } catch (e) { toast(e.message, 'gagal'); $('#s-bukti').value = ''; }
  });

  $('#formTutup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const metode = $('input[name="s-metode"]:checked').value;
    const jumlah = Number($('#s-jumlah').value);
    if (!(jumlah >= 0)) { toast('Jumlah setoran tidak boleh negatif.', 'gagal'); return; }
    let bukti = null;
    if (metode === 'transfer') {
      if (!$('#s-bukti').dataset.foto) { toast('Metode Transfer wajib melampirkan foto bukti transfer.', 'gagal'); return; }
      bukti = JSON.parse($('#s-bukti').dataset.foto);
    }
    if (!confirm('Tutup kasbon dengan setoran ' + rupiah(jumlah) + '? Setelah ditutup, belanja tidak bisa diubah lagi.')) return;
    const btn = $('#formTutup button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Menyimpan...';
    try {
      const setoran = {
        tanggal: $('#s-tanggal').value,
        jumlah: jumlah,
        metode: metode,
        catatan: $('#s-catatan').value.trim()
      };
      if (bukti) setoran.bukti_transfer = bukti;
      await api('/kasbon/' + encodeURIComponent(id) + '/tutup', {
        method: 'POST', body: JSON.stringify({ setoran: setoran })
      });
      toast('Kasbon ditutup. Setoran tersimpan.', 'sukses');
      location.hash = '#/kasbon/' + id;
    } catch (err) {
      toast(err.message, 'gagal');
      btn.disabled = false; btn.textContent = 'Tutup Kasbon & Simpan Setoran';
    }
  });
}

function formEditSetoran(kasbonId, setoran) {
  viewEl().innerHTML =
    '<h1 class="judul-halaman">Ubah Setoran</h1>' +
    '<p class="subjudul">Hanya bisa diubah selama kasbon berstatus selesai</p>' +
    '<div class="card"><form id="formSetoran">' +
      '<div class="field"><label for="es-tanggal">Tanggal setoran</label>' +
        '<input type="date" id="es-tanggal" value="' + esc(setoran.tanggal || todayISO()) + '" required></div>' +
      '<div class="field"><label for="es-jumlah">Jumlah disetor (Rp, boleh 0)</label>' +
        '<input type="number" id="es-jumlah" min="0" step="1" inputmode="numeric" value="' + esc(setoran.jumlah) + '" required></div>' +
      '<div class="field"><label>Metode setoran</label><div class="radio-row">' +
        '<label class="radio-pil"><input type="radio" name="es-metode" value="tunai"' + (setoran.metode !== 'transfer' ? ' checked' : '') + '><span>&#128181; Tunai</span></label>' +
        '<label class="radio-pil"><input type="radio" name="es-metode" value="transfer"' + (setoran.metode === 'transfer' ? ' checked' : '') + '><span>&#128179; Transfer</span></label>' +
      '</div></div>' +
      '<div class="field" id="wrap-esbukti" style="display:' + (setoran.metode === 'transfer' ? 'block' : 'none') + '">' +
        '<label for="es-bukti">Foto bukti transfer (baru, opsional)</label>' +
        '<input type="file" id="es-bukti" accept="image/*"><div class="foto-grid" id="prev-esbukti"></div></div>' +
      '<div class="field"><label for="es-catatan">Catatan (opsional)</label><textarea id="es-catatan">' + esc(setoran.catatan || '') + '</textarea></div>' +
      '<button class="btn btn-primer" type="submit">Simpan Perubahan</button>' +
      '<button class="btn btn-sekunder" type="button" id="btnBatalSetoran">Batal</button>' +
    '</form></div>';

  $$('input[name="es-metode"]').forEach((x) => x.addEventListener('change', () => {
    $('#wrap-esbukti').style.display = $('input[name="es-metode"]:checked').value === 'transfer' ? 'block' : 'none';
  }));
  $('#es-bukti').addEventListener('change', async () => {
    if (!$('#es-bukti').files.length) return;
    try {
      const f = await kompresFoto($('#es-bukti').files[0]);
      $('#prev-esbukti').innerHTML = '<div class="foto-thumb"><img src="data:' + f.mime + ';base64,' + f.data + '"></div>';
      $('#es-bukti').dataset.foto = JSON.stringify(f);
    } catch (e) { toast(e.message, 'gagal'); $('#es-bukti').value = ''; }
  });
  $('#btnBatalSetoran').addEventListener('click', () => { location.hash = '#/kasbon/' + kasbonId; });
  $('#formSetoran').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#formSetoran button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Menyimpan...';
    try {
      const body = {
        tanggal: $('#es-tanggal').value,
        jumlah: Number($('#es-jumlah').value),
        metode: $('input[name="es-metode"]:checked').value,
        catatan: $('#es-catatan').value.trim()
      };
      if ($('#es-bukti').dataset.foto) body.bukti_transfer = JSON.parse($('#es-bukti').dataset.foto);
      await api('/setoran/' + encodeURIComponent(setoran.id), { method: 'PUT', body: JSON.stringify(body) });
      toast('Setoran diperbarui.', 'sukses');
      location.hash = '#/kasbon/' + kasbonId;
    } catch (err) {
      toast(err.message, 'gagal');
      btn.disabled = false; btn.textContent = 'Simpan Perubahan';
    }
  });
}

/* ================= BAGIKAN (tautan LPJ) ================= */
async function bagikanKasbon(kasbonId) {
  const box = $('#shareBox');
  if (box) box.innerHTML = '<div class="loading"><div class="spinner"></div><div>Membuat tautan...</div></div>';
  try {
    const res = await api('/kasbon/' + encodeURIComponent(kasbonId) + '/share', { method: 'POST' });
    const urlPenuh = location.origin + res.url;
    const teksWA = encodeURIComponent('LPJ Belanja VIP — silakan periksa dan setujui di tautan ini: ' + urlPenuh);
    if (box) {
      box.innerHTML = '<div class="share-box no-print"><h3 style="margin-top:0">Tautan Berbagi LPJ</h3>' +
        '<input class="share-url" id="shareUrl" readonly value="' + esc(urlPenuh) + '" onclick="this.select()">' +
        '<div class="aksi-grid mt">' +
          '<button class="btn btn-sekunder btn-kecil" id="btnSalin">Salin Tautan</button>' +
          '<a class="btn btn-wa btn-kecil" href="https://wa.me/?text=' + teksWA + '" target="_blank" rel="noopener">Kirim via WhatsApp</a>' +
        '</div>' +
        '<div class="bantuan">Bendahara bisa membuka tautan ini tanpa login, melihat LPJ, lalu menekan tombol persetujuan.</div></div>';
      $('#btnSalin').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(urlPenuh);
          toast('Tautan disalin.', 'sukses');
        } catch (e) {
          $('#shareUrl').select();
          document.execCommand('copy');
          toast('Tautan disalin.', 'sukses');
        }
      });
    }
    toast('Tautan berbagi dibuat.', 'sukses');
  } catch (err) {
    if (box) box.innerHTML = '';
    toast(err.message, 'gagal');
  }
}

/* ================= 4. BELANJA ================= */
async function layarBelanjaCari(params, query) {
  layarLoading('Memuat belanja...');
  const resK = await api('/kasbon').catch(() => ({ kasbon: [] }));
  const semuaKasbon = resK.kasbon || [];
  const q = query.q || '', dari = query.from || '', sampai = query.to || '', kasbonId = query.kasbon_id || '';

  viewEl().innerHTML =
    '<h1 class="judul-halaman">Belanja</h1>' +
    '<p class="subjudul">Cari &amp; filter catatan belanja</p>' +
    '<div class="card"><form id="formCari">' +
      '<div class="field"><label for="c-q">Kata kunci (nama barang / toko)</label>' +
        '<input type="text" id="c-q" value="' + esc(q) + '" placeholder="cth: filter oli"></div>' +
      '<div class="field"><label for="c-kasbon">Kasbon</label><select id="c-kasbon">' +
        '<option value="">Semua kasbon</option>' +
        semuaKasbon.map((k) => '<option value="' + esc(k.id) + '"' + (kasbonId === k.id ? ' selected' : '') + '>' + esc(k.keperluan) + ' (' + esc(k.status) + ')</option>').join('') +
      '</select></div>' +
      '<div class="field"><label>Rentang tanggal</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        '<input type="date" id="c-dari" value="' + esc(dari) + '">' +
        '<input type="date" id="c-sampai" value="' + esc(sampai) + '">' +
      '</div></div>' +
      '<button class="btn btn-primer" type="submit">Cari</button>' +
    '</form></div>' +
    '<a class="btn btn-sekunder mb" href="#/belanja/baru">+ Catat Belanja Baru</a>' +
    '<div id="hasilCari"></div>';

  const jalankan = async () => {
    const box = $('#hasilCari');
    box.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    const p = new URLSearchParams();
    if ($('#c-q').value.trim()) p.set('q', $('#c-q').value.trim());
    if ($('#c-kasbon').value) p.set('kasbon_id', $('#c-kasbon').value);
    if ($('#c-dari').value) p.set('from', $('#c-dari').value);
    if ($('#c-sampai').value) p.set('to', $('#c-sampai').value);
    try {
      const res = await api('/belanja?' + p.toString());
      const daftar = res.belanja || [];
      if (!daftar.length) { box.innerHTML = '<div class="kosong"><span class="emoji">&#128269;</span><p>Tidak ada belanja yang cocok.</p></div>'; return; }
      box.innerHTML = daftar.map((b) =>
        '<div class="card klik" style="padding:10px 12px" onclick="location.hash=\'#/belanja/' + esc(b.id) + '\'">' +
          '<div class="row"><strong>' + esc(b.toko) + '</strong><span class="nilai">' + rupiah(totalBelanja(b)) + '</span></div>' +
          '<div class="row"><span class="label">' + fmtTgl(b.tanggal) + (b.items && b.items.length ? ' &middot; ' + esc(b.items[0].nama_barang) + (b.items.length > 1 ? ' +' + (b.items.length - 1) + ' item' : '') : '') + '</span></div>' +
        '</div>'
      ).join('');
    } catch (err) { box.innerHTML = '<div class="kosong"><p>' + esc(err.message) + '</p></div>'; }
  };

  $('#formCari').addEventListener('submit', (e) => { e.preventDefault(); jalankan(); });
  jalankan();
}

function itemRowHTML() {
  return '<div class="item-row" data-tipe="item">' +
    '<div class="item-head"><span>Item</span><button type="button" class="btn-hapus-kecil" data-hapus title="Hapus item">&times;</button></div>' +
    '<div class="field" style="margin-bottom:8px"><input type="text" data-f="nama" placeholder="Nama barang *"></div>' +
    '<div class="grid2">' +
      '<div class="field" style="margin-bottom:8px"><input type="number" data-f="qty" min="1" step="1" inputmode="numeric" placeholder="Qty *"></div>' +
      '<div class="field" style="margin-bottom:8px"><input type="text" data-f="satuan" placeholder="Satuan (pcs, ltr...)"></div>' +
    '</div>' +
    '<div class="field" style="margin-bottom:0"><input type="number" data-f="harga" min="0" step="1" inputmode="numeric" placeholder="Harga satuan (Rp) *"></div>' +
  '</div>';
}
function biayaRowHTML() {
  return '<div class="item-row" data-tipe="biaya">' +
    '<div class="item-head"><span>Biaya lain</span><button type="button" class="btn-hapus-kecil" data-hapus title="Hapus biaya">&times;</button></div>' +
    '<div class="grid2">' +
      '<div class="field" style="margin-bottom:8px"><select data-f="jenis">' +
        '<option value="ongkos">Ongkos</option><option value="parkir">Parkir</option><option value="lainnya">Lainnya</option>' +
      '</select></div>' +
      '<div class="field" style="margin-bottom:8px"><input type="number" data-f="jumlah" min="1" step="1" inputmode="numeric" placeholder="Jumlah (Rp) *"></div>' +
    '</div>' +
    '<div class="field" style="margin-bottom:0"><input type="text" data-f="ket" placeholder="Keterangan (opsional)"></div>' +
  '</div>';
}

function pasangFormBelanja() {
  $('#btnTambahItem').addEventListener('click', () => { $('#daftarItem').insertAdjacentHTML('beforeend', itemRowHTML()); hitungEstimasi(); });
  $('#btnTambahBiaya').addEventListener('click', () => { $('#daftarBiaya').insertAdjacentHTML('beforeend', biayaRowHTML()); hitungEstimasi(); });
  $('#formBelanja').addEventListener('click', (e) => {
    const h = e.target.closest('[data-hapus]');
    if (h) { h.closest('.item-row').remove(); hitungEstimasi(); }
  });
  $('#formBelanja').addEventListener('input', hitungEstimasi);
  $('#inputFoto').addEventListener('change', async () => {
    const files = $('#inputFoto').files;
    if (!files.length) return;
    const wadah = $('#daftarFotoBaru');
    for (let i = 0; i < files.length; i++) {
      try {
        const f = await kompresFoto(files[i]);
        const div = document.createElement('div');
        div.className = 'foto-thumb';
        div.dataset.foto = JSON.stringify(f);
        div.innerHTML = '<img src="data:' + f.mime + ';base64,' + f.data + '"><button type="button" title="Hapus">&times;</button>';
        div.querySelector('button').addEventListener('click', () => div.remove());
        wadah.appendChild(div);
      } catch (err) { toast(err.message, 'gagal'); }
    }
    $('#inputFoto').value = '';
    hitungEstimasi();
  });
}

function hitungEstimasi() {
  let total = 0, nFoto = 0;
  $$('#daftarItem .item-row').forEach((r) => {
    const qty = Number($('[data-f="qty"]', r).value) || 0;
    const hrg = Number($('[data-f="harga"]', r).value) || 0;
    total += qty * hrg;
  });
  $$('#daftarBiaya .item-row').forEach((r) => { total += Number($('[data-f="jumlah"]', r).value) || 0; });
  nFoto = $$('#daftarFotoBaru .foto-thumb').length + $$('#daftarFotoLama .foto-thumb:not(.dihapus)').length;
  const el = $('#estimasi');
  if (el) el.innerHTML = 'Estimasi total: <strong>' + rupiah(total) + '</strong> &middot; Foto: <strong>' + nFoto + '</strong>';
}

function kumpulkanBelanjaDariForm() {
  const items = [];
  $$('#daftarItem .item-row').forEach((r) => {
    const nama = $('[data-f="nama"]', r).value.trim();
    const qty = Number($('[data-f="qty"]', r).value);
    const harga = Number($('[data-f="harga"]', r).value);
    if (!nama && !qty && !harga) return; // baris kosong diabaikan
    items.push({ nama_barang: nama, qty: qty, satuan: $('[data-f="satuan"]', r).value.trim(), harga_satuan: harga });
  });
  const biaya = [];
  $$('#daftarBiaya .item-row').forEach((r) => {
    const jumlah = Number($('[data-f="jumlah"]', r).value);
    if (!jumlah) return;
    biaya.push({ jenis: $('[data-f="jenis"]', r).value, jumlah: jumlah, keterangan: $('[data-f="ket"]', r).value.trim() });
  });
  const fotos = [];
  $$('#daftarFotoBaru .foto-thumb').forEach((d) => { fotos.push(JSON.parse(d.dataset.foto)); });
  return { items: items, biaya_lain: biaya, fotos: fotos };
}

function validasiBelanja(d) {
  if (!d.items.length && !d.biaya_lain.length) return 'Isi minimal 1 item barang atau 1 biaya lain.';
  for (const it of d.items) {
    if (!it.nama_barang) return 'Nama barang wajib diisi.';
    if (!(it.qty > 0)) return 'Qty "' + it.nama_barang + '" harus lebih dari 0.';
    if (!(it.harga_satuan >= 0)) return 'Harga "' + it.nama_barang + '" tidak boleh negatif.';
  }
  for (const b of d.biaya_lain) {
    if (!(b.jumlah > 0)) return 'Jumlah biaya lain harus lebih dari 0.';
  }
  if (!d.fotos.length) return 'Wajib melampirkan minimal 1 foto nota.';
  return null;
}

async function layarBelanjaForm(params, query) {
  layarLoading('Memuat...');
  const res = await api('/kasbon?status=aktif');
  const daftar = res.kasbon || [];
  if (!daftar.length) {
    viewEl().innerHTML = '<div class="kosong"><span class="emoji">&#128188;</span>' +
      '<p>Belum ada kasbon aktif.<br>Buat kasbon dulu sebelum mencatat belanja.</p>' +
      '<a class="btn btn-primer btn-kecil" href="#/kasbon/baru">Buat Kasbon</a></div>';
    return;
  }
  const pilih = query.kasbon || daftar[0].id;
  viewEl().innerHTML =
    '<h1 class="judul-halaman">Catat Belanja</h1>' +
    '<p class="subjudul">Satu nota tercatat &lt; 30 detik</p>' +
    '<div class="card"><form id="formBelanja">' +
      '<div class="field"><label for="b-kasbon">Kasbon</label><select id="b-kasbon">' +
        daftar.map((k) => '<option value="' + esc(k.id) + '"' + (k.id === pilih ? ' selected' : '') + '>' + esc(k.keperluan) + ' (' + rupiah(k.jumlah) + ')</option>').join('') +
      '</select></div>' +
      '<div class="field"><label for="b-tanggal">Tanggal belanja</label>' +
        '<input type="date" id="b-tanggal" value="' + todayISO() + '" required></div>' +
      '<div class="field"><label for="b-toko">Nama toko / supplier</label>' +
        '<input type="text" id="b-toko" placeholder="cth: Toko Jaya" required></div>' +
      '<div class="field"><label>Item barang</label><div id="daftarItem">' + itemRowHTML() + '</div>' +
        '<button type="button" class="btn btn-sekunder btn-kecil" id="btnTambahItem">+ Tambah Item</button></div>' +
      '<div class="field"><label>Biaya lain (opsional)</label><div id="daftarBiaya"></div>' +
        '<button type="button" class="btn btn-sekunder btn-kecil" id="btnTambahBiaya">+ Tambah Biaya</button></div>' +
      '<div class="field"><label for="inputFoto">Foto nota <span style="color:#dc2626">* (bisa banyak)</span></label>' +
        '<input type="file" id="inputFoto" accept="image/*" multiple capture="environment">' +
        '<div class="bantuan">Bisa dari kamera atau galeri. Foto dikompres otomatis di HP sebelum dikirim.</div>' +
        '<div class="foto-grid" id="daftarFotoBaru"></div><div class="foto-grid" id="daftarFotoLama" style="display:none"></div></div>' +
      '<div class="field"><label for="b-catatan">Catatan (opsional)</label><textarea id="b-catatan"></textarea></div>' +
      '<div class="kotak-info" id="estimasi">Estimasi total: <strong>Rp 0</strong></div>' +
      '<button class="btn btn-primer" type="submit">Simpan Belanja</button>' +
    '</form></div>';
  pasangFormBelanja();
  $('#formBelanja').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = kumpulkanBelanjaDariForm();
    const err = validasiBelanja(d);
    if (err) { toast(err, 'gagal'); return; }
    const btn = $('#formBelanja button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Menyimpan...';
    try {
      const belanja = await api('/belanja', {
        method: 'POST',
        body: JSON.stringify({
          kasbon_id: $('#b-kasbon').value,
          tanggal: $('#b-tanggal').value,
          toko: $('#b-toko').value.trim(),
          catatan: $('#b-catatan').value.trim(),
          items: d.items,
          biaya_lain: d.biaya_lain,
          fotos: d.fotos
        })
      });
      toast('Belanja tersimpan: ' + rupiah(belanja.total) + '.', 'sukses');
      location.hash = '#/kasbon/' + belanja.kasbon_id;
    } catch (e2) {
      toast(e2.message, 'gagal');
      btn.disabled = false; btn.textContent = 'Simpan Belanja';
    }
  });
}

async function layarBelanjaDetail(params) {
  const id = params[0];
  layarLoading('Memuat belanja...');
  const b = await api('/belanja/' + encodeURIComponent(id));
  let kasbonStatus = 'aktif';
  try {
    const rk = await api('/kasbon/' + encodeURIComponent(b.kasbon_id));
    kasbonStatus = rk.kasbon.status;
  } catch (e) { /* abaikan */ }
  const bisaUbah = kasbonStatus === 'aktif';

  const itemsHtml = (b.items || []).map((it, i) =>
    '<tr><td>' + (i + 1) + '. ' + esc(it.nama_barang) + '</td>' +
    '<td class="kanan">' + esc(it.qty) + ' ' + esc(it.satuan || '') + '</td>' +
    '<td class="kanan">' + rupiah(it.harga_satuan) + '</td>' +
    '<td class="kanan">' + rupiah(it.subtotal != null ? it.subtotal : it.qty * it.harga_satuan) + '</td></tr>'
  ).join('');
  const biayaHtml = (b.biaya_lain || []).map((x) =>
    '<tr><td>' + esc(x.jenis) + (x.keterangan ? ' — ' + esc(x.keterangan) : '') + '</td>' +
    '<td class="kanan" colspan="3">' + rupiah(x.jumlah) + '</td></tr>'
  ).join('');
  const fotoHtml = (b.fotos || []).map((f) =>
    '<a href="' + esc(f.url) + '" target="_blank" rel="noopener"><img src="' + esc(f.url) + '" alt="Foto nota"></a>'
  ).join('');
  const fotoGrid = '<div class="foto-lpj" id="fotoBelanja">' + fotoHtml + '</div>';

  viewEl().innerHTML =
    '<h1 class="judul-halaman">Detail Belanja</h1>' +
    '<p class="subjudul">' + esc(b.toko) + ' &middot; ' + fmtTgl(b.tanggal) + '</p>' +
    '<div class="card"><div class="tabel-wrap"><table class="tabel">' +
      '<tr><th>Barang</th><th class="kanan">Qty</th><th class="kanan">Harga</th><th class="kanan">Subtotal</th></tr>' +
      itemsHtml + biayaHtml +
      '<tr class="total"><td colspan="3">Total belanja</td><td class="kanan">' + rupiah(b.total) + '</td></tr>' +
    '</table></div>' +
    (b.catatan ? '<div class="label mt">Catatan: ' + esc(b.catatan) + '</div>' : '') +
    '</div>' +
    '<div class="card"><h3>Foto Nota (' + (b.fotos || []).length + ')</h3>' + fotoGrid + '</div>' +
    '<div class="aksi-grid no-print">' +
      (bisaUbah
        ? '<a class="btn btn-sekunder" href="#/belanja/' + esc(b.id) + '/edit">Ubah</a>' +
          '<button class="btn btn-merah" id="btnHapusBelanja">Hapus</button>'
        : '<a class="btn btn-sekunder" href="#/kasbon/' + esc(b.kasbon_id) + '">Kembali ke Kasbon</a>') +
    '</div>';
  const st = document.createElement('style');
  st.textContent = '#fotoBelanja{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}#fotoBelanja img{width:100%;border-radius:8px;border:1px solid #e2e8f0}';
  document.head.appendChild(st);

  const btnHapus = $('#btnHapusBelanja');
  if (btnHapus) btnHapus.addEventListener('click', async () => {
    if (!confirm('Hapus belanja di ' + b.toko + ' (' + rupiah(b.total) + ')?')) return;
    try {
      await api('/belanja/' + encodeURIComponent(id), { method: 'DELETE' });
      toast('Belanja dihapus.', 'sukses');
      location.hash = '#/kasbon/' + b.kasbon_id;
    } catch (err) { toast(err.message, 'gagal'); }
  });
}

async function layarBelanjaEdit(params) {
  const id = params[0];
  layarLoading('Memuat belanja...');
  const b = await api('/belanja/' + encodeURIComponent(id));
  viewEl().innerHTML =
    '<h1 class="judul-halaman">Ubah Belanja</h1>' +
    '<p class="subjudul">' + esc(b.toko) + ' &middot; ' + fmtTgl(b.tanggal) + '</p>' +
    '<div class="card"><form id="formBelanja">' +
      '<div class="field"><label for="b-tanggal">Tanggal belanja</label>' +
        '<input type="date" id="b-tanggal" value="' + esc(b.tanggal) + '" required></div>' +
      '<div class="field"><label for="b-toko">Nama toko / supplier</label>' +
        '<input type="text" id="b-toko" value="' + esc(b.toko) + '" required></div>' +
      '<div class="field"><label>Item barang</label><div id="daftarItem">' +
        (b.items || []).map(() => itemRowHTML()).join('') + '</div>' +
        '<button type="button" class="btn btn-sekunder btn-kecil" id="btnTambahItem">+ Tambah Item</button></div>' +
      '<div class="field"><label>Biaya lain</label><div id="daftarBiaya">' +
        (b.biaya_lain || []).map(() => biayaRowHTML()).join('') + '</div>' +
        '<button type="button" class="btn btn-sekunder btn-kecil" id="btnTambahBiaya">+ Tambah Biaya</button></div>' +
      '<div class="field"><label>Foto nota</label>' +
        '<div class="bantuan" style="margin-bottom:6px">Ketuk foto lama untuk menandai hapus. Tambah foto baru di bawah.</div>' +
        '<div class="foto-grid" id="daftarFotoLama">' +
          (b.fotos || []).map((f) =>
            '<div class="foto-thumb" data-foto-id="' + esc(f.id) + '"><img src="' + esc(f.url) + '"><button type="button" title="Tandai hapus">&times;</button></div>'
          ).join('') +
        '</div>' +
        '<div class="field mt"><label for="inputFoto">Tambah foto baru</label>' +
        '<input type="file" id="inputFoto" accept="image/*" multiple capture="environment">' +
        '<div class="foto-grid" id="daftarFotoBaru"></div></div></div>' +
      '<div class="field"><label for="b-catatan">Catatan (opsional)</label><textarea id="b-catatan">' + esc(b.catatan || '') + '</textarea></div>' +
      '<div class="kotak-info" id="estimasi"></div>' +
      '<button class="btn btn-primer" type="submit">Simpan Perubahan</button>' +
    '</form></div>';

  // isi nilai item & biaya
  $$('#daftarItem .item-row').forEach((r, i) => {
    const it = b.items[i];
    $('[data-f="nama"]', r).value = it.nama_barang || '';
    $('[data-f="qty"]', r).value = it.qty || '';
    $('[data-f="satuan"]', r).value = it.satuan || '';
    $('[data-f="harga"]', r).value = it.harga_satuan || '';
  });
  $$('#daftarBiaya .item-row').forEach((r, i) => {
    const x = b.biaya_lain[i];
    $('[data-f="jenis"]', r).value = x.jenis || 'lainnya';
    $('[data-f="jumlah"]', r).value = x.jumlah || '';
    $('[data-f="ket"]', r).value = x.keterangan || '';
  });

  // tandai hapus foto lama
  $$('#daftarFotoLama .foto-thumb').forEach((d) => {
    d.querySelector('button').addEventListener('click', () => d.classList.toggle('dihapus'));
  });

  pasangFormBelanja();
  hitungEstimasi();

  $('#formBelanja').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = kumpulkanBelanjaDariForm();
    // foto lama yang tidak ditandai hapus ikut sebagai daftar final
    $$('#daftarFotoLama .foto-thumb:not(.dihapus)').forEach((x) => {
      d.fotos.push({ id: x.dataset.fotoId });
    });
    const err = validasiBelanja(d);
    if (err) { toast(err, 'gagal'); return; }
    const btn = $('#formBelanja button[type="submit"]');
    btn.disabled = true; btn.textContent = 'Menyimpan...';
    try {
      await api('/belanja/' + encodeURIComponent(id), {
        method: 'PUT',
        body: JSON.stringify({
          tanggal: $('#b-tanggal').value,
          toko: $('#b-toko').value.trim(),
          catatan: $('#b-catatan').value.trim(),
          items: d.items,
          biaya_lain: d.biaya_lain,
          fotos: d.fotos
        })
      });
      toast('Belanja diperbarui.', 'sukses');
      location.hash = '#/belanja/' + id;
    } catch (e2) {
      toast(e2.message, 'gagal');
      btn.disabled = false; btn.textContent = 'Simpan Perubahan';
    }
  });
}

/* Total belanja dengan fallback hitung manual bila field total tak ada */
function totalItemBelanja(b) {
  if (b.total_item != null) return Number(b.total_item) || 0;
  return (b.items || []).reduce((s, it) =>
    s + (it.subtotal != null ? Number(it.subtotal) : Number(it.qty || 0) * Number(it.harga_satuan || 0)), 0);
}
function totalBiayaBelanja(b) {
  if (b.total_biaya != null) return Number(b.total_biaya) || 0;
  return (b.biaya_lain || []).reduce((s, x) => s + (Number(x.jumlah) || 0), 0);
}
function totalBelanja(b) {
  if (b.total != null) return Number(b.total) || 0;
  return totalItemBelanja(b) + totalBiayaBelanja(b);
}

/* ================= 6. LPJ ================= */
function lpjDocHTML(k, daftarBelanja, setoran, rekap) {
  const r = rekap || k.rekap || {};
  let no = 0, grandItem = 0, grandBiaya = 0;
  const tabelBelanja = daftarBelanja.map((b) => {
    no++;
    const det = (b.items || []).map((it) =>
      '<tr><td></td><td>' + esc(it.nama_barang) + '</td><td class="kanan">' + esc(it.qty) + ' ' + esc(it.satuan || '') + '</td>' +
      '<td class="kanan">' + rupiah(it.harga_satuan) + '</td><td class="kanan">' + rupiah(it.subtotal != null ? it.subtotal : it.qty * it.harga_satuan) + '</td></tr>'
    ).join('');
    const by = (b.biaya_lain || []).map((x) =>
      '<tr><td></td><td colspan="3">Biaya ' + esc(x.jenis) + (x.keterangan ? ' — ' + esc(x.keterangan) : '') + '</td><td class="kanan">' + rupiah(x.jumlah) + '</td></tr>'
    ).join('');
    grandItem += totalItemBelanja(b);
    grandBiaya += totalBiayaBelanja(b);
    return '<tr class="total"><td>' + no + '</td><td>' + esc(b.toko) + '<br><span class="label">' + fmtTgl(b.tanggal) + '</span></td>' +
      '<td></td><td></td><td class="kanan">' + rupiah(totalBelanja(b)) + '</td></tr>' + det + by;
  }).join('');
  const grand = grandItem + grandBiaya;

  const fotoNota = [];
  daftarBelanja.forEach((b) => (b.fotos || []).forEach((f) => fotoNota.push(f)));

  return '<div id="lpj-doc">' +
    '<div class="kop"><h2>LAPORAN PERTANGGUNGJAWABAN (LPJ)</h2><div>Belanja VIP</div></div>' +
    '<table class="tabel">' +
      '<tr><th style="width:38%">Keperluan</th><td>' + esc(k.keperluan) + '</td></tr>' +
      '<tr><th>Tanggal kasbon</th><td>' + fmtTgl(k.tanggal) + '</td></tr>' +
      '<tr><th>Pemberi / bendahara</th><td>' + esc(k.pemberi || '-') + '</td></tr>' +
      '<tr><th>Metode terima</th><td>' + (k.metode === 'transfer' ? 'Transfer' : 'Tunai') + '</td></tr>' +
      '<tr><th>Uang diterima</th><td><strong>' + rupiah(k.jumlah) + '</strong></td></tr>' +
      '<tr><th>Status</th><td>' + badgeKasbon(k.status) + ' ' + badgeRekap(r.status || 'AMAN') + '</td></tr>' +
      (k.disetujui_oleh ? '<tr><th>Disetujui oleh</th><td>' + esc(k.disetujui_oleh) + ' (' + fmtTglWaktu(k.disetujui_at) + ')</td></tr>' : '') +
    '</table>' +
    '<h3 class="mt">Rincian Belanja (' + daftarBelanja.length + ' transaksi)</h3>' +
    '<div class="tabel-wrap"><table class="tabel">' +
      '<tr><th>No</th><th>Toko / Barang</th><th class="kanan">Qty</th><th class="kanan">Harga</th><th class="kanan">Jumlah</th></tr>' +
      (tabelBelanja || '<tr><td colspan="5" class="tengah label">Belum ada belanja.</td></tr>') +
      '<tr class="total"><td colspan="4">Total belanja</td><td class="kanan">' + rupiah(grand) + '</td></tr>' +
    '</table></div>' +
    '<h3 class="mt">Setoran Sisa</h3>' +
    (setoran
      ? '<table class="tabel"><tr><th>Tanggal</th><td>' + fmtTgl(setoran.tanggal) + '</td></tr>' +
        '<tr><th>Jumlah</th><td><strong>' + rupiah(setoran.jumlah) + '</strong></td></tr>' +
        '<tr><th>Metode</th><td>' + (setoran.metode === 'transfer' ? 'Transfer' : 'Tunai') + '</td></tr></table>'
      : '<p class="label">Belum ada setoran (kasbon masih aktif).</p>') +
    '<h3 class="mt">Rekonsiliasi</h3>' +
    '<table class="tabel">' +
      '<tr><th>Diterima</th><td class="kanan">' + rupiah(r.diterima) + '</td></tr>' +
      '<tr><th>Terpakai</th><td class="kanan">' + rupiah(r.terpakai) + '</td></tr>' +
      '<tr><th>Disetor</th><td class="kanan">' + rupiah(setoran ? setoran.jumlah : 0) + '</td></tr>' +
      '<tr class="total"><td>Selisih (diterima &minus; terpakai &minus; disetor)</td><td class="kanan">' +
        rupiah((r.diterima || 0) - (r.terpakai || 0) - (setoran ? setoran.jumlah : 0)) + '</td></tr>' +
    '</table>' +
    (fotoNota.length ? '<h3 class="mt">Foto Nota (' + fotoNota.length + ')</h3><div class="foto-lpj">' +
      fotoNota.map((f) => '<img src="' + esc(f.url) + '" alt="Foto nota">').join('') + '</div>' : '') +
    ((k.bukti_transfer_url || (setoran && setoran.bukti_transfer_url))
      ? '<h3 class="mt">Bukti Transfer</h3><div class="foto-lpj">' +
        (k.bukti_transfer_url ? '<img src="' + esc(k.bukti_transfer_url) + '" alt="Bukti transfer kasbon">' : '') +
        (setoran && setoran.bukti_transfer_url ? '<img src="' + esc(setoran.bukti_transfer_url) + '" alt="Bukti transfer setoran">' : '') +
        '</div>' : '') +
    '<div class="ttd"><div>Pemegang Kasbon<div class="garis">( .................... )</div></div>' +
    '<div>Bendahara<div class="garis">( ' + esc(k.disetujui_oleh || '....................') + ' )</div></div></div>' +
  '</div>';
}

async function layarLPJ(params) {
  const id = params[0];
  layarLoading('Menyusun LPJ...');
  const res = await api('/kasbon/' + encodeURIComponent(id));
  const k = res.kasbon;
  const daftarBelanja = res.belanja || [];
  const setoran = res.setoran || null;
  let rekap = k.rekap;
  try { rekap = await api('/kasbon/' + encodeURIComponent(id) + '/rekap'); } catch (e) { /* abaikan */ }

  const statusSetuju = k.status === 'disetujui'
    ? '<div class="kotak-info">&#9989; <strong>Disetujui</strong> oleh ' + esc(k.disetujui_oleh) + ' pada ' + fmtTglWaktu(k.disetujui_at) + '. LPJ dikunci permanen.</div>'
    : '<div class="kotak-peringatan">Status persetujuan: <strong>belum disetujui bendahara</strong>.</div>';

  viewEl().innerHTML =
    '<h1 class="judul-halaman">LPJ Kasbon</h1>' +
    '<p class="subjudul">' + esc(k.keperluan) + '</p>' +
    statusSetuju +
    '<div class="card">' + lpjDocHTML(k, daftarBelanja, setoran, rekap) + '</div>' +
    '<div class="no-print">' +
      '<button class="btn btn-primer" id="btnExcel">&#128202; Unduh Excel (.xlsx)</button>' +
      '<button class="btn btn-sekunder" id="btnCetak">&#128438; Cetak / Simpan PDF</button>' +
      '<button class="btn btn-sekunder" id="btnShareLPJ">&#128279; Buat Tautan Berbagi</button>' +
      '<div id="shareBox"></div>' +
    '</div>';

  $('#btnExcel').addEventListener('click', async () => {
    const btn = $('#btnExcel');
    btn.disabled = true; btn.textContent = 'Mengunduh...';
    try {
      const t = getToken();
      const resp = await fetch('/api/kasbon/' + encodeURIComponent(id) + '/lpj.xlsx', {
        headers: { 'Authorization': 'Bearer ' + t }
      });
      if (!resp.ok) {
        let d = null;
        try { d = await resp.json(); } catch (e) { /* abaikan */ }
        throw new Error((d && d.error) || 'Gagal mengunduh Excel.');
      }
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'LPJ-' + k.tanggal + '.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('File Excel diunduh.', 'sukses');
    } catch (err) { toast(err.message, 'gagal'); }
    btn.disabled = false; btn.innerHTML = '&#128202; Unduh Excel (.xlsx)';
  });
  $('#btnCetak').addEventListener('click', () => window.print());
  $('#btnShareLPJ').addEventListener('click', () => bagikanKasbon(id));
}

/* ================= 7. REKAP BULANAN ================= */
async function layarRekap(params, query) {
  const bulan = query.bulan || bulanIni();
  viewEl().innerHTML =
    '<h1 class="judul-halaman">Rekap Bulanan</h1>' +
    '<p class="subjudul">Total belanja per bulan</p>' +
    '<div class="card"><form id="formRekap"><div class="field">' +
      '<label for="r-bulan">Pilih bulan</label>' +
      '<input type="month" id="r-bulan" value="' + esc(bulan) + '">' +
    '</div><button class="btn btn-primer" type="submit">Tampilkan</button></form></div>' +
    '<div id="hasilRekap"></div>';

  const tampilkan = async (bln) => {
    const box = $('#hasilRekap');
    box.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    try {
      const r = await api('/rekap-bulanan?bulan=' + encodeURIComponent(bln));
      const top = r.top_toko || [];
      const maks = top.length ? Math.max.apply(null, top.map((t) => Number(t.total) || 0)) : 0;
      const barHtml = top.map((t) => {
        const pct = maks > 0 ? Math.round((Number(t.total) / maks) * 100) : 0;
        return '<div class="bar-row"><span class="nama">' + esc(t.toko) + '</span>' +
          '<span class="bar-luar"><span class="bar-dalam" style="display:block;width:' + pct + '%"></span></span>' +
          '<span class="angka">' + rupiah(t.total) + '</span></div>';
      }).join('');
      box.innerHTML =
        '<div class="card"><h3>Rekap ' + esc(bln) + '</h3>' +
          '<div class="ringkasan">' +
            '<div class="kotak"><div class="l">Total belanja</div><div class="v">' + rupiah(r.total_belanja) + '</div></div>' +
            '<div class="kotak"><div class="l">Transaksi</div><div class="v">' + esc(r.jumlah_transaksi) + '</div></div>' +
            '<div class="kotak"><div class="l">Rata-rata / kasbon</div><div class="v">' + rupiah(r.rata_per_kasbon) + '</div></div>' +
          '</div></div>' +
        '<div class="card"><h3>Top 5 Toko</h3>' +
          (barHtml || '<p class="label">Belum ada data bulan ini.</p>') + '</div>';
    } catch (err) {
      box.innerHTML = '<div class="kosong"><p>' + esc(err.message) + '</p></div>';
    }
  };
  $('#formRekap').addEventListener('submit', (e) => {
    e.preventDefault();
    const bln = $('#r-bulan').value;
    if (!bln) { toast('Pilih bulan dulu.', 'gagal'); return; }
    gantiHash('#/rekap?bulan=' + bln);
  });
  tampilkan(bulan);
}

/* ================= 8. RIWAYAT ================= */
async function layarRiwayat() {
  layarLoading('Memuat riwayat...');
  const [a, b] = await Promise.all([
    api('/kasbon?status=selesai').catch(() => ({ kasbon: [] })),
    api('/kasbon?status=disetujui').catch(() => ({ kasbon: [] }))
  ]);
  const daftar = (a.kasbon || []).concat(b.kasbon || []);
  daftar.sort((x, y) => String(y.tanggal).localeCompare(String(x.tanggal)));

  let isi = daftar.map((k) => {
    const r = k.rekap || {};
    return '<div class="card klik" onclick="location.hash=\'#/kasbon/' + esc(k.id) + '\'">' +
      '<div class="row"><strong>' + esc(k.keperluan) + '</strong>' + badgeKasbon(k.status) + '</div>' +
      '<div class="row"><span class="label">' + fmtTgl(k.tanggal) + ' &middot; ' + esc(k.pemberi || '') + '</span></div>' +
      '<div class="row mt"><span class="label">Diterima</span><span class="nilai">' + rupiah(k.jumlah) + '</span></div>' +
      '<div class="row"><span class="label">Terpakai</span><span class="nilai">' + rupiah(r.terpakai) + '</span></div>' +
      '<div class="row"><span class="label">Disetor</span><span class="nilai">' + (k.setoran_jumlah === null ? '-' : rupiah(k.setoran_jumlah)) + '</span></div>' +
      (k.disetujui_oleh ? '<div class="row"><span class="label">Disetujui oleh</span><span>' + esc(k.disetujui_oleh) + '</span></div>' : '') +
    '</div>';
  }).join('');
  if (!daftar.length) isi = '<div class="kosong"><span class="emoji">&#128193;</span><p>Belum ada arsip kasbon.</p></div>';

  viewEl().innerHTML =
    '<h1 class="judul-halaman">Riwayat</h1>' +
    '<p class="subjudul">Arsip kasbon selesai &amp; disetujui (read-only)</p>' + isi;
}

/* ================= 9. PENGATURAN ================= */
async function layarPengaturan() {
  layarLoading('Memuat pengaturan...');
  const [me, ver, wake] = await Promise.all([
    api('/me'),
    api('/version').catch(() => null),
    api('/wake').then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e.message }))
  ]);
  $('#topbarUser').textContent = me.nama || me.username;

  viewEl().innerHTML =
    '<h1 class="judul-halaman">Pengaturan</h1>' +
    '<p class="subjudul">Kelola akun &amp; info koneksi</p>' +
    '<div class="card"><h3>Profil</h3>' +
      '<div class="row"><span class="label">Username</span><span class="nilai">' + esc(me.username) + '</span></div>' +
      '<form id="formNama" class="mt"><div class="field"><label for="p-nama">Nama tampilan</label>' +
        '<input type="text" id="p-nama" value="' + esc(me.nama || '') + '" required></div>' +
        '<button class="btn btn-primer" type="submit">Simpan Nama</button></form>' +
    '</div>' +
    '<div class="card"><h3>Ubah Password</h3><form id="formPass">' +
      '<div class="field"><label for="p-lama">Password lama</label><input type="password" id="p-lama" required></div>' +
      '<div class="field"><label for="p-baru">Password baru (min. 6 karakter)</label><input type="password" id="p-baru" minlength="6" required></div>' +
      '<div class="field"><label for="p-baru2">Ulangi password baru</label><input type="password" id="p-baru2" minlength="6" required></div>' +
      '<button class="btn btn-primer" type="submit">Ubah Password</button>' +
    '</form></div>' +
    '<div class="card"><h3>Info Koneksi</h3>' +
      '<div class="row"><span class="label">Versi aplikasi</span><span>' + esc((ver && ver.version) || '-') + '</span></div>' +
      '<div class="row"><span class="label">Mode database</span><span>' + esc((ver && ver.dbMode) || '-') + '</span></div>' +
      '<div class="row"><span class="label">Spreadsheet</span><span>' + esc((ver && ver.spreadsheet_name) || 'DB Belanja VIP') + '</span></div>' +
      '<div class="row"><span class="label">Status koneksi</span>' +
        (wake.ok ? '<span class="badge b-hijau">Terhubung</span>' : '<span class="badge b-merah">Terputus</span>') + '</div>' +
      (wake.ok ? '' : '<div class="bantuan">' + esc(wake.error || '') + '</div>') +
    '</div>' +
    '<button class="btn btn-merah" id="btnLogout2">Keluar</button>';

  $('#formNama').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#formNama button[type="submit"]');
    btn.disabled = true;
    try {
      const upd = await api('/me', { method: 'PUT', body: JSON.stringify({ nama: $('#p-nama').value.trim() }) });
      $('#topbarUser').textContent = upd.nama || upd.username;
      toast('Nama diperbarui.', 'sukses');
    } catch (err) { toast(err.message, 'gagal'); }
    btn.disabled = false;
  });

  $('#formPass').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('#p-baru').value !== $('#p-baru2').value) { toast('Password baru tidak sama.', 'gagal'); return; }
    if ($('#p-baru').value.length < 6) { toast('Password baru minimal 6 karakter.', 'gagal'); return; }
    const btn = $('#formPass button[type="submit"]');
    btn.disabled = true;
    try {
      await api('/me/password', {
        method: 'PUT',
        body: JSON.stringify({ old_password: $('#p-lama').value, new_password: $('#p-baru').value })
      });
      toast('Password berhasil diubah.', 'sukses');
      $('#formPass').reset();
    } catch (err) { toast(err.message, 'gagal'); }
    btn.disabled = false;
  });

  $('#btnLogout2').addEventListener('click', logout);
}

/* ================= LAINNYA ================= */
async function layarLainnya() {
  const me = await api('/me').catch(() => null);
  if (me) $('#topbarUser').textContent = me.nama || me.username;
  viewEl().innerHTML =
    '<h1 class="judul-halaman">Lainnya</h1>' +
    '<p class="subjudul">' + esc(me ? (me.nama || me.username) : '') + '</p>' +
    '<div class="card klik" onclick="location.hash=\'#/riwayat\'">' +
      '<div class="row"><span><span style="font-size:20px">&#128193;</span> <strong>Riwayat</strong></span><span class="label">&rsaquo;</span></div>' +
      '<div class="label">Arsip kasbon selesai &amp; disetujui</div></div>' +
    '<div class="card klik" onclick="location.hash=\'#/pengaturan\'">' +
      '<div class="row"><span><span style="font-size:20px">&#9881;&#65039;</span> <strong>Pengaturan</strong></span><span class="label">&rsaquo;</span></div>' +
      '<div class="label">Nama, password, info koneksi</div></div>' +
    '<button class="btn btn-merah" id="btnLogout">Keluar</button>';
  $('#btnLogout').addEventListener('click', logout);
}

/* ================= LPJ PUBLIK (tanpa login) ================= */
async function layarSharePublik(params) {
  const token = params[0];
  layarLoading('Memuat LPJ...');
  let data;
  try {
    data = await api('/s/' + encodeURIComponent(token));
  } catch (e) {
    viewEl().innerHTML = '<div class="kosong" style="margin-top:40px"><span class="emoji">&#128279;</span>' +
      '<h1 class="judul-halaman">Tautan tidak valid</h1><p>' + esc(e.message) + '</p></div>';
    return;
  }
  const k = data.kasbon;
  const daftarBelanja = data.belanja || [];
  const setoran = data.setoran || null;
  const rekap = data.rekap || k.rekap;
  const sudah = k.status === 'disetujui';

  const renderSetuju = () => {
    if (k.status === 'disetujui') {
      return '<div class="kotak-info">&#9989; <strong>LPJ ini sudah diperiksa &amp; disetujui</strong> oleh ' +
        esc(k.disetujui_oleh) + ' pada ' + fmtTglWaktu(k.disetujui_at) + '.</div>';
    }
    if (k.status !== 'selesai') {
      return '<div class="kotak-info">LPJ ini belum bisa disetujui — kasbon masih berstatus <strong>' +
        esc(k.status) + '</strong>. Persetujuan dibuka setelah kasbon ditutup.</div>';
    }
    return '<div class="kotak-peringatan">Setelah memeriksa LPJ di atas, tekan tombol di bawah sebagai tanda persetujuan.</div>' +
      '<button class="btn btn-primer" id="btnSetuju">&#9989; Sudah diperiksa &amp; setuju</button>' +
      '<div id="formSetuju" style="display:none" class="card mt"><form id="fSetuju">' +
        '<div class="field"><label for="namaBendahara">Nama bendahara</label>' +
        '<input type="text" id="namaBendahara" placeholder="cth: Budi" required></div>' +
        '<button class="btn btn-primer" type="submit">Kirim Persetujuan</button>' +
      '</form></div>';
  };

  viewEl().innerHTML =
    '<div class="tengah mb" style="margin-top:8px"><div style="font-size:40px">&#128176;</div>' +
    '<h1 class="judul-halaman">LPJ Belanja VIP</h1>' +
    '<p class="subjudul">Tautan berbagi untuk bendahara</p></div>' +
    '<div class="card">' + lpjDocHTML(k, daftarBelanja, setoran, rekap) + '</div>' +
    '<div id="boxSetuju">' + renderSetuju() + '</div>';

  const btn = $('#btnSetuju');
  if (btn) {
    btn.addEventListener('click', () => { $('#formSetuju').style.display = 'block'; btn.style.display = 'none'; });
    $('#fSetuju').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nama = $('#namaBendahara').value.trim();
      if (!nama) { toast('Isi nama bendahara dulu.', 'gagal'); return; }
      const b = $('#fSetuju button[type="submit"]');
      b.disabled = true; b.textContent = 'Mengirim...';
      try {
        const hasil = await api('/s/' + encodeURIComponent(token) + '/setujui', {
          method: 'POST', body: JSON.stringify({ nama: nama })
        });
        k.status = 'disetujui';
        k.disetujui_oleh = hasil.disetujui_oleh;
        k.disetujui_at = hasil.disetujui_at;
        $('#boxSetuju').innerHTML = renderSetuju();
        toast('Terima kasih! LPJ disetujui.', 'sukses');
      } catch (err) {
        toast(err.message, 'gagal');
        b.disabled = false; b.textContent = 'Kirim Persetujuan';
      }
    });
  }
}

/* ---------------- init ---------------- */
document.addEventListener('DOMContentLoaded', render);
