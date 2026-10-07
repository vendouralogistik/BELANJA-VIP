# KONTRAK API — Belanja VIP
Sumber kebenaran fitur: `~/workspace/belanja-vip/SPESIFIKASI.md`. Dokumen ini mengunci
bentuk request/response agar backend, frontend, dan test selaras.

## Konvensi umum
- Basis: `/api`. JSON. Tanggal: string `YYYY-MM-DD`. Uang: number (Rupiah, tanpa desimal).
- ID: UUID string (kolom A setiap tab Sheet).
- Error: `{ "error": "pesan" }` + status: 400 validasi, 401 auth, 404 tidak ada, 409 konflik aturan bisnis, 503 database belum dikonfigurasi.
- Auth: header `Authorization: Bearer <JWT>`. Wajib di semua `/api/*` KECUALI:
  `POST /api/login`, `POST /api/logout` (stateless no-op), `GET /api/s/:token`, `POST /api/s/:token/setujui`, `GET /api/version`, `GET /api/wake`.
- Foto dari client: `{ data: "<base64 tanpa prefix>", mime: "image/jpeg" }`.
- URL tampil foto: `https://storage.googleapis.com/<BUCKET>/<FILE_ID>` (dibangun server → field `*_url`).

## Auth
- `POST /api/login` `{username, password}` → `200 { token, user:{id, username, nama} }` / `401 {error}`
- `POST /api/logout` → `{ok:true}` (stateless; client buang token)
- `GET /api/me` → `{id, username, nama}`
- `PUT /api/me` `{nama}` → user terupdate
- `PUT /api/me/password` `{old_password, new_password}` → `{ok:true}` (new_password min 6)

## Kasbon
Objek kasbon (GET):
```json
{
  "id": "uuid", "tanggal": "2026-10-07", "jumlah": 1000000,
  "keperluan": "Belanja sparepart Exca 17", "pemberi": "Bendahara",
  "metode": "tunai|transfer", "bukti_transfer_drive_id": null,
  "bukti_transfer_url": null, "catatan": "",
  "status": "aktif|selesai|disetujui",
  "disetujui_oleh": null, "disetujui_at": null,
  "created_at": "iso", "closed_at": null,
  "setoran_jumlah": 250000,
  "rekap": { "diterima": 1000000, "terpakai": 250000, "sisa": 750000,
             "persen_terpakai": 25, "status": "AMAN|HAMPIR HABIS|NOMBOK" }
}
```
- `GET /api/kasbon?status=aktif|selesai|disetujui` → `{ kasbon: [ ... ] }` (tiap item bawa `rekap`)
- `POST /api/kasbon` body `{tanggal, jumlah, keperluan, pemberi, metode, catatan?, bukti_transfer?}`
  Validasi: jumlah > 0; metode ∈ {tunai, transfer}; **metode=transfer wajib `bukti_transfer`**.
  → `201 { kasbon }` (kasbon sudah termasuk `rekap` awal bernilai nol).
- `GET /api/kasbon/:id` → `{ kasbon, belanja: [...], setoran: {...}|null }`
- `PUT /api/kasbon/:id` — hanya jika status `aktif`. → kasbon terupdate.
- `DELETE /api/kasbon/:id` — hanya jika `aktif` DAN belum ada belanja → `{ok:true}`, else 409.
- `POST /api/kasbon/:id/tutup` body `{ setoran: { tanggal, jumlah, metode, catatan?, bukti_transfer? } }`
  Validasi: status `aktif`; setoran.jumlah ≥ 0; metode transfer wajib bukti. → kasbon status `selesai`, `closed_at` terisi.
- `GET /api/kasbon/:id/rekap` → `{ diterima, terpakai, sisa, persen_terpakai, status }`

Aturan status rekap: `sisa < 0` → NOMBOK; else `persen_terpakai >= 90` → HAMPIR HABIS; else AMAN.

