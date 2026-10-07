# Belanja VIP

Aplikasi catatan **kasbon** & **LPJ belanja sparepart** — mencatat uang kasbon dari
bendahara (tunai/transfer), setiap belanja offline lengkap dengan foto nota,
menghitung selisih otomatis real-time, mencatat setoran sisa, dan menghasilkan
LPJ siap serah yang bisa langsung **disetujui bendahara lewat tautan**.

**Database: Google Sheets + Google Drive** (milik akun Google sendiri).
Tanpa database berbayar.

## Fitur utama

- **Dashboard** — ringkasan kasbon aktif: diterima, terpakai, sisa/nombok (badge warna);
  peringatan dini **Hampir habis** (terpakai ≥ 90%) dan **NOMBOK** (> 100%).
- **Kasbon** — buat (tunai/transfer; transfer wajib foto bukti), edit selama aktif,
  hapus hanya jika belum ada belanja.
- **Belanja** — terikat ke kasbon aktif; item barang + biaya lain (ongkos/parkir);
  **wajib ≥ 1 foto nota**; total selalu dihitung server.
- **Tutup kasbon + setoran** — wajib catat setoran sisa (boleh 0) saat menutup;
  setoran bisa diedit selama status `selesai`.
- **Rekonsiliasi otomatis** — `terpakai = SUM(total belanja)`, `sisa = diterima − terpakai`;
  status AMAN / HAMPIR HABIS / NOMBOK, selalu dihitung dari data.
- **LPJ** — export Excel (.xlsx) + tampilan cetak; **tautan berbagi bertoken**
  untuk bendahara (tanpa login) + tombol *"Sudah diperiksa & setuju"* (isi nama).
  LPJ yang disetujui **dikunci permanen**.
- **Rekap bulanan** — total belanja per bulan, top 5 toko, rata-rata per kasbon.
- **Pencarian** — berdasar nama barang / nama toko, filter tanggal & kasbon.
- **Pengaturan** — ganti password & nama tampilan.

## Prasyarat

- Node.js ≥ 18
- Akun Google (untuk Google Cloud Console, Sheets, Drive)

## Langkah setup Google Cloud (±10 menit, sekali saja)

