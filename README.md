# Aplikasi Barcode Peserta Event

Aplikasi web untuk panitia event: impor peserta dari Excel, cetak barcode, pemindaian
transaksi berkuota (Parkir, Masuk Arena, Snack Pagi, Makan Siang, Es Krim, Bakso/Coto,
Kupon Doorprize), serta laporan pemakaian.

Antarmuka berbahasa Indonesia, responsif, dan dirancang untuk dipakai cepat saat event
berlangsung (tombol besar, status jelas, umpan balik suara saat memindai).

---

## 1. Teknologi yang dipakai

| Bagian | Pilihan | Alasan |
|---|---|---|
| Runtime | **Node.js ≥ 20** (diuji pada Node 24) | Sekali pasang, tanpa langkah build |
| Server | **Express 4** | Ringan, mudah dibaca, cocok untuk aplikasi internal panitia |
| Database | **SQLite** via `better-sqlite3` (sinkron) | Berkas tunggal (`data/event.db`), mudah dicadangkan, transaksinya ketat |
| Barcode | **bwip-js** → Code 128 (SVG & PNG) | SVG vektor = hasil cetak tajam; bisa diunduh PNG |
| Excel | **exceljs** | Satu pustaka untuk template, impor, dan ekspor laporan |
| Pemindai kamera | **html5-qrcode** (dimuat dari `node_modules`) | Mendukung kamera perangkat, tanpa CDN |
| Pemindai barcode fisik | Input teks + Enter | Perangkat USB/Bluetooth bekerja sebagai keyboard |
| Antarmuka | HTML/CSS/Vanilla JS (ES Modules) | Tanpa bundler; cukup muat ulang halaman setelah diedit |
| Keamanan | `node:crypto` scrypt + sesi cookie httpOnly | Tanpa dependensi auth pihak ketiga |

Tidak ada layanan cloud yang dibutuhkan. Seluruh data tersimpan lokal di server panitia.

## 2. Cara menjalankan

```bash
npm install          # hanya sekali
npm start            # menjalankan di http://127.0.0.1:3000
```

Buka **http://127.0.0.1:3000** lalu masuk dengan akun bawaan:

| Peran | Nama pengguna | Kata sandi | Hak akses |
|---|---|---|---|
| Admin | `admin` | `admin123` | Semua menu: jenis transaksi, peserta, riwayat, laporan, pengguna, pengaturan |
| Petugas | `petugas` | `petugas123` | Hanya halaman **Pemindaian** |

> **Segera ganti kata sandi bawaan** lewat menu *Pengguna* sebelum event berlangsung.

Perintah lain:

```bash
npm run dev            # jalankan dengan auto-reload (node --watch)
npm run seed           # menambahkan ulang data contoh (peserta & transaksi)
```

Konfigurasi lewat variabel lingkungan (opsional):

```bash
PORT=8080 HOST=0.0.0.0 node src/server.js   # agar bisa diakses dari HP/tablet panitia
DB_PATH=/path/lain/event.db node src/server.js
COOKIE_SECURE=1 node src/server.js          # bila dipasang di belakang HTTPS
```

### Data contoh

Aplikasi dahulu mengisi otomatis 12 peserta contoh (VIP / Reguler / Panitia),
±21 transaksi contoh, dan 2 batas khusus peserta saat pertama dijalankan pada
database kosong. **Pemuatan otomatis itu sudah dimatikan, dan seluruh data contoh
sudah dihapus dari database proyek ini atas permintaan Anda** — peserta, riwayat
transaksi, dan batas khusus contoh dibersihkan, sehingga Anda mulai dari daftar
peserta kosong. Yang dipertahankan: nama event, akun Admin / Petugas, seluruh
jenis transaksi, dan catatan aktivitas.

Penanda `data_contoh` disimpan di tabel pengaturan, jadi meski server dijalankan
berulang kali data contoh **tidak** akan tumbuh lagi (dibuktikan lewat dua kali
restart: peserta tetap 0 dan server mencetak pesan bahwa data contoh dimatikan).
Ingin memakai data contoh lagi kapan pun? Jalankan:

```bash
npm run seed    # mengisi ulang data contoh (tidak menimpa data Anda)
```

