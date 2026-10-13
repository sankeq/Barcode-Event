'use strict';

/** Helper kecil yang dipakai di beberapa route. */

const { getDb } = require('./db');

/** Bungkus handler async agar error diteruskan ke middleware Express. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function toInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parsePaging(query, defaultPerPage = 25) {
  const page = Math.max(toInt(query.page, 1), 1);
  const perPage = Math.min(Math.max(toInt(query.perPage, defaultPerPage), 1), 500);
  return { page, perPage, offset: (page - 1) * perPage };
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Ubah input tanggal (YYYY-MM-DD) menjadi rentang ISO [awal, akhir] dalam waktu lokal server.
 * Dipakai untuk filter riwayat & laporan.
 */
function rentangTanggal(dari, sampai) {
  const out = { dariIso: null, sampaiIso: null };
  if (dari) {
    const d = new Date(`${dari}T00:00:00`);
    if (!Number.isNaN(d.getTime())) out.dariIso = d.toISOString();
  }
  if (sampai) {
    const d = new Date(`${sampai}T23:59:59.999`);
    if (!Number.isNaN(d.getTime())) out.sampaiIso = d.toISOString();
  }
  return out;
}

/**
 * Tanggal lokal (YYYY-MM-DD) menurut jam server.
 * Dipakai untuk menghitung "hari ini" pada zona waktu panitia, bukan UTC.
 */
function tanggalLokal(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Awal hari lokal beberapa hari lalu, sebagai ISO UTC (agar bisa dibandingkan dengan kolom `waktu`). */
function awalHariLokalIso(offsetHari = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetHari);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function trimOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Kategori unik untuk dropdown filter. */
function daftarKategori() {
  return getDb()
    .prepare(
      `SELECT DISTINCT kategori FROM peserta
        WHERE kategori IS NOT NULL AND TRIM(kategori) <> '' ORDER BY kategori COLLATE NOCASE`,
    )
    .all()
    .map((r) => r.kategori);
}

module.exports = {
  asyncHandler,
  toInt,
  parsePaging,
  nowIso,
  rentangTanggal,
  trimOrNull,
  daftarKategori,
  tanggalLokal,
  awalHariLokalIso,
};
