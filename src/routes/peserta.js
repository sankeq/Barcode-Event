'use strict';

/**
 * Rute peserta: daftar, tambah/ubah/hapus, impor & template Excel,
 * barcode (lihat/unduh), dan ringkasan kuota per peserta.
 */

const express = require('express');
const ExcelJS = require('exceljs');
const { query, insert, update, getSetting, getConnection } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { logAudit } = require('../audit');
const { asyncHandler, parsePaging, toInt, trimOrNull, daftarKategori, nowIso } = require('../util');
const { generateKodeBarcode, barcodeSvg, barcodePng } = require('../barcode');
const { buildTemplate, parseImportFile, validasiDanImpor, sheetDariData } = require('../excel');
const { ringkasanKuotaPeserta } = require('../scan');

const router = express.Router();
const adminOnly = [requireAuth, requireRole('admin')];

const ID_RE = /^[A-Za-z0-9._\-/]{1,40}$/;

function validasiPeserta(body) {
  const errors = [];
  const out = {};
  const nomor = String(body.nomor_peserta ?? '').trim();
  const nama = String(body.nama ?? '').trim();
  if (!nomor) errors.push('Nomor peserta wajib diisi.');
  else if (!ID_RE.test(nomor))
    errors.push('Nomor peserta hanya boleh huruf, angka, dan tanda - _ . / (maksimal 40 karakter).');
  if (!nama) errors.push('Nama peserta wajib diisi.');
  else if (nama.length > 120) errors.push('Nama maksimal 120 karakter.');
  out.nomor_peserta = nomor;
  out.nama = nama;
  out.kategori = trimOrNull(body.kategori);
  out.kontak = trimOrNull(body.kontak);
  if (body.aktif !== undefined) out.aktif = body.aktif ? 1 : 0;
  return { out, errors };
}

// ---------------------------------------------------------------------------
// Daftar & kategori
// ---------------------------------------------------------------------------

router.get(
  '/',
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const { page, perPage, offset } = parsePaging(req.query, 25);
    const q = trimOrNull(req.query.q);
    const kategori = trimOrNull(req.query.kategori);
    const status = trimOrNull(req.query.status); // aktif | nonaktif | semua

    const where = [];
    const params = [];
    if (q) {
      where.push('(p.nama LIKE ? OR p.nomor_peserta LIKE ? OR p.kode_barcode LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (kategori) {
      where.push('p.kategori = ?');
      params.push(kategori);
    }
    if (status === 'aktif') where.push('p.aktif = 1');
    else if (status === 'nonaktif') where.push('p.aktif = 0');
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = (await query(`SELECT COUNT(*) AS c FROM peserta p ${whereSql}`, params))[0].c;

    const rows = await query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM transaksi t WHERE t.peserta_id = p.id AND t.status = 'berhasil') AS total_transaksi
         FROM peserta p ${whereSql}
        ORDER BY p.nomor_peserta
        LIMIT ? OFFSET ?`,
      [...params, perPage, offset],
    );

    res.json({
      data: rows.map((p) => ({ ...p, aktif: !!p.aktif })),
      kategori: await daftarKategori(),
      page,
      perPage,
      total,
      totalHalaman: Math.max(Math.ceil(total / perPage), 1),
    });
  }),
);

/** Dipakai halaman pemindaian (petugas) untuk menampilkan informasi peserta. */
router.get(
  '/lookup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const kode = trimOrNull(req.query.kode);
    if (!kode) return res.status(400).json({ error: 'Kode barcode wajib diisi.' });
    const peserta =
      (await query('SELECT * FROM peserta WHERE kode_barcode = ? LIMIT 1', [kode]))[0] ||
      (await query('SELECT * FROM peserta WHERE nomor_peserta = ? LIMIT 1', [kode]))[0];
    if (!peserta) return res.status(404).json({ error: 'Barcode tidak terdaftar.' });
    res.json({
      peserta: {
        id: peserta.id,
        nomorPeserta: peserta.nomor_peserta,
        nama: peserta.nama,
        kategori: peserta.kategori,
        aktif: !!peserta.aktif,
      },
      kuota: await ringkasanKuotaPeserta(peserta.id),
    });
  }),
);

router.get(
  '/kategori',
  ...adminOnly,
  asyncHandler(async (req, res) => res.json({ kategori: await daftarKategori() })),
);

// ---------------------------------------------------------------------------
// Template, impor, ekspor Excel
// ---------------------------------------------------------------------------

router.get(
  '/template.xlsx',
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const buffer = await buildTemplate(await getSetting('nama_event', 'Event'));
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="template-import-peserta.xlsx"',
    );
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buffer));
  }),
);

router.get(
  '/export.xlsx',
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT p.nomor_peserta, p.nama, p.kategori, p.kontak, p.kode_barcode, p.aktif,
              (SELECT COUNT(*) FROM transaksi t WHERE t.peserta_id = p.id AND t.status = 'berhasil') AS total_transaksi
         FROM peserta p ORDER BY p.nomor_peserta`,
    );
    const wb = new ExcelJS.Workbook();
    sheetDariData(
      wb,
      'Peserta',
      [
        { header: 'Nomor Peserta', key: 'nomor_peserta', width: 16 },
        { header: 'Nama', key: 'nama', width: 30 },
        { header: 'Kategori', key: 'kategori', width: 16 },
        { header: 'Kontak', key: 'kontak', width: 18 },
        { header: 'Kode Barcode', key: 'kode_barcode', width: 26 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Total Transaksi', key: 'total_transaksi', width: 16 },
      ],
      rows.map((r) => ({ ...r, status: r.aktif ? 'Aktif' : 'Nonaktif' })),
    );
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', 'attachment; filename="data-peserta.xlsx"');
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buffer));
  }),
);

