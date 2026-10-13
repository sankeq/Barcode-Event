'use strict';

/**
 * Rute pemindaian. Boleh diakses Admin maupun Petugas.
 * Semua keputusan kuota ada di src/scan.js (satu transaksi atomik).
 */

const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../auth');
const { asyncHandler, toInt, trimOrNull } = require('../util');
const { prosesScan } = require('../scan');

const router = express.Router();

router.post(
  '/',
  requireAuth,
  asyncHandler((req, res) => {
    const kode = trimOrNull(req.body?.kode);
    const jenisId = toInt(req.body?.jenisId, 0);
    const metode = req.body?.metode === 'manual' ? 'manual' : 'scan';

    if (!kode) return res.status(400).json({ error: 'Kode barcode wajib diisi.' });
    if (kode.length > 120) return res.status(400).json({ error: 'Kode barcode terlalu panjang.' });
    if (!jenisId) return res.status(400).json({ error: 'Pilih jenis transaksi terlebih dahulu.' });

    const hasil = prosesScan({ kode, jenisId, user: req.user, metode });
    // 200 walaupun ditolak: penolakan adalah hasil bisnis yang wajar,
    // bukan kegagalan teknis, sehingga UI bisa langsung menampilkan alasannya.
    res.json(hasil);
  }),
);

/** Pemindaian terakhir oleh petugas yang sedang masuk (panel di halaman scan). */
router.get(
  '/terakhir',
  requireAuth,
  asyncHandler((req, res) => {
    const limit = Math.min(Math.max(toInt(req.query.limit, 12), 1), 50);
    const rows = getDb()
      .prepare(
        `SELECT id, status, alasan, waktu, jenis_nama, nomor_peserta, nama_peserta,
                sisa_setelah, batas, petugas_nama
           FROM transaksi
          WHERE petugas_id = ?
          ORDER BY id DESC LIMIT ?`,
      )
      .all(req.user.id, limit);
    res.json({ data: rows });
  }),
);

module.exports = router;
