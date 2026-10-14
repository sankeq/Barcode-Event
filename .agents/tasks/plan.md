# Implementation Plan — Migrasi SQLite → MySQL

Migrasi aplikasi web Barcode Peserta Event dari SQLite (`better-sqlite3`, sinkron)
ke MySQL (`mysql2/promise`, pool + async). Target: XAMPP MySQL/MariaDB di
`127.0.0.1:3306`, user `root`, password kosong, database `event_barcode`.
Frontend `public/` TIDAK disentuh. Keputusan arsitektur sudah final (lihat task).

## Keputusan desain yang mengikat seluruh rencana

- **Driver & pool**: `mysql2/promise` dengan `mysql.createPool(...)`. Pool
  memungkinkan beberapa koneksi; transaksi pemindaian WAJIB memakai satu koneksi
  khusus (`pool.getConnection()`) agar `SELECT ... FOR UPDATE` dan `INSERT`
  berjalan di koneksi yang sama. Alasan: pool default membagikan koneksi
  berbeda per query, dan lock baris InnoDB hanya berlaku dalam satu transaksi
  pada satu koneksi.
- **Config via env**: baca `process.env` langsung (TANPA menambah `dotenv`).
  Var: `DB_HOST`(127.0.0.1), `DB_PORT`(3306), `DB_USER`(root), `DB_PASSWORD`(''),
  `DB_NAME`(event_barcode); jika `DATABASE_URL` ada, itu menang (di-parse jadi
  host/port/user/password/database). Alasan: menjaga ketergantungan minimal,
  sesuai pola proyek yang sudah membaca `process.env.PORT`/`HOST` langsung.
- **Auto-create DB + tabel saat start**: WAJIB. Konek tanpa `database` →
  `CREATE DATABASE IF NOT EXISTS event_barcode CHARACTER SET utf8mb4 COLLATE
  utf8mb4_unicode_ci` → tutup → buat pool dengan `database` → jalankan tiap
  `CREATE TABLE IF NOT EXISTS`. Alasan: user menjalankan XAMPP tetapi belum
  membuat database.
- **Timestamp**: tetap disimpan sebagai string ISO UTC (`new Date().toISOString()`)
  pada kolom `VARCHAR(40)`/`TEXT`. Alasan: meminimalkan perubahan perilaku;
  semua pembandingan rentang di `util.js`/route sudah memakai string ISO.
  SATU pengecualian perilaku yang harus diperbaiki: query yang memakai
  `substr(datetime(waktu,'localtime'),1,10)` (SQLite-only, butuh konversi zona
  waktu) tidak portabel ke MySQL/MariaDB tanpa tabel timezone. Ganti dengan
  **filter rentang ISO yang sudah dihitung di JS** (`awalHariLokalIso`,
  dan rentang hari ini `[awal hari lokal, awal hari lokal besok)`), lalu
  kelompokkan "per hari" di JS, bukan di SQL. Ini mempertahankan makna
  "hari ini menurut waktu panitia" tanpa bergantung pada zona waktu server DB.
- **Case-insensitive**: kolom unik/di-ORDER-case-insensitive (`username`,
  `nomor_peserta`, `kode_barcode`, `jenis.kode`) jadi `VARCHAR(190)` dengan
  `COLLATE utf8mb4_unicode_ci` (default DB juga `utf8mb4_unicode_ci`). Dengan
  collation ini, perbandingan `=` dan `ORDER BY` sudah case-insensitive, maka
  seluruh token `COLLATE NOCASE` di SQL inline DIHAPUS. Alasan: `COLLATE NOCASE`
  tidak ada di MySQL dan collation kolom sudah menanganinya.
- **Placeholder**: `mysql2` memakai `?` (sama seperti better-sqlite3), jadi
  string SQL berparameter tidak berubah selain penghapusan `COLLATE NOCASE`
  dan penggantian `datetime(...)`.
- **Hasil INSERT/affected rows**: `const [res] = await conn.query(sql, params)` →
  `res.insertId` (ganti `info.lastInsertRowid`) dan `res.affectedRows`
  (ganti `info.changes`).
- **Upsert**: `ON CONFLICT(...) DO UPDATE SET x = excluded.x` →
  `ON DUPLICATE KEY UPDATE x = VALUES(x)` (butuh UNIQUE key terkait).

## Daftar file & pemanggil (hasil eksplorasi)