// Body berupa file mentah (application/octet-stream) agar tidak perlu dependensi upload.
router.post(
  '/import',
  ...adminOnly,
  express.raw({ type: () => true, limit: '12mb' }),
  asyncHandler(async (req, res) => {
    const mode = req.query.mode === 'perbarui' ? 'perbarui' : 'tambah';
    if (!req.body || !req.body.length) {
      return res.status(400).json({ error: 'File tidak terbaca. Pastikan file .xlsx sudah dipilih.' });
    }
    let parsed;
    try {
      parsed = await parseImportFile(req.body);
    } catch (err) {
      return res.status(400).json({
        error: `Gagal membaca file Excel: ${err.message}. Gunakan template yang disediakan.`,
      });
    }

    const kurang = [];
    if (!parsed.kolom.nomor) kurang.push('Nomor Peserta');
    if (!parsed.kolom.nama) kurang.push('Nama');
    if (kurang.length) {
      return res.status(400).json({
        error: `Kolom wajib tidak ditemukan pada baris judul: ${kurang.join(', ')}. Silakan pakai template yang disediakan.`,
      });
    }
    if (!parsed.baris.length) {
      return res.status(400).json({ error: 'Tidak ada baris data yang bisa diimpor.' });
    }

    const hasil = await validasiDanImpor(parsed.baris, { mode, user: req.user });
    await logAudit({
      user: req.user,
      aksi: 'peserta.impor',
      entitas: 'peserta',
      detail: {
        mode,
        totalBaris: hasil.totalBaris,
        ditambahkan: hasil.inserted,
        diperbarui: hasil.updated,
        error: hasil.errors.length,
      },
    });

    res.json({
      mode,
      totalBaris: hasil.totalBaris,
      ditambahkan: hasil.inserted,
      diperbarui: hasil.updated,
      gagal: hasil.errors.length,
      errors: hasil.errors.slice(0, 300),
      errorsDipotong: hasil.errors.length > 300,
    });
  }),
);

// ---------------------------------------------------------------------------
// Barcode
// ---------------------------------------------------------------------------

async function ambilPeserta(id) {
  return (await query('SELECT * FROM peserta WHERE id = ?', [id]))[0] || null;
}