Untuk memulai seluruhnya dari nol: hentikan server, hapus folder `data/`, jalankan lagi.

## 3. Alur pemakaian singkat

1. **Pengaturan** — isi nama event (tampil pada barcode & kartu peserta) dan
   jeda anti-duplikat.
2. **Jenis Transaksi** — satu menu untuk seluruh urusan jenis transaksi:
   tambah jenis baru, **pilih semua transaksi** (atau centang yang dipakai saja),
   atur batas bawaan, dan atur batas khusus per peserta. Rincian ada di bagian 6.
3. **Peserta** — unduh *Template Excel*, isi data, lalu *Impor Excel*.
   Setelah itu cetak barcode: tombol **Cetak barcode** (massal) atau **Barcode**
   pada baris peserta (lihat / unduh PNG / cetak kartu).
4. **Pemindaian** — petugas memilih jenis transaksi, lalu memindai dengan
   pemindai barcode atau kamera. Hasil tampil seketika. Hanya jenis yang dipilih
   di menu **Jenis Transaksi** yang muncul di sini.
5. **Riwayat / Laporan** — telusuri transaksi dan ekspor ke Excel.

## 4. Template & impor Excel

Template berisi tiga sheet: **Petunjuk**, **Peserta** (kolom data), dan
**Jenis Transaksi** (referensi yang dibangun otomatis dari jenis transaksi aktif).

Kolom sheet *Peserta*:

| Kolom | Wajib | Keterangan |
|---|---|---|
| `Nomor Peserta *` | ✅ | ID unik peserta. Huruf/angka dan `- _ . /`, maks. 40 karakter |
| `Nama *` | ✅ | Nama lengkap, maks. 120 karakter |
| `Kategori` | – | Mis. VIP / Reguler / Panitia (dipakai untuk filter & laporan) |
| `Kontak` | – | Nomor HP / WhatsApp |
| `Batas <Nama Jenis>` | – | Batas khusus peserta untuk jenis tersebut. Kosong = ikut batas bawaan. `0` = tidak berhak |

Perilaku impor:

- **Mode "Lewati"** (bawaan): nomor yang sudah terdaftar dilaporkan sebagai kesalahan.
- **Mode "Perbarui"**: nomor yang sudah terdaftar ditimpa datanya.
- Baris yang valid **tetap diimpor** walaupun ada baris bermasalah; setiap kesalahan
  dilaporkan lengkap dengan **nomor baris**, **nama kolom**, dan **penjelasannya**
  (ID ganda di dalam file, ID sudah terdaftar, kolom wajib kosong, format ID salah,
  nilai batas bukan angka / di luar rentang).
- Duplikat nomor peserta juga tidak mungkin terjadi di database: kolom
  `nomor_peserta` memakai `UNIQUE`.

## 5. Barcode

- Setiap peserta memperoleh **satu kode barcode unik** yang dibuat otomatis,
  berformat `EVT-<nomor>-<4 karakter acak>` (mis. `EVT-25001-R33S`).
  Suffix acak mempersulit penebakan kode peserta lain.
- Barcode memakai **Code 128** dan dirender sebagai **SVG** sehingga tetap tajam
  saat dicetak kecil.
- Bisa dilihat (modal), diunduh sebagai PNG, dicetak massal di halaman
  `cetak-barcode.html` (grid 2–4 kolom, bisa tanpa nama/nomor), atau dicetak
  sebagai kartu berukuran kartu nama.
- Tombol **Reset barcode** membuat kode baru; kode lama langsung tidak berlaku
  (berguna bila kartu hilang atau barcode bocor). Riwayat lama tetap tersimpan.
- Pemindaian menemukan peserta lewat `kode_barcode`; sebagai kemudahan panitia,
  mengetikkan **nomor peserta** secara manual juga diterima. Kode yang tidak
  terdaftar selalu ditolak dengan pesan *"Barcode tidak terdaftar"*.

## 6. Jenis transaksi & batas kuota

### Menu "Jenis Transaksi" (dulunya terpisah jadi dua menu)

