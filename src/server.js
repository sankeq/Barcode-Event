'use strict';

/**
 * Titik masuk aplikasi Barcode Peserta Event.
 *
 * - Locally: `node src/server.js` men-start server Express biasa.
 * - Vercel/lambda: modul ini men-export default handler yang boleh dipanggil
 *   berulang kali oleh runtime serverless.
 *
 * Catatan penting untuk deploy Vercel:
 * - Aplikasi ini하지만 pakai SQLite lokal (better-sqlite3) dengan satu berkas
 *   database. Itu tidak "bertahan" di Vercel Functions secara default; tiap
 *   invocation bisa dapat container baru danPath DB lokal bisa hilang/tidak
 *   konsisten antar request. Untuk deploy Vercel yang stabil, pindahkan DB ke
 *   layanan persistent (mis. Vercel Postgres / D1 / layanan DB eksternal) atau
 *   gunakan monorepo/server yang mendukung storage persisten.
 * - File statis (public/, vendor/html5-qrcode.min.js) disajikan melalui handler
 *   ini untuk environment serverless; di local tetap bisa dijalankan seperti biasa.
 */

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const { getDb, DB_PATH, getSetting, setSetting } = require('./db');
const { ensureSeed, seedContoh } = require('./seed');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
// Di platform hosting (Railway dsb.) PORT disuntikkan dan server harus
// mendengarkan 0.0.0.0 agar bisa diakses dari luar container. Secara lokal
// tetap 127.0.0.1 agar aman. Bisa ditimpa lewat variabel HOST.
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');

const app = express();
app.disable('x-powered-by');
// Di belakang proxy HTTPS Railway: percayai 1 hop proxy agar req.protocol
// terbaca 'https' dan cookie Secure berfungsi.
app.set('trust proxy', 1);

// --- Header keamanan dasar -------------------------------------------------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "font-src 'self'",
      // 'unsafe-eval' diperlukan pustaka pemindai kamera (dekoder zxing berbasis JS).
      "script-src 'self' blob: 'wasm-unsafe-eval' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join('; '),
  );
  next();
});

// --- Badan permintaan ------------------------------------------------------
// Catatan: impor Excel dikirim sebagai berkas mentah sehingga tidak
// tersentuh oleh parser JSON di bawah ini.
app.use(express.json({ limit: '2mb' }));

// --- Tolak permintaan lintas situs untuk operasi yang mengubah data --------
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) {
          return res.status(403).json({ error: 'Permintaan lintas situs ditolak.' });
        }
      } catch {
        return res.status(403).json({ error: 'Origin tidak valid.' });
      }
    }
  }
  next();
});

// --- API -------------------------------------------------------------------
app.use('/api/auth', require('./routes/auth'));
app.use('/api/jenis', require('./routes/jenis'));
app.use('/api/peserta', require('./routes/peserta'));
app.use('/api/scan', require('./routes/scan'));
app.use('/api/transaksi', require('./routes/riwayat').router);
app.use('/api/laporan', require('./routes/laporan'));
app.use('/api/kuota', require('./routes/kuota'));
app.use('/api', require('./routes/admin'));

// --- Info publik (dipakai layar masuk) ------------------------------------
app.get('/api/info', (req, res) => {
  res.json({ nama_event: require('./db').getSetting('nama_event', 'Event') });
});

// --- Pustaka pemindai kamera (disajikan dari node_modules) -----------------
app.get('/vendor/html5-qrcode.min.js', (req, res) => {
  res.type('application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(ROOT, 'node_modules', 'html5-qrcode', 'html5-qrcode.min.js'));
});

app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));

// --- Penanganan galat ------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[galat]', err);
  res.status(status).json({
    error: status >= 500 ? `Terjadi kesalahan pada server: ${err.message}` : err.message,
  });
});

// --- Vercel / serverless handler ------------------------------------------
// Runtime Node serverless mengharapkan default export berupa function
// (request, response) atau sebuah server. Kita pakai pola adapter Express
// yang umum: export default fungsi yang memproses req/res lewat app.
//
// Jalankan di Vercel:
//   - Tidak memanggil app.listen() di sini.
//   - Memanggil getDb() on-demand sesuai request (lihat catatan di atas tentang
//     persistensi DB).
//   - Menyajikan file statis public/ + vendor/manual jika diperlukan.

function serveStaticIfNeeded(req, res, next) {
  // Sajikan file statis dari public/ apabila ada (Versi Vercel sering butuh
  // penanganan manual karena express.static tidak selalu berjalan ideal di
  // lambda tanpa konfigurasi tambahan).
  const publicDir = path.join(ROOT, 'public');
  let rel = req.path;
  if (rel.endsWith('/')) rel = rel.slice(0, -1);
  const cand = path.join(publicDir, rel);
  try {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      res.sendFile(cand);
      return true;
    }
  } catch {
    // ada masalah stat, lanjut ke route lain
  }

  // Jika request ke '/' dan ada index.html, sajikan itu.
  if (req.path === '/' || req.path === '') {
    const idx = path.join(publicDir, 'index.html');
    try {
      if (fs.existsSync(idx)) {
        res.sendFile(idx);
        return true;
      }
    } catch {
      // lanjut
    }
  }

  return false;
}

function asVercelHandler(req, res) {
  // Pastikan database tersedia untuk request ini (on-demand).
  // Peringatan: pola ini mengasumsikan DB_PATH bisa ditulis/dibaca di runtime
  // serverless; di Vercel itu tidak dijamin tanpa storage eksternal.
  try {
    getDb();
  } catch (err) {
    console.error('[galat DB] gagal siapkan database:', err.message);
  }

  // Jika request statis, tampilkan langsung.
  if (serveStaticIfNeeded(req, res)) return;

  // Jalankan Express app untuk request ini.
  app(req, res);
}

// Default export wajib ada agar Vercel tidak menolak modul ini dengan:
// "Invalid export found in module ... The default export must be a function or server."
module.exports = { app, start: null };
module.exports.default = asVercelHandler;
module.exports.handler = asVercelHandler;

// --- Local dev / standalone runner -----------------------------------------
function start() {
  const db = getDb();
  // Bersihkan sesi kedaluwarsa saat aplikasi dijalankan.
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());

  ensureSeed();
  const adaPeserta = db.prepare('SELECT COUNT(*) AS c FROM peserta').get().c;
  const flagContoh = getSetting('data_contoh', null);
  if (flagContoh === null) {
    // Hanya sekali: basis data masih kosong dan belum pernah menyimpan penanda.
    if (adaPeserta === 0) {
      const hasil = seedContoh();
      console.log(`Data contoh ditambahkan: ${hasil.ditambahkan} peserta.`);
    }
    setSetting('data_contoh', '1');
  } else if (adaPeserta === 0) {
    console.log(
      'Data contoh tidak dimuat ulang. Jalankan `npm run seed` bila ingin memakainya lagi.',
    );
  }

  const server = app.listen(PORT, HOST, () => {
    console.log('');
    console.log('  Aplikasi Barcode Peserta Event');
    console.log(`  Buka      : http://${HOST}:${PORT}`);
    console.log(`  Database  : ${DB_PATH}`);
    console.log('  Login     : admin / admin123      (Admin)');
    console.log('              petugas / petugas123  (Petugas)');
    console.log('');
  });

  const tutup = () => {
    server.close(() => {
      try {
        getDb().close();
      } catch {
        /* abaikan */
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 4000).unref();
  };
  process.on('SIGINT', tutup);
  process.on('SIGTERM', tutup);
  return server;
}

if (require.main === module) start();
