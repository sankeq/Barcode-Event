'use strict';

/**
 * Titik masuk aplikasi Barcode Peserta Event.
 * Menyajikan API JSON + antarmuka statis dari folder public/.
 */

const path = require('node:path');
const express = require('express');
const { getDb, DB_PATH, getSetting, setSetting } = require('./db');
const { ensureSeed, seedContoh } = require('./seed');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

const app = express();
app.disable('x-powered-by');

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

module.exports = { app, start };