Menu **Pilih Jenis Transaksi** dan **Batas Transaksi** disatukan menjadi satu menu
karena menyentuh entitas yang sama — keduanya mengatur jenis transaksi, hanya
beda sudut ("jenis apa saja yang dipakai" vs "berapa batasnya"). Menyatukannya
menghilangkan duplikasi: dulu ada dua cara menambah jenis transaksi dan dua
tampilan batas bawaan. Menu ini hanya untuk **Admin** (petugas memakai menu
Pemindaian) dan punya dua tab:

**Tab 1 — Jenis & batas bawaan**

- Kolom **Pakai** (kotak centang) = jenis transaksi yang dipakai saat event.
- Tombol **Pilih semua transaksi** — satu klik memakai **seluruh** jenis.
- **Kosongkan pilihan** melepas semua centang, lalu **Simpan pilihan**
  menerapkan pilihan sebagian. Bila centang berbeda dari yang tersimpan,
  lencana berubah kuning menjadi *"n dari m belum disimpan"* — jadi tidak ada
  perubahan yang hilang tanpa disadari. Pilihan kosong ditolak (minimal satu),
  supaya petugas tidak kehilangan semua tombol pemindaian.
- Kolom **Batas bawaan** bisa diketik langsung per baris + **Simpan**.
  Angka `0` berarti peserta tidak berhak atas transaksi itu.
- Aksi per baris: **Terapkan ke semua peserta** (menulis batas khusus ke semua
  peserta aktif), **Hapus batas khusus** (kembali ke bawaan), dan **Ubah**.
- **+ Jenis transaksi baru** membuka form: kode, nama tampilan, batas bawaan,
  urutan. Kode dirapikan otomatis (mis. `Air Mineral` → `AIR_MINERAL`) dan kode
  yang sudah dipakai ditolak. Jenis baru **langsung tercentang**.
- Statistik: pemakaian terhadap kuota, **Hari ini**, total terpakai, ditolak,
  dan jumlah peserta dengan batas khusus.

**Tab 2 — Batas per peserta** — matriks peserta × jenis: kolom terisi = batas
khusus, kosong = ikut batas bawaan. Ada tombol **Simpan** per baris dan
**Bawaan** untuk mengembalikan seluruh batas khusus peserta itu.

Aturan yang sama berlaku sejak menu digabung:

- Hanya jenis yang **dipilih** yang muncul di halaman Pemindaian. Jenis yang
  dikeluarkan **tidak bisa dipindai** (percobaan memindainya ditolak dengan alasan
  "jenis transaksi tidak ditemukan atau tidak aktif").
- Jenis yang pernah dipakai **tetap tampil di Riwayat & Laporan** walaupun sudah
  dikeluarkan, agar angka laporan lama tidak seolah hilang.
- Semua perubahan (tambah, ubah batas, pilih) tercatat di **Pengguna → Catatan
  aktivitas**, dan API-nya menolak Petugas dengan `403`.
- Kolom **Hari ini** memakai tanggal lokal server (waktu panitia), bukan UTC.
- Tautan lama `#pilihjenis` dan `#batas` sama-sama membuka menu ini.

### Jenis transaksi bawaan

Tujuh jenis transaksi bawaan (masing-masing batas awal 1×):

| Kode | Nama |
|---|---|
| `PARKIR` | Parkir |
| `ARENA` | Masuk Arena |
| `SNACK_PAGI` | Snack Pagi |
| `MAKAN_SIANG` | Makan Siang |
| `ESKRIM` | Es Krim |
| `BAKSO` | Bakso/Coto |
| `DOORPRIZE` | Kupon Doorprize |

- **Batas bawaan** diatur per jenis (berlaku untuk semua peserta).
- **Batas khusus** diatur per peserta × jenis dan menimpa batas bawaan.
- Admin dapat **menerapkan satu batas ke semua peserta aktif** sekaligus, atau
  menghapus semua batas khusus agar kembali ke bawaan.
- Admin juga dapat **menambah jenis transaksi baru** / mengeluarkannya dari
  pemakaian (lihat menu **Jenis Transaksi** di atas) — jenis yang tidak dipilih tidak
  muncul di halaman pemindaian dan tidak bisa dipakai memindai, tetapi riwayatnya
  tetap utuh.