/** Buat kode barcode unik via pool query (callback isTaken barcode.js sinkron). */
async function buatKodeUnik(nomor) {
  for (let i = 0; i < 25; i += 1) {
    const kode = generateKodeBarcode(nomor, () => false);
    const rows = await query('SELECT 1 AS x FROM peserta WHERE kode_barcode = ? LIMIT 1', [kode]);
    if (!rows.length) return kode;
  }
  return generateKodeBarcode(`${nomor}-${Date.now()}`, () => false);
}

router.get(
  '/:id/barcode.svg',
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const p = await ambilPeserta(toInt(req.params.id, -1));
    if (!p) return res.status(404).send('Peserta tidak ditemukan');
    const svg = barcodeSvg(p.kode_barcode, { scale: req.query.scale, height: req.query.tinggi });
    res.type('image/svg+xml');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(svg);
  }),
);

router.get(
  '/:id/barcode.png',
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const p = await ambilPeserta(toInt(req.params.id, -1));
    if (!p) return res.status(404).send('Peserta tidak ditemukan');
    const buffer = await barcodePng(p.kode_barcode, { scale: req.query.scale, height: req.query.tinggi });
    res.type('image/png');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="barcode-${p.nomor_peserta.replace(/[^\w.-]/g, '_')}.png"`,
    );
    res.send(buffer);
  }),
);

/** Daftar peserta + data barcode untuk halaman cetak massal. */
router.get(
  '/barcode/daftar',
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const q = trimOrNull(req.query.q);
    const kategori = trimOrNull(req.query.kategori);
    const params = [];
    const where = ['p.aktif = 1'];
    if (q) {
      where.push('(p.nama LIKE ? OR p.nomor_peserta LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (kategori) {
      where.push('p.kategori = ?');
      params.push(kategori);
    }
    const rows = await query(
      `SELECT p.id, p.nomor_peserta, p.nama, p.kategori, p.kode_barcode
         FROM peserta p WHERE ${where.join(' AND ')}
        ORDER BY p.nomor_peserta`,
      params,
    );
    res.json({ data: rows, kategori: await daftarKategori() });
  }),
);

// ---------------------------------------------------------------------------
// CRUD peserta
// ---------------------------------------------------------------------------

router.get(
  '/:id/kuota',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, -1);
    const p = await ambilPeserta(id);
    if (!p) return res.status(404).json({ error: 'Peserta tidak ditemukan.' });
    res.json({
      peserta: { id: p.id, nomorPeserta: p.nomor_peserta, nama: p.nama, kategori: p.kategori },
      kuota: await ringkasanKuotaPeserta(id),
    });
  }),
);

router.get(
  '/:id',
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const p = await ambilPeserta(toInt(req.params.id, -1));
    if (!p) return res.status(404).json({ error: 'Peserta tidak ditemukan.' });
    res.json({ peserta: { ...p, aktif: !!p.aktif }, kuota: await ringkasanKuotaPeserta(p.id) });
  }),
);

router.post(
  '/',
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const { out, errors } = validasiPeserta(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });

    if ((await query('SELECT 1 AS x FROM peserta WHERE nomor_peserta = ?', [out.nomor_peserta])).length) {
      return res.status(409).json({ error: `ID ganda: nomor peserta "${out.nomor_peserta}" sudah terdaftar.` });
    }
    const kode = await buatKodeUnik(out.nomor_peserta);
    const waktu = nowIso();
    const id = await insert('peserta', {
      nomor_peserta: out.nomor_peserta,
      nama: out.nama,
      kategori: out.kategori,
      kontak: out.kontak,
      kode_barcode: kode,
      aktif: out.aktif ?? 1,
      created_at: waktu,
      updated_at: waktu,
      created_by: req.user.id,
      updated_by: req.user.id,
    });
    await logAudit({ user: req.user, aksi: 'peserta.tambah', entitas: 'peserta', entitasId: id, detail: out });
    res.status(201).json({ id, kode_barcode: kode });
  }),
);

router.put(
  '/:id',
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, -1);
    const ada = await ambilPeserta(id);
    if (!ada) return res.status(404).json({ error: 'Peserta tidak ditemukan.' });

    const { out, errors } = validasiPeserta({ ...ada, ...req.body });
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    if (out.nomor_peserta.toLowerCase() !== ada.nomor_peserta.toLowerCase()) {
      if ((await query('SELECT 1 AS x FROM peserta WHERE nomor_peserta = ? AND id <> ?', [out.nomor_peserta, id])).length) {
        return res.status(409).json({ error: `ID ganda: nomor peserta "${out.nomor_peserta}" sudah terdaftar.` });
      }
    }
    await update('peserta', id, { ...out, updated_at: nowIso(), updated_by: req.user.id });
    await logAudit({
      user: req.user,
      aksi: 'peserta.ubah',
      entitas: 'peserta',
      entitasId: id,
      detail: { sebelum: { nomor: ada.nomor_peserta, nama: ada.nama }, sesudah: out },
    });
    res.json({ ok: true });
  }),
);

/**
 * Hapus peserta secara PERMANEN beserta SELURUH datanya.
 *
 * Semua riwayat transaksi peserta ikut dihapus (bukan dilepas kaitannya),
 * karena FK transaksi.peserta_id memakai perilaku RESTRICT bawaan sehingga
 * baris transaksi wajib dihapus lebih dulu sebelum peserta. Batas kuota khusus
 * ikut terhapus lewat ON DELETE CASCADE. Semua langkah dijalankan dalam satu
 * transaksi agar atomik.
 *
 * CATATAN: karena riwayat transaksi ikut hilang, angka pada Riwayat/Laporan
 * untuk peserta ini tidak lagi muncul. Tindakan ini tidak bisa dibatalkan.
 */
router.delete(
  '/:id',
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, -1);
    const ada = await ambilPeserta(id);
    if (!ada) return res.status(404).json({ error: 'Peserta tidak ditemukan.' });

    const dipakai = (await query('SELECT COUNT(*) AS c FROM transaksi WHERE peserta_id = ?', [id]))[0].c;

    const conn = await getConnection();
    try {
      await conn.beginTransaction();
      // Hapus seluruh riwayat transaksi peserta ini lebih dulu (FK RESTRICT).
      await conn.query('DELETE FROM transaksi WHERE peserta_id = ?', [id]);
      // kuota_peserta ikut terhapus lewat ON DELETE CASCADE saat peserta dihapus.
      await conn.query('DELETE FROM peserta WHERE id = ?', [id]);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await logAudit({
      user: req.user,
      aksi: 'peserta.hapus',
      entitas: 'peserta',
      entitasId: id,
      detail: { nomor: ada.nomor_peserta, nama: ada.nama, riwayatDihapus: dipakai },
    });
    res.json({
      ok: true,
      mode: 'hapus',
      pesan:
        dipakai > 0
          ? `Peserta ${ada.nama} dan ${dipakai} riwayat transaksinya dihapus total.`
          : `Peserta ${ada.nama} dihapus total.`,
    });
  }),
);

/** Bikin ulang kode barcode (mis. barcode bocor / kartu hilang). */
router.post(
  '/:id/reset-barcode',
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id, -1);
    const ada = await ambilPeserta(id);
    if (!ada) return res.status(404).json({ error: 'Peserta tidak ditemukan.' });
    const kodeBaru = await buatKodeUnik(ada.nomor_peserta);
    await update('peserta', id, { kode_barcode: kodeBaru, updated_at: nowIso(), updated_by: req.user.id });
    await logAudit({
      user: req.user,
      aksi: 'peserta.reset_barcode',
      entitas: 'peserta',
      entitasId: id,
      detail: { lama: ada.kode_barcode, baru: kodeBaru },
    });
    res.json({ kode_barcode: kodeBaru });
  }),
);

module.exports = router;
