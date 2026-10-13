'use strict';

/** Riwayat transaksi: filter, pencarian, dan ekspor Excel. */

const express = require('express');
const ExcelJS = require('exceljs');
const { getDb } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { asyncHandler, parsePaging, toInt, trimOrNull, rentangTanggal, nowIso } = require('../util');
const { sheetDariData } = require('../excel');

const router = express.Router();

/** Bangun WHERE bersama untuk daftar, ekspor, dan rekap. */
function bangunFilter(query) {
  const where = [];
  const params = [];
  const q = trimOrNull(query.q);
  const jenisId = toInt(query.jenisId, 0);
  const status = trimOrNull(query.status);
  const kategori = trimOrNull(query.kategori);
  const petugasId = toInt(query.petugasId, 0);
  const { dariIso, sampaiIso } = rentangTanggal(trimOrNull(query.dari), trimOrNull(query.sampai));

  if (q) {
    where.push(
      '(t.nama_peserta LIKE ? OR t.nomor_peserta LIKE ? OR t.kode_barcode LIKE ? OR t.jenis_nama LIKE ?)',
    );
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (jenisId) {
    where.push('t.jenis_id = ?');
    params.push(jenisId);
  }
  if (status && ['berhasil', 'ditolak', 'ganda'].includes(status)) {
    where.push('t.status = ?');
    params.push(status);
  }
  if (kategori) {
    where.push('t.kategori = ?');
    params.push(kategori);
  }
  if (petugasId) {
    where.push('t.petugas_id = ?');
    params.push(petugasId);
  }
  if (dariIso) {
    where.push('t.waktu >= ?');
    params.push(dariIso);
  }
  if (sampaiIso) {
    where.push('t.waktu <= ?');
    params.push(sampaiIso);
  }
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const KOLOM_RIWAYAT = [
  { header: 'Waktu', key: 'waktu', width: 20 },
  { header: 'Status', key: 'status', width: 12 },
  { header: 'Alasan / Catatan', key: 'alasan', width: 34 },
  { header: 'Jenis Transaksi', key: 'jenis_nama', width: 20 },
  { header: 'Nomor Peserta', key: 'nomor_peserta', width: 15 },
  { header: 'Nama Peserta', key: 'nama_peserta', width: 26 },
  { header: 'Kategori', key: 'kategori', width: 14 },
  { header: 'Kode Barcode', key: 'kode_barcode', width: 26 },
  { header: 'Batas', key: 'batas', width: 8 },
  { header: 'Ke-', key: 'urutan_ke', width: 7 },
  { header: 'Sisa Setelah', key: 'sisa_setelah', width: 12 },
  { header: 'Petugas', key: 'petugas_nama', width: 22 },
  { header: 'Peran Petugas', key: 'petugas_role', width: 13 },
];

function labelStatus(s) {
  if (s === 'berhasil') return 'Berhasil';
  if (s === 'ditolak') return 'Ditolak';
  if (s === 'ganda') return 'Ganda';
  return s;
}

router.get(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler((req, res) => {
    const db = getDb();
    const { page, perPage, offset } = parsePaging(req.query, 50);
    const { whereSql, params } = bangunFilter(req.query || {});

    const total = db.prepare(`SELECT COUNT(*) AS c FROM transaksi t ${whereSql}`).get(...params).c;

    const data = db
      .prepare(
        `SELECT t.* FROM transaksi t ${whereSql}
          ORDER BY t.waktu DESC, t.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, perPage, offset);

    const ringkasan = db
      .prepare(
        `SELECT
           SUM(CASE WHEN t.status = 'berhasil' THEN 1 ELSE 0 END) AS berhasil,
           SUM(CASE WHEN t.status = 'ditolak'  THEN 1 ELSE 0 END) AS ditolak,
           SUM(CASE WHEN t.status = 'ganda'    THEN 1 ELSE 0 END) AS ganda
         FROM transaksi t ${whereSql}`,
      )
      .get(...params);

    const petugas = db
      .prepare("SELECT id, nama, role FROM users WHERE aktif = 1 ORDER BY nama COLLATE NOCASE")
      .all();

    res.json({
      data: data.map((t) => ({ ...t, statusLabel: labelStatus(t.status) })),
      ringkasan: {
        berhasil: ringkasan.berhasil || 0,
        ditolak: ringkasan.ditolak || 0,
        ganda: ringkasan.ganda || 0,
      },
      petugas,
      page,
      perPage,
      total,
      totalHalaman: Math.max(Math.ceil(total / perPage), 1),
    });
  }),
);

router.get(
  '/export.xlsx',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { whereSql, params } = bangunFilter(req.query || {});
    const rows = getDb()
      .prepare(`SELECT t.* FROM transaksi t ${whereSql} ORDER BY t.waktu DESC, t.id DESC LIMIT 20000`)
      .all(...params);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Aplikasi Barcode Peserta Event';
    const ws = sheetDariData(
      wb,
      'Riwayat Transaksi',
      KOLOM_RIWAYAT,
      rows.map((t) => ({
        ...t,
        status: labelStatus(t.status),
        waktu: new Date(t.waktu).toLocaleString('id-ID'),
      })),
    );
    ws.getRow(1).height = 20;
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="riwayat-transaksi-${nowIso().slice(0, 10)}.xlsx"`,
    );
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buffer));
  }),
);

module.exports = { router, bangunFilter, KOLOM_RIWAYAT, labelStatus };