Semua pemanggil data-layer yang harus jadi `await` (fungsi pembungkusnya jadi
`async`), dikelompokkan per file:
- `src/db.js` — tulis ulang total (pool async, auto-create, helper async).
- `src/scan.js` — tulis ulang mesin kuota (transaksi FOR UPDATE).
- `src/util.js` — `daftarKategori()` jadi async; hapus `COLLATE NOCASE`.
- `src/auth.js` — `createSession` (insert), `destroySession`, `userFromRequest` jadi async.
- `src/audit.js` — `logAudit`, `listAudit` jadi async.
- `src/seed.js` — `ensureSeed`, `seedContoh`, `seedContohTransaksi` jadi async; blok `require.main` jadi async IIFE.
- `src/excel.js` — `jenisAktif`, `parseImportFile` (sudah async), `validasiDanImpor` jadi async.
- `src/server.js` — `start()` jadi async, `await` init DB sebelum `app.listen`.
- `src/routes/auth.js`, `scan.js`, `jenis.js`, `peserta.js`, `kuota.js`,
  `laporan.js`, `riwayat.js`, `admin.js` — tiap handler jadi `async` dan setiap
  panggilan `getDb()...`, `insert`, `update`, `getSetting`, `setSetting`,
  `getNumberSetting`, `daftarKategori`, `ringkasanKuotaPeserta` di-`await`.
  Perbaiki juga query SQLite-only di `jenis.js` & `laporan.js`.
- `package.json` — hapus `better-sqlite3`, tambah `mysql2`.
- `README.md` — dokumentasikan switch MySQL + XAMPP + auto-create.
- `.env.example` — buat baru (JANGAN buat `.env` nyata).

Pola query baru untuk helper: ganti `getDb().prepare(sql).get(p)` →
`(await query(sql, [p]))[0]`, `.all(...)` → `await query(sql, [...])`,
`.run(...)` → `await execute(sql, [...])`. Rencana ini mengekspor helper
`query(sql, params)` (mengembalikan array baris) dan menjaga `getDb()` yang
mengembalikan pool untuk kompatibilitas, tetapi pola yang didorong adalah
helper `query`/`insert`/`update`.

---

## Langkah-langkah

- [ ] 1. Perbarui dependency: hapus `better-sqlite3`, tambah `mysql2`.
      Edit `dependencies` di package.json. Jalankan `npm install` sehingga
      `mysql2` masuk `node_modules` dan lockfile diperbarui.
      Files: `package.json`
      Verify: `node -e "require('mysql2/promise'); console.log('ok')"` mencetak `ok`;
      `node -e "try{require('better-sqlite3')}catch(e){console.log('removed')}"`
      mencetak `removed`.

- [ ] 2. Tulis ulang `src/db.js` jadi lapisan MySQL async: baca env
      (DB_HOST/PORT/USER/PASSWORD/NAME + DATABASE_URL), `initDb()` yang
      auto-create database lalu `CREATE TABLE IF NOT EXISTS` untuk SEMUA tabel
      (schema InnoDB port penuh), dan helper async `getPool()`, `query(sql,params)`,
      `insert(table,data)` (pakai `res.insertId`), `update(table,id,data)`
      (pakai `res.affectedRows`), `getSetting`, `setSetting` (ON DUPLICATE KEY
      UPDATE), `getNumberSetting`. Ekspor juga `getConnection()` untuk transaksi.
      Pertahankan nama ekspor lama (`getDb` kini mengembalikan pool), tambah
      `initDb`, `query`, `getConnection`.
      Schema port: `INTEGER PRIMARY KEY AUTOINCREMENT`→`INT AUTO_INCREMENT PRIMARY KEY`;
      `aktif INTEGER DEFAULT 1`→`TINYINT(1) NOT NULL DEFAULT 1`; kolom unik/teks
      case-insensitif→`VARCHAR(190) COLLATE utf8mb4_unicode_ci`; `TEXT` biasa→`TEXT`;
      `CHECK(...)` boleh dipertahankan (MySQL 8/MariaDB 10.4 menerima sintaksnya);
      FK `REFERENCES ... ON DELETE CASCADE`→FK InnoDB; `UNIQUE(peserta_id,jenis_id)`
      dipertahankan (dipakai ON DUPLICATE KEY); semua index didefinisikan INLINE
      di dalam `CREATE TABLE` (hindari `CREATE INDEX IF NOT EXISTS`).
      Files: `src/db.js`
      Verify: dengan XAMPP MySQL hidup, `node -e "const d=require('./src/db');d.initDb().then(()=>d.query('SHOW TABLES')).then(r=>{console.log(r.length>=8?'tables-ok':'missing',r.length);process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"`
      mencetak `tables-ok` dengan jumlah tabel ≥ 8 (users, sessions, peserta,
      jenis_transaksi, kuota_peserta, transaksi, audit_log, pengaturan).