1. Buat project di [Google Cloud Console](https://console.cloud.google.com/) →
   aktifkan **Google Sheets API** + **Google Drive API**.
2. Buat **Service Account** → unduh file JSON key-nya.
3. Buat spreadsheet bernama **`DB Belanja VIP`** → Share ke email service account
   sebagai **Editor**.
4. Buat folder Drive bernama **`Belanja VIP`** → Share ke email service account
   sebagai **Editor**.
5. Siapkan nilai-nilai ini sebagai environment variable (lihat tabel di bawah):
   isi JSON key, ID spreadsheet, dan ID folder Drive.

> ID spreadsheet = bagian di antara `/d/` dan `/edit` pada URL spreadsheet.
> ID folder = bagian setelah `/folders/` pada URL folder Drive.

## Environment variables

| Nama | Wajib | Contoh / Keterangan |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Ya (production) | Isi file JSON key service account (inline, satu baris) |
| `SPREADSHEET_ID` | Ya (production) | `<ISI_ID_SPREADSHEET>` |
| `BLOB_READ_WRITE_TOKEN` | Ya (production) | `<TOKEN_BLOB_VERCEL>` |
| `JWT_SECRET` | Ya (production) | String acak panjang, mis. `<ISI_SECRET_ACAK_MIN_32_KARAKTER>` |
| `ADMIN_PASSWORD` | Tidak | Password awal akun `admin`. **Default: `belanjavip123` — WAJIB diganti!** |
| `ADMIN_USERNAME` | Tidak | Username akun seed. Default: `admin` |
| `SPREADSHEET_NAME` | Tidak | Nama spreadsheet untuk info koneksi. Default: `DB Belanja VIP` |
| `PORT` | Tidak | Default: `3000` |
| `TEST_MODE` | Tidak | Set `1` untuk memakai database & Drive **fake in-memory** (dipakai `npm test`; tanpa kredensial Google) |

## Cara jalan lokal

```bash
cd app
npm install

# 1) Mode test (tanpa Google, hermetik):
npm test
# -> TEST_MODE=1 node --test test/

# 2) Mode production lokal (butuh env Google):
export GOOGLE_SERVICE_ACCOUNT_JSON='<ISI_JSON_KEY>'
export SPREADSHEET_ID='<ISI_ID_SPREADSHEET>'
export BLOB_READ_WRITE_TOKEN='<ISI_NAMA_BUCKET_FIREBASE>'
export JWT_SECRET='<ISI_SECRET_ACAK_MIN_32_KARAKTER>'
export ADMIN_PASSWORD='<GANTI_DENGAN_PASSWORD_KUAT>'
npm start
# -> buka http://localhost:3000
```

Login pertama memakai username `admin` + `ADMIN_PASSWORD`.

## Cara deploy ke Vercel

```bash
# dari direktori app/
npx -y vercel@latest deploy --prod --yes
```

Lalu di dashboard Vercel (Settings → Environment Variables, Production) isi:

- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `SPREADSHEET_ID`
- `BLOB_READ_WRITE_TOKEN`
- `JWT_SECRET`
- `ADMIN_PASSWORD` ← **ganti dari default!**

Region fungsi disarankan `sin1` (dekat database Google Asia Tenggara).
Setelah deploy, verifikasi:

```bash
curl https://<DOMAIN_ANDA>/api/version
# -> {"version":"1.0.0","dbMode":"sheets"}

curl https://<DOMAIN_ANDA>/api/wake
# -> {"ok":true}   (503 jika env Google belum lengkap)
```

## ⚠️ Peringatan keamanan

- **Ganti `ADMIN_PASSWORD`** dari default `belanjavip123` segera setelah deploy —
  lalu ganti lagi dari menu Pengaturan di aplikasi.
- Jangan pernah commit file JSON key service account / token ke Git.
  Semua kredensial hanya lewat environment variable.
- JWT berlaku 7 hari; logout cukup dengan membuang token di sisi client.

## Cara pakai singkat

1. **Login** sebagai admin.
2. **Kasbon → Baru**: isi tanggal, jumlah, keperluan, nama bendahara,
   metode (Tunai/Transfer). Jika Transfer → upload foto bukti transfer.
3. **Belanja → Catat**: pilih kasbon aktif, isi toko & tanggal,
   tambah item (nama, qty, satuan, harga) + biaya lain (ongkos/parkir),
   **foto nota** (kamera/galeri, boleh > 1). Total dihitung otomatis.
4. Pantau **Dashboard**: badge AMAN (hijau) / HAMPIR HABIS (kuning, ≥ 90%) /
   NOMBOK (merah).
5. **Tutup kasbon**: catat **setoran sisa** (jumlah boleh 0; transfer wajib bukti).
6. **LPJ**: pratinjau → unduh Excel / cetak → **Bagikan** → kirim tautan
   `/s/<token>` via WhatsApp ke bendahara.
7. **Bendahara** membuka tautan (tanpa login) → periksa → klik
   *"Sudah diperiksa & setuju"* → isi nama → kasbon berstatus `disetujui`
   dan **terkunci permanen**.

## Struktur proyek

```
app/
├── server.js            # entrypoint Express (milik spesialis backend)
├── routes/              # endpoint API (milik spesialis backend)
├── utils/
│   ├── sheetsDb.js      # akses Google Sheets (+ fake in-memory saat TEST_MODE=1)
│   └── driveStore.js    # upload Drive (+ fake in-memory saat TEST_MODE=1)
├── public/              # frontend PWA (milik spesialis frontend)
├── test/                # test otomatis (node:test + supertest) — milik QA
│   ├── _helper.js
│   └── 01-auth.test.js … 09-drive.test.js
├── package.json
└── README.md            # file ini
```

## Test

`npm test` selalu berjalan dengan `TEST_MODE=1`: seluruh Sheets & Drive
diganti fake in-memory ber-interface identik — hermetik, tanpa kredensial,
tanpa jaringan ke Google. Cakupan: auth, kasbon, belanja, rekonsiliasi,
tutup+setoran, share+persetujuan, LPJ xlsx, rekap bulanan & pencarian,
dan Drive fake.

Kontrak bentuk request/response yang diuji: [`CONTRACT.md`](CONTRACT.md).
Sumber kebenaran fitur: [`../SPESIFIKASI.md`](../SPESIFIKASI.md).
