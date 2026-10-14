'use strict';

/**
 * Titik masuk aplikasi Barcode Peserta Event.
 * Menyajikan API JSON + antarmuka statis dari folder public/.
 *
 * Dijalankan sebagai server Express biasa (`node src/server.js`). Cocok untuk
 * dijalankan lokal maupun di platform hosting berbasis proses seperti Railway
 * (lihat README bagian 2b).
 */

const path = require('node:path');
const express = require('express');
const { initDb, query, getPool, getSetting, setSetting } = require('./db');
const { ensureSeed, seedContoh } = require('./seed');

const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT) || 3306;
const DB_NAME = process.env.DB_NAME || 'event_barcode';

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
app.get('/api/info', async (req, res, next) => {
  try {
    res.json({ nama_event: await getSetting('nama_event', 'Event') });
  } catch (err) {
    next(err);
  }
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

async function start() {
  // Siapkan database & tabel PALING AWAL sebelum menerima permintaan.
  await initDb();

  // Bersihkan sesi kedaluwarsa saat aplikasi dijalankan.
  await query('DELETE FROM sessions WHERE expires_at < ?', [new Date().toISOString()]);

  await ensureSeed();
  const adaPeserta = (await query('SELECT COUNT(*) AS c FROM peserta'))[0].c;
  const flagContoh = await getSetting('data_contoh', null);
  if (flagContoh === null) {
    // Hanya sekali: basis data masih kosong dan belum pernah menyimpan penanda.
    if (adaPeserta === 0) {
      const hasil = await seedContoh();
      console.log(`Data contoh ditambahkan: ${hasil.ditambahkan} peserta.`);
    }
    await setSetting('data_contoh', '1');
  } else if (adaPeserta === 0) {
    console.log(
      'Data contoh tidak dimuat ulang. Jalankan `npm run seed` bila ingin memakainya lagi.',
    );
  }

  const server = app.listen(PORT, HOST, () => {
    console.log('');
    console.log('  Aplikasi Barcode Peserta Event');
    console.log(`  Buka      : http://${HOST}:${PORT}`);
    console.log(`  Database  : ${DB_HOST}:${DB_PORT}/${DB_NAME}`);
    console.log('  Login     : admin / admin123      (Admin)');
    console.log('              petugas / petugas123  (Petugas)');
    console.log('');
  });

  const tutup = () => {
    server.close(async () => {
      try {
        await getPool().end();
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

if (require.main === module) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { app, start };
