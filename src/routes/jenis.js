'use strict';

/**
 * Rute jenis transaksi (Parkir, Masuk Arena, Snack Pagi, Makan Siang,
 * Es Krim, Bakso/Coto, Kupon Doorprize) beserta batas bawaan event.
 *
 * Menu "Pilih Jenis Transaksi" memakai tiga endpoint di sini:
 *   GET    /api/jenis        -> daftar semua jenis + statistik
 *   POST   /api/jenis        -> langkah 1: tambah jenis transaksi
 *   POST   /api/jenis/pilih  -> langkah 2: pilih jenis yang dipakai (semua / sebagian)
 */

const express = require('express');
const { query, insert, update, getConnection } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { logAudit } = require('../audit');
const { asyncHandler, nowIso, tanggalLokal, awalHariLokalIso } = require('../util');

const router = express.Router();

/** Daftar semua jenis transaksi + statistik pemakaian ringkas. */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT j.*,
              (SELECT COUNT(*) FROM kuota_peserta k WHERE k.jenis_id = j.id) AS jumlah_override,
              (SELECT COUNT(*) FROM transaksi t WHERE t.jenis_id = j.id AND t.status = 'berhasil') AS total_terpakai,
              (SELECT COUNT(*) FROM transaksi t WHERE t.jenis_id = j.id AND t.status = 'ditolak') AS total_ditolak
         FROM jenis_transaksi j
        ORDER BY j.urutan, j.id`,
    );

    // Pemakaian hari ini (tanggal lokal panitia, bukan UTC) via rentang ISO.
    const perHariIni = new Map(
      (
        await query(
          `SELECT jenis_id, COUNT(*) AS c FROM transaksi
            WHERE status = 'berhasil' AND waktu >= ? AND waktu < ?
            GROUP BY jenis_id`,
          [awalHariLokalIso(0), awalHariLokalIso(1)],
        )
      ).map((r) => [r.jenis_id, r.c]),
    );

    const totalPesertaAktif = (
      await query('SELECT COUNT(*) AS c FROM peserta WHERE aktif = 1')
    )[0].c;

    const jenis = rows.map((j) => ({
      ...j,
      aktif: !!j.aktif,
      terpakai_hari_ini: perHariIni.get(j.id) || 0,
      totalPesertaAktif,
    }));

    res.json({
      jenis,
      ringkasan: {
        total: jenis.length,
        dipilih: jenis.filter((j) => j.aktif).length,
        pesertaAktif: totalPesertaAktif,
        tanggal: tanggalLokal(),
      },
    });
  }),
);

function validasiJenis(body, { partial = false } = {}) {
  const out = {};
  const errors = [];
  if (body.kode !== undefined) {
    const kode = String(body.kode).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!kode) errors.push('Kode jenis transaksi wajib diisi.');
    else out.kode = kode;
  } else if (!partial) errors.push('Kode jenis transaksi wajib diisi.');

  if (body.nama !== undefined) {
    const nama = String(body.nama).trim();
    if (!nama) errors.push('Nama jenis transaksi wajib diisi.');
    else out.nama = nama;
  } else if (!partial) errors.push('Nama jenis transaksi wajib diisi.');

  if (body.batas_default !== undefined) {
    const n = Number(body.batas_default);
    if (!Number.isInteger(n) || n < 0 || n > 999) {
      errors.push('Batas bawaan harus berupa angka bulat 0-999.');
    } else out.batas_default = n;
  }
  if (body.urutan !== undefined) {
    const n = Number(body.urutan);
    if (!Number.isInteger(n)) errors.push('Urutan harus berupa angka.');
    else out.urutan = n;
  }
  if (body.aktif !== undefined) out.aktif = body.aktif ? 1 : 0;
  return { out, errors };
}

/** Langkah 1 — tambah jenis transaksi baru. */
router.post(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { out, errors } = validasiJenis(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });

    if ((await query('SELECT 1 AS x FROM jenis_transaksi WHERE kode = ?', [out.kode])).length) {
      return res.status(409).json({ error: `Kode "${out.kode}" sudah dipakai.` });
    }
    const id = await insert('jenis_transaksi', {
      kode: out.kode,
      nama: out.nama,
      batas_default: out.batas_default ?? 1,
      urutan: out.urutan ?? 99,
      // Jenis baru langsung ikut terpilih agar bisa segera dipakai memindai.
      aktif: out.aktif ?? 1,
      updated_at: nowIso(),
      updated_by: req.user.id,
    });
    await logAudit({
      user: req.user,
      aksi: 'jenis.tambah',
      entitas: 'jenis_transaksi',
      entitasId: id,
      detail: out,
    });
    res.status(201).json({ id, aktif: out.aktif ?? 1 });
  }),
);

/**
 * Langkah 2 — tentukan jenis transaksi mana yang dipakai saat event.
 *
 * Body:
 *   { aktifkanSemua: true }  -> pilih semua jenis transaksi
 *   { ids: [1, 2, 5] }       -> hanya id tersebut yang dipilih, sisanya dikeluarkan
 *
 * Jenis yang dikeluarkan tidak muncul di halaman Pemindaian dan tidak bisa
 * dipakai memindai, tetapi seluruh riwayatnya tetap utuh di laporan.
 */
router.post(
  '/pilih',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const semua = await query('SELECT id, kode, nama, aktif FROM jenis_transaksi ORDER BY urutan, id');
    if (!semua.length) {
      return res.status(400).json({ error: 'Belum ada jenis transaksi. Tambahkan dulu pada langkah 1.' });
    }

    let idsTerpilih;
    if (req.body?.aktifkanSemua) {
      idsTerpilih = semua.map((j) => j.id);
    } else if (Array.isArray(req.body?.ids)) {
      const dikenal = new Set(semua.map((j) => j.id));
      idsTerpilih = [...new Set(req.body.ids.map((x) => Number(x)).filter((x) => dikenal.has(x)))];
    } else {
      return res
        .status(400)
        .json({ error: 'Pilih minimal satu jenis transaksi atau gunakan tombol "Pilih semua transaksi".' });
    }

    if (!idsTerpilih.length) {
      return res.status(400).json({
        error: 'Minimal satu jenis transaksi harus dipilih, jika tidak petugas tidak bisa memindai apa pun.',
      });
    }

    const dipilih = new Set(idsTerpilih);
    const waktu = nowIso();
    const dinyalakan = [];
    const dimatikan = [];

    const conn = await getConnection();
    try {
      await conn.beginTransaction();
      for (const j of semua) {
        const harusAktif = dipilih.has(j.id) ? 1 : 0;
        if (j.aktif === harusAktif) continue;
        await conn.query(
          'UPDATE jenis_transaksi SET aktif = ?, updated_at = ?, updated_by = ? WHERE id = ?',
          [harusAktif, waktu, req.user.id, j.id],
        );
        (harusAktif ? dinyalakan : dimatikan).push(j.nama);
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
      aksi: 'jenis.pilih',
      entitas: 'jenis_transaksi',
      detail: { dipilih: idsTerpilih, dinyalakan, dimatikan },
    });

    res.json({
      ok: true,
      jumlahDipilih: idsTerpilih.length,
      jumlahTotal: semua.length,
      dinyalakan,
      dimatikan,
    });
  }),
);

router.put(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const ada = (await query('SELECT * FROM jenis_transaksi WHERE id = ?', [id]))[0];
    if (!ada) return res.status(404).json({ error: 'Jenis transaksi tidak ditemukan.' });

    const { out, errors } = validasiJenis(req.body || {}, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    if (out.kode && out.kode !== ada.kode) {
      if ((await query('SELECT 1 AS x FROM jenis_transaksi WHERE kode = ? AND id <> ?', [out.kode, id])).length) {
        return res.status(409).json({ error: `Kode "${out.kode}" sudah dipakai.` });
      }
    }
    if (!Object.keys(out).length) return res.status(400).json({ error: 'Tidak ada perubahan.' });

    await update('jenis_transaksi', id, { ...out, updated_at: nowIso(), updated_by: req.user.id });
    await logAudit({
      user: req.user,
      aksi: 'jenis.ubah',
      entitas: 'jenis_transaksi',
      entitasId: id,
      detail: { sebelum: ada.nama, sesudah: out },
    });
    res.json({ ok: true });
  }),
);

/** Nonaktifkan jenis transaksi. Tidak dihapus agar riwayat tetap utuh. */
router.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const ada = (await query('SELECT * FROM jenis_transaksi WHERE id = ?', [id]))[0];
    if (!ada) return res.status(404).json({ error: 'Jenis transaksi tidak ditemukan.' });
    await update('jenis_transaksi', id, { aktif: 0, updated_at: nowIso(), updated_by: req.user.id });
    await logAudit({ user: req.user, aksi: 'jenis.nonaktif', entitas: 'jenis_transaksi', entitasId: id });
    res.json({ ok: true });
  }),
);

module.exports = router;