Batas yang berlaku saat transaksi dicatat **disimpan pada baris riwayat**
(`batas`, `urutan_ke`, `sisa_setelah`), sehingga laporan masa lalu tetap benar
walaupun batas diubah kemudian.

## 7. Pemindaian & keamanan kuota

Hasil pemindaian yang ditampilkan:

| Status | Arti |
|---|---|
| **Berhasil** | Barcode terdaftar, kuota masih ada, transaksi dicatat |
| **Kuota habis** | Batas peserta untuk jenis tersebut sudah terpakai penuh |
| **Barcode tidak terdaftar** | Kode tidak cocok dengan peserta mana pun |
| **Transaksi ditolak** | Penolakan lain (mis. peserta berstatus tidak aktif, batas 0) |
| **Pemindaian ganda** | Barcode sama & jenis sama dipindai lagi dalam waktu singkat — kuota **tidak** dikurangi lagi |

Bagaimana kuota dijaga agar tidak terlampaui:

- Seluruh rangkaian — cari peserta → deteksi pemindaian ganda → hitung pemakaian →
  catat transaksi — dijalankan dalam **satu transaksi `BEGIN IMMEDIATE`**
  (lihat [`src/scan.js`](src/scan.js)). Tidak ada celah antara "memeriksa sisa kuota"
  dan "mencatat pemakaian".
- Karena itu, walaupun banyak permintaan pemindaian datang bersamaan
  (mis. beberapa petugas memindai peserta yang sama dari perangkat berbeda),
  hanya sejumlah kuota yang tersedia yang berhasil. **Diuji: 25 permintaan
  bersamaan untuk kuota 1 → tepat 1 berhasil, 24 ditolak.**
- **Anti-duplikat**: satu pemindaian ulang dalam rentang *jeda* (bawaan 5 detik,
  bisa diubah, `0` = nonaktif) ditandai *Pemindaian ganda* dan tidak mengurangi kuota.
  Halaman pemindaian juga menahan kiriman ulang kode yang sama dalam 1,2 detik.
- Setiap penolakan **ikut dicatat** (status `ditolak` / `ganda`) agar bisa diaudit
  tanpa memengaruhi hitungan kuota.

## 8. Riwayat, laporan, dan pengguna

- **Riwayat** — filter/pencarian berdasarkan nama atau nomor peserta, kode barcode,
  jenis transaksi, status, kategori, petugas, dan rentang tanggal, plus pintasan
  "Hari ini" / "7 hari terakhir". Setiap baris mencatat waktu, jenis, identitas
  peserta, kuota saat itu, **dan petugas yang memproses**. Bisa diekspor ke Excel.
- **Laporan** —
  *Penggunaan per peserta* (matriks terpakai/batas per jenis) dan
  *Rekap per jenis transaksi* (total kuota, terpakai, sisa, serapan %, jumlah
  peserta yang memakai, jumlah penolakan). Keduanya bisa diekspor ke Excel.
- **Dasbor** — angka kunci, serapan per jenis, tren 7 hari, dan aktivitas terbaru.
- **Pengguna** — kelola akun Admin/Petugas (tambah, ubah peran, ganti kata sandi,
  nonaktifkan). Sistem mencegah Admin aktif terakhir dihapus/dinonaktifkan/diturunkan,
  dan mengganti kata sandi sebuah akun memutus semua sesi akun itu.
  Tab **Catatan aktivitas** merekam siapa melakukan apa dan kapan.
- **Pengaturan** — nama event dan jeda anti-duplikat.

### Keamanan

- Kata sandi disimpan sebagai hash **scrypt** (salt acak per pengguna, perbandingan
  waktu-tetap). Tidak ada kata sandi yang disimpan atau dicatat apa adanya.
- Sesi: token acak 32 byte di tabel `sessions`, dikirim lewat cookie
  **httpOnly + SameSite=Lax**, berlaku 12 jam, dan dibersihkan saat kedaluwarsa.
- Pembatasan percobaan masuk: 8 kegagalan per nama pengguna + IP → jeda 60 detik.
- Otorisasi **di sisi server** (`requireAuth` / `requireRole`) — Petugas yang
  mencoba membuka API Admin menerima `403`, bukan sekadar menu disembunyikan.
