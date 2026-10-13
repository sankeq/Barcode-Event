'use strict';

/**
 * Vercel function entry point untuk aplikasi Barcode Peserta Event.
 *
 * File ini mengimpor Express app dari src/server.js dan menjalankannya
 * sebagai handler request. Dengan pola ini, Vercel melihat export default
 * berupa function, bukan modul tanpa export yang sah.
 *
 * Catatan:
 * - Database (SQLite lokal) tetap diakses lewat getDb() on-demand.
 * - Di lingkungan serverless, satu berkas DB lokal tidak dijamin persisten
 *   antar invocation; lihat catatan di README bagian 12.
 */

const path = require('node:path');
const { app, getDb } = require(path.join(__dirname, '..', 'src', 'server.js'));

function handler(req, res) {
  // Siapkan database untuk request ini (on-demand).
  try {
    getDb();
  } catch (err) {
    console.error('[galat DB] gagal siapkan database:', err.message);
  }

  app(req, res);
}

module.exports = handler;
