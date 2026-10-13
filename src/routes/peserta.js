'use strict';

/**
 * Rute peserta: daftar, tambah/ubah/hapus, impor & template Excel,
 * barcode (lihat/unduh), dan ringkasan kuota per peserta.
 */

const express = require('express');
const ExcelJS = require('exceljs');
const { getDb, insert, update, getSetting } = require('../db');
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
  asyncHandler((req, res) => {
    const db = getDb();
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

    const total = db
      .prepare(`SELECT COUNT(*) AS c FROM peserta p ${whereSql}`)
      .get(...params).c;

    const rows = db
      .prepare(
        `SELECT p.*,
                (SELECT COUNT(*) FROM transaksi t WHERE t.peserta_id = p.id AND t.status = 'berhasil') AS total_transaksi
           FROM peserta p ${whereSql}
          ORDER BY p.nomor_peserta COLLATE NOCASE
          LIMIT ? OFFSET ?`,
      )
      .all(...params, perPage, offset);

    res.json({
      data: rows.map((p) => ({ ...p, aktif: !!p.aktif })),
      kategori: daftarKategori(),
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
  asyncHandler((req, res) => {
    const kode = trimOrNull(req.query.kode);
    if (!kode) return res.status(400).json({ error: 'Kode barcode wajib diisi.' });
    const db = getDb();
    const peserta =
      db.prepare('SELECT * FROM peserta WHERE kode_barcode = ? COLLATE NOCASE').get(kode) ||
      db.prepare('SELECT * FROM peserta WHERE nomor_peserta = ? COLLATE NOCASE').get(kode);
    if (!peserta) return res.status(404).json({ error: 'Barcode tidak terdaftar.' });
    res.json({
      peserta: {
        id: peserta.id,
        nomorPeserta: peserta.nomor_peserta,
        nama: peserta.nama,
        kategori: peserta.kategori,
        aktif: !!peserta.aktif,
      },
      kuota: ringkasanKuotaPeserta(peserta.id),
    });
  }),
);

router.get(
  '/kategori',
  ...adminOnly,
  asyncHandler((req, res) => res.json({ kategori: daftarKategori() })),
);

// ---------------------------------------------------------------------------
// Template, impor, ekspor Excel
// ---------------------------------------------------------------------------

router.get(
  '/template.xlsx',
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const buffer = await buildTemplate(getSetting('nama_event', 'Event'));
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
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT p.nomor_peserta, p.nama, p.kategori, p.kontak, p.kode_barcode, p.aktif,
                (SELECT COUNT(*) FROM transaksi t WHERE t.peserta_id = p.id AND t.status = 'berhasil') AS total_transaksi
           FROM peserta p ORDER BY p.nomor_peserta COLLATE NOCASE`,
      )
      .all();
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

    const hasil = validasiDanImpor(parsed.baris, { mode, user: req.user });
    logAudit({
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

function ambilPeserta(id) {
  return getDb().prepare('SELECT * FROM peserta WHERE id = ?').get(id);
}

router.get(
  '/:id/barcode.svg',
  ...adminOnly,
  asyncHandler((req, res) => {
    const p = ambilPeserta(toInt(req.params.id, -1));
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
    const p = ambilPeserta(toInt(req.params.id, -1));
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
  asyncHandler((req, res) => {
    const db = getDb();
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
    const rows = db
      .prepare(
        `SELECT p.id, p.nomor_peserta, p.nama, p.kategori, p.kode_barcode
           FROM peserta p WHERE ${where.join(' AND ')}
          ORDER BY p.nomor_peserta COLLATE NOCASE`,
      )
      .all(...params);
    res.json({ data: rows, kategori: daftarKategori() });
  }),
);

// ---------------------------------------------------------------------------
// CRUD peserta
// ---------------------------------------------------------------------------

router.get(
  '/:id/kuota',
  requireAuth,
  asyncHandler((req, res) => {
    const id = toInt(req.params.id, -1);
    const p = ambilPeserta(id);
    if (!p) return res.status(404).json({ error: 'Peserta tidak ditemukan.' });
    res.json({
      peserta: { id: p.id, nomorPeserta: p.nomor_peserta, nama: p.nama, kategori: p.kategori },
      kuota: ringkasanKuotaPeserta(id),
    });
  }),
);

router.get(
  '/:id',
  ...adminOnly,
  asyncHandler((req, res) => {
    const p = ambilPeserta(toInt(req.params.id, -1));
    if (!p) return res.status(404).json({ error: 'Peserta tidak ditemukan.' });
    res.json({ peserta: { ...p, aktif: !!p.aktif }, kuota: ringkasanKuotaPeserta(p.id) });
  }),
);

router.post(
  '/',
  ...adminOnly,
  asyncHandler((req, res) => {
    const { out, errors } = validasiPeserta(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });

    const db = getDb();
    if (db.prepare('SELECT 1 AS x FROM peserta WHERE nomor_peserta = ?').get(out.nomor_peserta)) {
      return res.status(409).json({ error: `ID ganda: nomor peserta "${out.nomor_peserta}" sudah terdaftar.` });
    }
    const kode = generateKodeBarcode(out.nomor_peserta, (k) =>
      !!db.prepare('SELECT 1 AS x FROM peserta WHERE kode_barcode = ?').get(k),
    );
    const waktu = nowIso();
    const id = insert('peserta', {
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
    logAudit({ user: req.user, aksi: 'peserta.tambah', entitas: 'peserta', entitasId: id, detail: out });
    res.status(201).json({ id, kode_barcode: kode });
  }),
);

router.put(
  '/:id',
  ...adminOnly,
  asyncHandler((req, res) => {
    const id = toInt(req.params.id, -1);
    const db = getDb();
    const ada = ambilPeserta(id);
    if (!ada) return res.status(404).json({ error: 'Peserta tidak ditemukan.' });

    const { out, errors } = validasiPeserta({ ...ada, ...req.body });
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    if (out.nomor_peserta.toLowerCase() !== ada.nomor_peserta.toLowerCase()) {
      if (db.prepare('SELECT 1 AS x FROM peserta WHERE nomor_peserta = ? AND id <> ?').get(out.nomor_peserta, id)) {
        return res.status(409).json({ error: `ID ganda: nomor peserta "${out.nomor_peserta}" sudah terdaftar.` });
      }
    }
    update('peserta', id, { ...out, updated_at: nowIso(), updated_by: req.user.id });
    logAudit({
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
 * Hapus peserta. Bila sudah punya riwayat transaksi, hanya dinonaktifkan
 * agar laporan tetap akurat dan barcode lama tidak bisa dipakai lagi.
 */
router.delete(
  '/:id',
  ...adminOnly,
  asyncHandler((req, res) => {
    const id = toInt(req.params.id, -1);
    const db = getDb();
    const ada = ambilPeserta(id);
    if (!ada) return res.status(404).json({ error: 'Peserta tidak ditemukan.' });

    const dipakai = db.prepare('SELECT COUNT(*) AS c FROM transaksi WHERE peserta_id = ?').get(id).c;
    if (dipakai > 0) {
      update('peserta', id, { aktif: 0, updated_at: nowIso(), updated_by: req.user.id });
      logAudit({ user: req.user, aksi: 'peserta.nonaktif', entitas: 'peserta', entitasId: id });
      return res.json({
        ok: true,
        mode: 'nonaktif',
        pesan: `Peserta ${ada.nama} dinonaktifkan (memiliki ${dipakai} riwayat transaksi). Barcode-nya tidak dapat dipakai lagi.`,
      });
    }
    db.prepare('DELETE FROM peserta WHERE id = ?').run(id);
    logAudit({ user: req.user, aksi: 'peserta.hapus', entitas: 'peserta', entitasId: id, detail: ada.nomor_peserta });
    res.json({ ok: true, mode: 'hapus', pesan: `Peserta ${ada.nama} dihapus.` });
  }),
);

/** Bikin ulang kode barcode (mis. barcode bocor / kartu hilang). */
router.post(
  '/:id/reset-barcode',
  ...adminOnly,
  asyncHandler((req, res) => {
    const id = toInt(req.params.id, -1);
    const db = getDb();
    const ada = ambilPeserta(id);
    if (!ada) return res.status(404).json({ error: 'Peserta tidak ditemukan.' });
    const kodeBaru = generateKodeBarcode(ada.nomor_peserta, (k) =>
      !!db.prepare('SELECT 1 AS x FROM peserta WHERE kode_barcode = ?').get(k),
    );
    update('peserta', id, { kode_barcode: kodeBaru, updated_at: nowIso(), updated_by: req.user.id });
    logAudit({
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