## Belanja
Objek belanja (GET):
```json
{
  "id": "uuid", "kasbon_id": "uuid", "tanggal": "2026-10-07",
  "toko": "Toko Jaya", "catatan": "", "created_at": "iso",
  "items": [{ "id":"uuid", "nama_barang":"Filter oli", "qty":2, "satuan":"pcs",
              "harga_satuan":75000, "subtotal":150000 }],
  "biaya_lain": [{ "id":"uuid", "jenis":"ongkos|parkir|lainnya", "jumlah":20000, "keterangan":"" }],
  "fotos": [{ "id":"uuid", "drive_file_id":"abc", "url":"https://..." }],
  "total_item": 150000, "total_biaya": 20000, "total": 170000
}
```
- `GET /api/belanja?kasbon_id=&q=&from=&to=` → `{ belanja: [...] }` (q cocok ke nama barang/toko)
- `POST /api/belanja` body `{ kasbon_id, tanggal, toko, catatan?, items:[...], biaya_lain?:[...], fotos:[...] }`
  Validasi: kasbon ada & `aktif`; `items` ≥ 1 ATAU `biaya_lain` ≥ 1; tiap item qty>0 & harga_satuan ≥ 0;
  tiap biaya jumlah > 0; **`fotos` ≥ 1**; total hitung server. → `201` belanja lengkap.
- `GET /api/belanja/:id` → belanja lengkap.
- `PUT /api/belanja/:id` — hanya jika kasbon `aktif`. Body sama seperti POST (ganti total: items/biaya/foto).
  Foto: kirim `fotos` = daftar final; `{id}` = foto lama yang dipertahankan (id baris nota_foto),
  `{data, mime}` = foto baru yang diupload; foto lama yang tidak dikirim akan dihapus (termasuk file Drive-nya).
- `DELETE /api/belanja/:id` — hanya jika kasbon `aktif` → `{ok:true}` (hapus item/biaya/foto terkait).

## Setoran
- `PUT /api/setoran/:id` `{tanggal?, jumlah?, metode?, catatan?, bukti_transfer?}` — hanya jika kasbon `selesai` (belum disetujui).

## LPJ / berbagi / persetujuan (publik, tanpa auth utk GET & setujui)
- `GET /api/kasbon/:id/lpj.xlsx` → file `.xlsx` (auth). Sheet: Info, Belanja (+item & biaya), Setoran, Rekap.
- `POST /api/kasbon/:id/share` → `200 { url: "/s/<token>" }` (satu kasbon = satu token; panggil ulang → token sama).
- `GET /api/s/:token` → `{ kasbon, belanja, setoran, rekap }` (tanpa auth; 404 jika token salah).
- `POST /api/s/:token/setujui` `{nama}` → `{ok:true, disetujui_oleh, disetujui_at}`.
  Validasi: nama tidak kosong; kasbon status `selesai` (belum disetujui) → jadi `disetujui`. Else 409.

## Rekap & lain-lain
- `GET /api/rekap-bulanan?bulan=YYYY-MM` → `{ bulan, total_belanja, jumlah_transaksi, rata_per_kasbon, top_toko:[{toko,total}] }` (top 5)
- `GET /api/version` → `{ version:"1.0.0", dbMode:"sheets|test" }`
- `GET /api/wake` → `{ ok:true }` / `503 {ok:false, error}` jika env Google belum lengkap.

## TEST_MODE
`TEST_MODE=1` → `utils/sheetsDb.js` & `utils/driveStore.js` memakai fake in-memory dengan
interface IDENTIK (async). `npm test` selalu jalan dengan TEST_MODE=1. Tidak ada kredensial.

## Env
`GOOGLE_SERVICE_ACCOUNT_JSON` (isi JSON inline), `SPREADSHEET_ID`, `DRIVE_FOLDER_ID`,
`JWT_SECRET` (wajib di production), `ADMIN_PASSWORD` (default `belanjavip123` — README wajibkan ganti),
`SPREADSHEET_NAME` (opsional, default "DB Belanja VIP" — tampil di Pengaturan),
`PORT` (default 3000).
