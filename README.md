## 12. Catatan deploy ke Vercel

Aplikasi ini secara bawaan dirancang untuk **dijalankan sebagai server sendiri**
(`node src/server.js`), dengan SQLite lokal di `data/event.db`.

Versi Vercel Functions saat ini di-export sebagai handler yang bisa dipanggil
berulang kali, tetapi ada batasan penting:

- `better-sqlite3` + satu berkas database lokal **tidak persisten** di lingkungan
  serverless Vercel secara default. Request yang datang ke instance berbeda
  (atau container baru) bisa kehilangan akses ke data yang sama.
- Karena itu, deploy ke Vercel **tanpa penyesuaian storage** bisa berjalan
  sebentar lalu kembali ke keadaan kosong/tidak konsisten, atau gagal karena
  lokasi DB tidak bisa ditulis.

Jika ingin menyebarkan ke Vercel:

1. Pindahkan penyimpanan data ke layanan yang persisten dan support di Vercel
   (contoh: Vercel Postgres, D1, atau database eksternal yang diijinkan).
2. Sesuaikan `src/db.js` dan bagian seed/init supaya tidak mengandalkan
   `data/event.db` lokal untuk data penting.
3. Pastikan static files (`public/`, `vendor/...`) serta route API tetap di-serving
   dengan benar lewat handler di `src/server.js` atau konfigurasi Vercel yang
   sesuai.

Untuk event yang berjalan di satu lokasi dengan laptop/mini PC panitia,
cara paling sesuai masih **menjalankan server sendiri** (lihat bagian 2),
bukan Vercel Functions.
