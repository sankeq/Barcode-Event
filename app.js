'use strict';

/**
 * Titik masuk untuk cPanel / Phusion Passenger.
 *
 * cPanel ("Setup Node.js App") menjalankan berkas ini sebagai Application
 * startup file. Passenger menyuntikkan PORT sendiri; aplikasi mendengarkannya
 * lewat start() di src/server.js. Variabel lingkungan dimuat dari .env bila ada
 * (panel "Environment variables" cPanel tetap menang karena tidak ditimpa).
 */

require('./src/env').muatEnv();

const fs = require('node:fs');
const path = require('node:path');

const { start } = require('./src/server');

/**
 * Catat galat start ke berkas log agar mudah dibaca lewat File Manager cPanel
 * (penyebab 503 sering kali gagal konek MySQL). Berkas ditulis di root project.
 */
function catatGalatStart(err) {
  const pesan =
    `[${new Date().toISOString()}] Gagal menjalankan aplikasi\n` +
    `code=${err && err.code ? err.code : '-'}\n` +
    `${err && err.stack ? err.stack : String(err)}\n\n`;
  // Selalu tulis ke stderr (ikut log Passenger).
  console.error(pesan);
  try {
    fs.appendFileSync(path.join(__dirname, 'startup-error.log'), pesan);
  } catch {
    /* bila tidak bisa menulis berkas, cukup andalkan stderr */
  }
}

start().catch((err) => {
  catatGalatStart(err);
  process.exit(1);
});

// Tangkap galat async yang tidak tertangani (mis. koneksi DB putus saat init).
process.on('unhandledRejection', (err) => catatGalatStart(err));
process.on('uncaughtException', (err) => catatGalatStart(err));