- [ ] 3. Jadikan `src/util.js` → `daftarKategori()` async dan hapus `COLLATE NOCASE`
      dari ORDER BY-nya (pakai helper `query`).
      Files: `src/util.js`
      Verify: `node -e "require('./src/util')"` tanpa error (langkah fungsional
      diuji di langkah 11 saat server jalan).

- [ ] 4. Konversi `src/auth.js` ke async: `createSession` (await insert),
      `destroySession` (await execute), `userFromRequest` (await query);
      `requireAuth`/`requireRole` jadi async-aware (await `userFromRequest`).
      Hapus `COLLATE NOCASE` yang tidak diperlukan.
      Files: `src/auth.js`
      Verify: `node -e "require('./src/auth')"` tanpa error; verifikasi end-to-end
      login di langkah 11.

- [ ] 5. Konversi `src/audit.js` (`logAudit`, `listAudit`) ke async; ganti
      `getDb().prepare(...).all(...)` dengan `await query(...)`.
      Files: `src/audit.js`
      Verify: `node -e "require('./src/audit')"` tanpa error.

- [ ] 6. Tulis ulang mesin kuota `src/scan.js` jadi transaksi MySQL/InnoDB atomik
      memakai satu koneksi dari pool: `const conn = await getConnection();
      await conn.beginTransaction()`, kunci baris peserta/transaksi relevan dengan
      `SELECT ... FOR UPDATE`, lakukan seluruh pemeriksaan (peserta terdaftar →
      aktif → batas efektif → anti-ganda `jeda_duplikat_detik` → batas 0 → kuota
      habis → catat), `commit()`/`rollback()` lalu `conn.release()` di `finally`.
      Pertahankan PERSIS: status `'berhasil'|'ditolak'|'ganda'`, pesan Indonesia
      (Barcode tidak terdaftar, peserta tidak aktif, batas 0, Kuota habis,
      pemindaian ganda), dan bentuk respons `{status, pesan, peserta{...},
      jenisTransaksi{...}, batas, terpakai, sisa, waktu}`. `cariPeserta` memakai
      lookup case-insensitive (andalkan collation kolom; hapus `COLLATE NOCASE`).
      Kuncian baris: `SELECT ... FROM peserta WHERE ... FOR UPDATE` untuk peserta,
      dan hitung terpakai dengan `SELECT COUNT(*) ... FOR UPDATE` pada transaksi
      peserta+jenis agar hitungan kuota ter-serialisasi.
      `batasEfektif`, `jumlahTerpakai`, `ringkasanKuotaPeserta` jadi async; versi
      yang dipakai di dalam transaksi menerima `conn` sebagai parameter agar query
      berjalan di koneksi terkunci yang sama.
      Files: `src/scan.js`
      Verify: skrip uji konkurensi (buat sementara `scripts/_concTest.js`):
      seed peserta+jenis dengan kuota efektif 1, jalankan 25 `prosesScan` paralel
      via `Promise.all`, hitung status; harapan: tepat 1 `berhasil`, 24 `ditolak`.
      Jalankan `node scripts/_concTest.js` → cetak `berhasil=1 ditolak=24`.
      Hapus skrip setelah verifikasi.

- [ ] 7. Konversi `src/excel.js` ke async: `jenisAktif()` async (await query),
      `validasiDanImpor(rows,{mode,user})` jadi async — ganti transaksi
      `db.transaction(...).immediate()` dengan loop `for...of` memakai satu
      `getConnection()`/`beginTransaction`/`commit`, upsert kuota via
      `ON DUPLICATE KEY UPDATE`, dan `insert`/`update` via helper await. Hapus
      `COLLATE NOCASE`. `parseImportFile` sudah async: pastikan `jenisAktif()`
      di-await di dalamnya.
      Files: `src/excel.js`
      Verify: diuji lewat endpoint impor di langkah 11; sintaksis: `node -e "require('./src/excel')"` tanpa error.

- [ ] 8. Port `src/seed.js` ke async menjaga idempotensi: `ensureSeed()`,
      `seedContoh()`, `seedContohTransaksi()` async; ganti prepared-statement
      yang di-reuse dengan helper `query`/`insert` await di dalam loop; ganti
      transaksi `.immediate()` dengan `getConnection()`+`beginTransaction`;
      upsert `kuota_peserta` via `ON DUPLICATE KEY UPDATE`; blok
      `if (require.main === module)` jadi `async` IIFE yang memanggil `initDb()`
      dulu lalu `ensureSeed`/`seedContoh`, cetak ringkasan, dan keluar proses.
      Files: `src/seed.js`
      Verify: `npm run seed` selesai tanpa error dan mencetak jumlah
      Pengguna/Peserta/Transaksi > 0; jalankan `npm run seed` KEDUA kali →
      jumlah tidak bertambah ganda (idempoten).