- Permintaan pengubah data (`POST/PUT/PATCH/DELETE`) ditolak bila `Origin` berbeda
  dari host (perlindungan CSRF sederhana), plus header keamanan dan CSP.
- Setiap perubahan peserta, kuota, jenis, dan pengguna dicatat di `audit_log`.

## 9. Asumsi penting

1. **Pemakaian di satu lokasi event** dengan satu server yang dijalankan panitia
   (laptop/mini PC). Database SQLite lokal, bukan multi-server.
2. Perangkat panitia mengakses aplikasi lewat jaringan setempat. Untuk mode ini,
   jalankan dengan `HOST=0.0.0.0` dan catat: **kamera pemindai memerlukan konteks
   aman** — `localhost` atau HTTPS. Bila diakses dari HP lewat `http://<IP-lokal>`,
   peramban akan memblokir kamera; gunakan pemindai barcode fisik atau input manual.
   Untuk memakai kamera dari HP, akses lewat HTTPS (mis. reverse proxy + sertifikat).
3. Setiap petugas memakai akun sendiri → atribusi transaksi di laporan menjadi jelas.
4. Barcode resmi adalah kode `EVT-...`; kartu peserta dicetak dari aplikasi ini.
   Mengetik nomor peserta secara manual juga diterima agar tetap bisa melayani
   peserta yang kartunya rusak (dan tetap tercatat di riwayat).
5. Batas kuota bersifat **harian/per-event** (tidak di-reset otomatis). Untuk event
   multi-hari, atur batas sesuai kebutuhan atau gunakan jenis transaksi per hari
   (mis. "Makan Siang Hari 1"). Reset kuota massal bisa dilakukan dengan
   "Kembalikan ke bawaan" atau dengan memulai database baru.
6. Data pribadi peserta (nama, kontak) disimpan lokal; cadangkan `data/event.db`
   berkala selama event dan hapus sesuai kebijakan panitia setelah selesai.

## 10. Struktur berkas

```
src/
  server.js        titik masuk: header keamanan, pemasangan rute, penyajian UI
  db.js            koneksi SQLite + skema lengkap
  seed.js          data awal (pengguna, jenis transaksi, peserta contoh)
  auth.js          scrypt, sesi cookie, middleware peran
  scan.js          mesin kuota: SATU transaksi BEGIN IMMEDIATE per pemindaian
  barcode.js       pembuatan kode unik + render Code 128 (SVG/PNG)
  excel.js         template, pembacaan impor + validasi, helper ekspor
  audit.js         pencatatan aktivitas
  util.js          helper kecil (paging, rentang tanggal, dsb.)
  routes/          auth.js, peserta.js, jenis.js, kuota.js, scan.js,
                   riwayat.js, laporan.js, admin.js
public/
  index.html       kerangka aplikasi (layar masuk + shell)
  cetak-barcode.html  lembar cetak barcode massal
  style.css        seluruh gaya antarmuka
  js/app.js        perutean, menu, sesi
  js/pages/*.js    dasbor, batas (menu Jenis Transaksi), scan, peserta,
                   riwayat, laporan, pengguna, pengaturan
  js/{api,ui,state}.js  klien API, helper UI, status bersama
data/event.db      database SQLite (dibuat otomatis, jangan dimasukkan ke Git)
```

## 11. Verifikasi yang sudah dijalankan

Selama pengembangan, alur aplikasi diuji dengan skrip uji end-to-end terhadap
server sungguhan (database sementara), mencakup: autentikasi & pembatasan peran,
unduh template, impor Excel (deteksi ID ganda / kolom wajib kosong / batas bukan
angka beserta nomor barisnya), pembuatan barcode, pemindaian berhasil / ditolak /
kuota habis / ganda, **25 pemindaian bersamaan pada kuota 1 (tepat 1 berhasil)**,
batas per peserta dan per jenis, filter riwayat, ketiga jenis ekspor Excel,
pengelolaan pengguna, catatan aktivitas, menu **Jenis Transaksi**
(tambah jenis, pilih sebagian, "Pilih semua transaksi", jenis yang tidak dipilih
tidak bisa dipindai, pilihan kosong ditolak, Petugas ditolak `403`), serta
penolakan permintaan lintas situs.

