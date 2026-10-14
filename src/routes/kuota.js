'use strict';

/**
 * Pengaturan batas transaksi.
 *  - Batas bawaan per jenis diatur di /api/jenis.
 *  - Batas khusus per peserta diatur di sini (override).
 */

const express = require('express');
const { query, getConnection, getPool } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { logAudit } = require('../audit');
const { asyncHandler, toInt, nowIso } = require('../util');

const UPSERT_KUOTA =
  `INSERT INTO kuota_peserta (peserta_id, jenis_id, batas, updated_at, updated_by)
   VALUES (?, ?, ?, ?, ?)
   ON DUPLICATE KEY UPDATE batas = VALUES(batas),
     updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)`;

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
  asyncHandler(async (req, res) => {
    const pesertaId = toInt(req.params.id, -1);
    const peserta = (await query('SELECT * FROM peserta WHERE id = ?', [pesertaId]))[0];
    if (!peserta) return res.status(404).json({ error: 'Peserta tidak ditemukan.' });

    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items || !items.length) return res.status(400).json({ error: 'Tidak ada perubahan batas.' });

    const errors = [];
    const diterapkan = [];
    const waktu = nowIso();

    const conn = await getConnection();
    try {
      await conn.beginTransaction();
      for (const it of items) {
        const jenisId = toInt(it.jenisId, 0);
        const [jenisAda] = jenisId
          ? await conn.query('SELECT 1 AS x FROM jenis_transaksi WHERE id = ?', [jenisId])
          : [[]];
        if (!jenisId || !jenisAda.length) {
          errors.push(`Jenis transaksi tidak dikenal (id ${it.jenisId}).`);
          continue;
        }
        const v = validasiBatas(it.batas);
        if (v.error) {
          errors.push(v.error);
          continue;
        }
        if (v.hapus) {
          await conn.query('DELETE FROM kuota_peserta WHERE peserta_id = ? AND jenis_id = ?', [pesertaId, jenisId]);
          diterapkan.push({ jenisId, batas: null });
        } else {
          await conn.query(UPSERT_KUOTA, [pesertaId, jenisId, v.batas, waktu, req.user.id]);
          diterapkan.push({ jenisId, batas: v.batas });
        }
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      conn.release();
      throw err;
    }
    conn.release();

    if (errors.length && !diterapkan.length) return res.status(400).json({ error: errors.join(' ') });

    await logAudit({
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
  asyncHandler(async (req, res) => {
    const pesertaId = toInt(req.params.id, -1);
    const peserta = (await query('SELECT * FROM peserta WHERE id = ?', [pesertaId]))[0];
    if (!peserta) return res.status(404).json({ error: 'Peserta tidak ditemukan.' });
    const [info] = await getPool().query('DELETE FROM kuota_peserta WHERE peserta_id = ?', [pesertaId]);
    await logAudit({
      user: req.user,
      aksi: 'kuota.reset_peserta',
      entitas: 'peserta',
      entitasId: pesertaId,
      detail: { dihapus: info.affectedRows },
    });
    res.json({ ok: true, dihapus: info.affectedRows });
  }),
);

/** Terapkan satu batas ke semua peserta aktif (membuat override massal). */
router.post(
  '/jenis/:id/terapkan',
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const jenisId = toInt(req.params.id, -1);
    const jenis = (await query('SELECT * FROM jenis_transaksi WHERE id = ?', [jenisId]))[0];
    if (!jenis) return res.status(404).json({ error: 'Jenis transaksi tidak ditemukan.' });

    const v = validasiBatas(req.body?.batas);
    if (v.error || v.hapus) {
      return res.status(400).json({ error: 'Masukkan batas berupa angka bulat 0-999.' });
    }

    const peserta = await query('SELECT id FROM peserta WHERE aktif = 1');
    const waktu = nowIso();
    const conn = await getConnection();
    try {
      await conn.beginTransaction();
      for (const p of peserta) {
        await conn.query(UPSERT_KUOTA, [p.id, jenisId, v.batas, waktu, req.user.id]);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      conn.release();
      throw err;
    }
    conn.release();

    await logAudit({
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
  asyncHandler(async (req, res) => {
    const jenisId = toInt(req.params.id, -1);
    const jenis = (await query('SELECT * FROM jenis_transaksi WHERE id = ?', [jenisId]))[0];
    if (!jenis) return res.status(404).json({ error: 'Jenis transaksi tidak ditemukan.' });
    const [info] = await getPool().query('DELETE FROM kuota_peserta WHERE jenis_id = ?', [jenisId]);
    await logAudit({
      user: req.user,
      aksi: 'kuota.hapus_override_jenis',
      entitas: 'jenis_transaksi',
      entitasId: jenisId,
      detail: { dihapus: info.affectedRows },
    });
    res.json({ ok: true, dihapus: info.affectedRows });
  }),
);

module.exports = router;