- [ ] 9. Perbarui `src/server.js`: `start()` jadi async, panggil `await initDb()`
      SEBELUM membersihkan sesi/seed/`app.listen`; await `ensureSeed()`,
      `seedContoh()`, `getSetting`/`setSetting`; ganti `db.prepare('DELETE FROM
      sessions ...').run(...)` dengan `await query(...)`; pertahankan SEMUA header
      keamanan/CSP, urutan mount route, dan penyajian `public/`. Perbarui baris log
      `Database:` agar menampilkan host/nama DB alih-alih `DB_PATH`. Handler
      graceful shutdown menutup pool (`await getPool().end()`).
      Files: `src/server.js`
      Verify: dicakup langkah 11.

- [ ] 10. Konversi SEMUA route handler ke async + perbaiki SQL non-portabel.
      Pola seragam di tiap file: tandai handler `async`, `await` setiap
      `getDb()`→`query`, `insert`, `update`, `getSetting`, `setSetting`,
      `daftarKategori`, `ringkasanKuotaPeserta`; ganti `info.changes`→
      `res.affectedRows`; hapus `COLLATE NOCASE`.
      Perbaikan khusus date (SQLite-only → portabel):
      - `src/routes/jenis.js`: "terpakai hari ini" — ganti
        `substr(datetime(waktu,'localtime'),1,10) = ?` dengan filter
        `waktu >= ? AND waktu < ?` memakai `awalHariLokalIso(0)` dan
        `awalHariLokalIso(1)` (awal hari lokal ini & besok, sebagai ISO UTC),
        GROUP BY `jenis_id` saja.
      - `src/routes/laporan.js`: query "hari ini" di `/ringkasan` sama seperti di
        atas; `perHari` (7 hari) — ambil baris `waktu`,`status` dengan
        `waktu >= awalHariLokalIso(-6)`, lalu kelompokkan per tanggal lokal di JS
        memakai `tanggalLokal(new Date(row.waktu))`, hasilkan array
        `{tanggal,berhasil,ditolak}` berurutan.
      Files: `src/routes/auth.js`, `src/routes/scan.js`, `src/routes/jenis.js`,
      `src/routes/peserta.js`, `src/routes/kuota.js`, `src/routes/laporan.js`,
      `src/routes/riwayat.js`, `src/routes/admin.js`
      Verify: tiap modul dapat di-`require` tanpa error
      (`node -e "require('./src/routes/<nama>')"`); fungsional di langkah 11.

- [ ] 11. Buat `.env.example` (dokumentasi var; JANGAN buat `.env`) dan perbarui
      `README.md`: ganti bagian database SQLite→MySQL, dokumentasikan var env
      XAMPP (host 127.0.0.1, port 3306, user root, password kosong, db
      event_barcode), auto-create database+tabel saat start, dan `DATABASE_URL`.
      Files: `.env.example`, `README.md`
      Verify: smoke test end-to-end dengan XAMPP MySQL hidup — jalankan
      `node src/server.js` di background; `curl -s localhost:3000/api/info`
      mengembalikan JSON `nama_event`; login via
      `curl -c /tmp/c.txt -X POST localhost:3000/api/auth/login -H 'Content-Type:
      application/json' -d '{"username":"admin","password":"admin123"}'`
      mengembalikan user admin; satu `POST /api/scan` dengan sesi menghasilkan
      respons berbentuk `{status,pesan,peserta,jenisTransaksi,batas,terpakai,
      sisa,waktu}`. Hentikan server setelah uji.

## Catatan & asumsi

- Jika XAMPP MySQL tidak hidup saat verifikasi, langkah yang butuh DB (2, 6, 8,
  11) tidak bisa dijalankan — catat kondisi ini, jangan tandai selesai palsu.
  Build/`require` tetap bisa diverifikasi tanpa DB.
- `SELECT ... FOR UPDATE` pada COUNT: untuk mengunci baris transaksi peserta+jenis
  saat menghitung terpakai, kunci baris peserta dulu (`FOR UPDATE`) sebagai titik
  serialisasi tunggal; ini cukup untuk menjamin "25 bersamaan → tepat 1 berhasil"
  karena semua scan untuk peserta sama akan antre pada lock baris peserta itu.
- Collation DB & tabel diset `utf8mb4_unicode_ci` secara eksplisit agar perilaku
  case-insensitive tidak tergantung default server.
