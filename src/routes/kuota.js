'use strict';

/**
 * Pengaturan batas transaksi.
 *  - Batas bawaan per jenis diatur di /api/jenis.
 *  - Batas khusus per peserta diatur di sini (override).
 */

const express = require('express');
const { getDb } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { logAudit } = require('../audit');
const { asyncHandler, toInt, nowIso } = require('../util');

const router = express.Router();
const adminOnly = [requireAuth, requireRole('admin')];

function validasiBatas(raw) {
  if (raw === null || raw === undefined || raw === '') return { hapus: true };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 999) {
    return { error: 'Batas harus angka bulat 0-999.' };
  }
  return { batas: n };
}

/** Atur batas beberapa jenis sekaligus untuk satu peserta. */
router.put(
  '/peserta/:id',
  ...adminOnly,
  asyncHandler((req, res) => {
    const pesertaId = toInt(req.params.id, -1);
    const db = getDb();
    const peserta = db.prepare('SELECT * FROM peserta WHERE id = ?').get(pesertaId);
    if (!peserta) return res.status(404).json({ error: 'Peserta tidak ditemukan.' });

    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items || !items.length) return res.status(400).json({ error: 'Tidak ada perubahan batas.' });

    const jenisAda = db.prepare('SELECT 1 AS x FROM jenis_transaksi WHERE id = ?');
    const upsert = db.prepare(
      `INSERT INTO kuota_peserta (peserta_id, jenis_id, batas, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(peserta_id, jenis_id) DO UPDATE SET batas = excluded.batas,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    );
    const hapus = db.prepare('DELETE FROM kuota_peserta WHERE peserta_id = ? AND jenis_id = ?');

    const errors = [];
    const diterapkan = [];
    const waktu = nowIso();

    const jalankan = db.transaction(() => {
      for (const it of items) {
        const jenisId = toInt(it.jenisId, 0);
        if (!jenisId || !jenisAda.get(jenisId)) {
          errors.push(`Jenis transaksi tidak dikenal (id ${it.jenisId}).`);
          continue;
        }
        const v = validasiBatas(it.batas);
        if (v.error) {
          errors.push(v.error);
          continue;
        }
        if (v.hapus) {
          hapus.run(pesertaId, jenisId);
          diterapkan.push({ jenisId, batas: null });
        } else {
          upsert.run(pesertaId, jenisId, v.batas, waktu, req.user.id);
          diterapkan.push({ jenisId, batas: v.batas });
        }
      }
    });
    jalankan.immediate();

    if (errors.length && !diterapkan.length) return res.status(400).json({ error: errors.join(' ') });

    logAudit({
      user: req.user,
      aksi: 'kuota.ubah_peserta',
      entitas: 'peserta',
      entitasId: pesertaId,
      detail: { peserta: peserta.nomor_peserta, diterapkan },
    });
    res.json({ ok: true, diterapkan, errors });
  }),
);

/** Kembalikan seluruh batas peserta ke batas bawaan event. */
router.post(
  '/peserta/:id/reset',
  ...adminOnly,
  asyncHandler((req, res) => {
    const pesertaId = toInt(req.params.id, -1);
    const db = getDb();
    const peserta = db.prepare('SELECT * FROM peserta WHERE id = ?').get(pesertaId);
    if (!peserta) return res.status(404).json({ error: 'Peserta tidak ditemukan.' });
    const info = db.prepare('DELETE FROM kuota_peserta WHERE peserta_id = ?').run(pesertaId);
    logAudit({
      user: req.user,
      aksi: 'kuota.reset_peserta',
      entitas: 'peserta',
      entitasId: pesertaId,
      detail: { dihapus: info.changes },
    });
    res.json({ ok: true, dihapus: info.changes });
  }),
);

/** Terapkan satu batas ke semua peserta aktif (membuat override massal). */
router.post(
  '/jenis/:id/terapkan',
  ...adminOnly,
  asyncHandler((req, res) => {
    const jenisId = toInt(req.params.id, -1);
    const db = getDb();
    const jenis = db.prepare('SELECT * FROM jenis_transaksi WHERE id = ?').get(jenisId);
    if (!jenis) return res.status(404).json({ error: 'Jenis transaksi tidak ditemukan.' });

    const v = validasiBatas(req.body?.batas);
    if (v.error || v.hapus) {
      return res.status(400).json({ error: 'Masukkan batas berupa angka bulat 0-999.' });
    }

    const peserta = db.prepare('SELECT id FROM peserta WHERE aktif = 1').all();
    const upsert = db.prepare(
      `INSERT INTO kuota_peserta (peserta_id, jenis_id, batas, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(peserta_id, jenis_id) DO UPDATE SET batas = excluded.batas,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    );
    const waktu = nowIso();
    const jalankan = db.transaction(() => {
      peserta.forEach((p) => upsert.run(p.id, jenisId, v.batas, waktu, req.user.id));
    });
    jalankan.immediate();

    logAudit({
      user: req.user,
      aksi: 'kuota.terapkan_massal',
      entitas: 'jenis_transaksi',
      entitasId: jenisId,
      detail: { batas: v.batas, jumlahPeserta: peserta.length },
    });
    res.json({ ok: true, jumlahPeserta: peserta.length, batas: v.batas });
  }),
);

/** Hapus semua override untuk satu jenis -> kembali ke batas bawaan. */
router.post(
  '/jenis/:id/hapus-override',
  ...adminOnly,
  asyncHandler((req, res) => {
    const jenisId = toInt(req.params.id, -1);
    const db = getDb();
    const jenis = db.prepare('SELECT * FROM jenis_transaksi WHERE id = ?').get(jenisId);
    if (!jenis) return res.status(404).json({ error: 'Jenis transaksi tidak ditemukan.' });
    const info = db.prepare('DELETE FROM kuota_peserta WHERE jenis_id = ?').run(jenisId);
    logAudit({
      user: req.user,
      aksi: 'kuota.hapus_override_jenis',
      entitas: 'jenis_transaksi',
      entitasId: jenisId,
      detail: { dihapus: info.changes },
    });
    res.json({ ok: true, dihapus: info.changes });
  }),
);

module.exports = router;
