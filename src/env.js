'use strict';

/**
 * Pemuat variabel lingkungan dari berkas `.env` (opsional, tanpa dependensi).
 *
 * Dibuat agar berjalan mulus di cPanel/Passenger maupun server lain: cukup
 * taruh berkas `.env` di root project. Variabel yang SUDAH ada di process.env
 * (mis. disetel lewat panel cPanel "Environment variables") TIDAK ditimpa,
 * sehingga panel hosting tetap menang atas berkas `.env`.
 *
 * Format yang didukung: baris `KUNCI=nilai`, baris kosong, komentar diawali #.
 * Tanda kutip di sekeliling nilai (`"..."` atau `'...'`) dilepas.
 */

const fs = require('node:fs');
const path = require('node:path');

function muatEnv(file) {
  const target = file || path.join(__dirname, '..', '.env');
  let isi;
  try {
    isi = fs.readFileSync(target, 'utf8');
  } catch {
    return; // .env tidak ada -> abaikan, pakai process.env apa adanya
  }

  for (const barisMentah of isi.split(/\r?\n/)) {
    const baris = barisMentah.trim();
    if (!baris || baris.startsWith('#')) continue;

    const eq = baris.indexOf('=');
    if (eq === -1) continue;

    const kunci = baris.slice(0, eq).trim();
    if (!kunci) continue;

    let nilai = baris.slice(eq + 1).trim();
    if (
      (nilai.startsWith('"') && nilai.endsWith('"')) ||
      (nilai.startsWith("'") && nilai.endsWith("'"))
    ) {
      nilai = nilai.slice(1, -1);
    }

    // Jangan timpa variabel yang sudah disetel lingkungan/panel hosting.
    if (process.env[kunci] === undefined) process.env[kunci] = nilai;
  }
}

module.exports = { muatEnv };