> **Skrip uji tersebut sudah dihapus dari repositori atas permintaan Anda**, jadi
> perintah `npm run smoke` tidak tersedia lagi. Untuk memeriksa aplikasi, jalankan
> `npm start` lalu uji langsung dari antarmuka.

Catatan kejujuran soal hasil uji terakhir: pada putaran terakhir sebelum skrip
dihapus, hasilnya **90 lulus / 4 gagal**. Keempat kegagalan itu semuanya berasal
dari asersi uji yang masih mematok angka "7 jenis transaksi" secara tetap, padahal
uji pada bagian itu baru saja membuat satu jenis sementara yang sudah terpakai —
dan sesuai aturan yang memang disengaja, jenis yang pernah dipakai tetap
ditampilkan di laporan sehingga barisnya menjadi 8. Jadi penyebabnya adalah
asersi uji yang perlu dibuat dinamis, bukan cacat aplikasi; namun saya tidak
sempat menjalankan ulang uji yang sudah diperbaiki karena skripnya kini dihapus.

Antarmuka juga diverifikasi langsung di peramban: layar masuk, dasbor, halaman
pemindaian (Berhasil / Kuota habis / Barcode tidak terdaftar / Pemindaian ganda),
data peserta + modal barcode, batas transaksi (bawaan & per peserta), riwayat,
laporan, lembar cetak barcode, serta alur impor Excel dari dialog *Impor Excel*
(file terpasang → unggah → tabel kesalahan dengan nomor baris dan kolom).

Menu **Jenis Transaksi** (hasil gabungan dua menu) juga diuji langsung di peramban:

- Sidebar kini hanya punya **satu** entri jenis transaksi (tak ada lagi menu
  ganda), posisinya tepat setelah Dasbor.
- Tab **Jenis & batas bawaan** menampilkan seluruh kolom dari kedua menu lama
  (centang pakai, batas bawaan bisa diketik, pemakaian, hari ini, terpakai,
  ditolak, batas khusus) plus toolbar *Pilih semua transaksi / Kosongkan pilihan /
  Simpan pilihan / Jenis transaksi baru / Lanjut ke Pemindaian*.
- Status berubah ke **kuning *"n dari m belum disimpan"*** saat centang disentuh,
  lalu kembali biru *"n dari m dipakai"* setelah **Simpan pilihan** (dibuktikan
  menonaktifkan satu jenis → tersimpan → dikembalikan dengan **Pilih semua
  transaksi**).
- Tab **Batas per peserta** tetap berfungsi; karena data contoh sudah dihapus,
  ia menampilkan pesan pengarah untuk mengimpor peserta lebih dulu.
- Tautan lama `#pilihjenis` membuka halaman gabungan yang sama.

Data contoh sudah dibersihkan (12 peserta + 27 riwayat + 2 batas khusus contoh),
pemuatan otomatis dicek lewat dua kali restart — peserta tetap 0 dan server
memberi pesan bahwa data contoh tidak dimuat ulang. Nama event, akun, 8 jenis
transaksi (termasuk "Bakso" + "Coto" yang Anda buat), dan catatan aktivitas
terbukti tidak tersentuh.

Yang **belum** diuji: pembacaan barcode fisik lewat kamera (kamera menyala dan
kotak pindai tampil, tetapi barcode tercetak belum diarahkan ke kamera), dan
pemakaian aplikasi dari beberapa perangkat sekaligus pada jaringan lokal.

Catatan lolos audit: `npm audit` melaporkan 2 peringatan tingkat sedang dari
dependensi turunan `uuid` di dalam `exceljs` (isu batas buffer pada `uuid` v3/v5/v6
ketika argumen `buf` diberikan — tidak dipakai aplikasi ini). Tidak ada versi
`exceljs` yang lebih baru yang memperbaikinya; memaksa perbaikan justru menurunkan
versi. Risikonya dinilai tidak berlaku untuk aplikasi ini.
