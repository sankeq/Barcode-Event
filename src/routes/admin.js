'use strict';

/** Pengguna (Admin/Petugas), catatan aktivitas, dan pengaturan aplikasi. */

const express = require('express');
const { getDb, insert, update, getSetting, setSetting } = require('../db');
const { requireAuth, requireRole, hashPassword, verifyPassword } = require('../auth');
const { logAudit, listAudit } = require('../audit');
const { asyncHandler, toInt, nowIso, trimOrNull } = require('../util');

const router = express.Router();
const adminOnly = [requireAuth, requireRole('admin')];

// ---------------------------------------------------------------------------
// Pengguna
// ---------------------------------------------------------------------------

router.get(
  '/pengguna',
  ...adminOnly,
  asyncHandler((req, res) => {
    const rows = getDb()
      .prepare(
        `SELECT u.id, u.username, u.nama, u.role, u.aktif, u.created_at, u.updated_at,
                (SELECT COUNT(*) FROM transaksi t WHERE t.petugas_id = u.id AND t.status = 'berhasil') AS total_transaksi
           FROM users u ORDER BY u.role, u.username COLLATE NOCASE`,
      )
      .all();
    res.json({ data: rows.map((u) => ({ ...u, aktif: !!u.aktif })) });
  }),
);

function validasiPengguna(body) {
  const errors = [];
  const out = {};
  const username = String(body.username ?? '').trim();
  const nama = String(body.nama ?? '').trim();
  const role = String(body.role ?? '').trim();
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) {
    errors.push('Nama pengguna 3-32 karakter, hanya huruf/angka/tanda . _ -');
  }
  if (!nama) errors.push('Nama lengkap wajib diisi.');
  if (!['admin', 'petugas'].includes(role)) errors.push("Peran harus 'admin' atau 'petugas'.");
  out.username = username;
  out.nama = nama;
  out.role = role;
  if (body.aktif !== undefined) out.aktif = body.aktif ? 1 : 0;
  return { out, errors };
}

function hitungAdminAktif(kecualiId = null) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND aktif = 1${
        kecualiId ? ' AND id <> ?' : ''
      }`,
    )
    .get(...(kecualiId ? [kecualiId] : []));
  return row.c;
}

router.post(
  '/pengguna',
  ...adminOnly,
  asyncHandler((req, res) => {
    const { out, errors } = validasiPengguna(req.body || {});
    const sandi = String(req.body?.password || '');
    if (sandi.length < 6) errors.push('Kata sandi minimal 6 karakter.');
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });

    const db = getDb();
    if (db.prepare('SELECT 1 AS x FROM users WHERE username = ?').get(out.username)) {
      return res.status(409).json({ error: `Nama pengguna "${out.username}" sudah dipakai.` });
    }
    const waktu = nowIso();
    const id = insert('users', {
      username: out.username,
      nama: out.nama,
      role: out.role,
      password_hash: hashPassword(sandi),
      aktif: out.aktif ?? 1,
      created_at: waktu,
      updated_at: waktu,
      updated_by: req.user.id,
    });
    logAudit({
      user: req.user,
      aksi: 'pengguna.tambah',
      entitas: 'users',
      entitasId: id,
      detail: { username: out.username, role: out.role },
    });
    res.status(201).json({ id });
  }),
);

router.put(
  '/pengguna/:id',
  ...adminOnly,
  asyncHandler((req, res) => {
    const id = toInt(req.params.id, -1);
    const db = getDb();
    const ada = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!ada) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });

    const { out, errors } = validasiPengguna({ ...ada, ...req.body });
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    if (out.username.toLowerCase() !== ada.username.toLowerCase()) {
      if (db.prepare('SELECT 1 AS x FROM users WHERE username = ? AND id <> ?').get(out.username, id)) {
        return res.status(409).json({ error: `Nama pengguna "${out.username}" sudah dipakai.` });
      }
    }
    // Jangan sampai event kehilangan seluruh Admin yang aktif.
    const akanNonaktif = out.aktif === 0 && ada.aktif === 1;
    const akanJadiPetugas = out.role === 'petugas' && ada.role === 'admin';
    if ((akanNonaktif || akanJadiPetugas) && ada.role === 'admin' && hitungAdminAktif(id) === 0) {
      return res.status(400).json({
        error: 'Tidak bisa menonaktifkan atau mengubah peran Admin aktif terakhir.',
      });
    }
    if (id === req.user.id && out.aktif === 0) {
      return res.status(400).json({ error: 'Tidak bisa menonaktifkan akun Anda sendiri.' });
    }

    update('users', id, { ...out, updated_at: nowIso(), updated_by: req.user.id });
    logAudit({
      user: req.user,
      aksi: 'pengguna.ubah',
      entitas: 'users',
      entitasId: id,
      detail: { sebelum: { username: ada.username, role: ada.role, aktif: ada.aktif }, sesudah: out },
    });
    res.json({ ok: true });
  }),
);

router.post(
  '/pengguna/:id/sandi',
  ...adminOnly,
  asyncHandler((req, res) => {
    const id = toInt(req.params.id, -1);
    const db = getDb();
    const ada = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!ada) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    const sandi = String(req.body?.password || '');
    if (sandi.length < 6) return res.status(400).json({ error: 'Kata sandi minimal 6 karakter.' });
    update('users', id, {
      password_hash: hashPassword(sandi),
      updated_at: nowIso(),
      updated_by: req.user.id,
    });
    // Semua sesi lama pengguna tersebut diputus setelah sandi diganti.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    logAudit({ user: req.user, aksi: 'pengguna.ganti_sandi', entitas: 'users', entitasId: id });
    res.json({ ok: true });
  }),
);

/** Pengguna mengubah kata sandinya sendiri. */
router.post(
  '/sandi-saya',
  requireAuth,
  asyncHandler((req, res) => {
    const db = getDb();
    const saya = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const lama = String(req.body?.passwordLama || '');
    const baru = String(req.body?.passwordBaru || '');
    if (!verifyPassword(lama, saya.password_hash)) {
      return res.status(400).json({ error: 'Kata sandi lama tidak sesuai.' });
    }
    if (baru.length < 6) return res.status(400).json({ error: 'Kata sandi baru minimal 6 karakter.' });
    update('users', saya.id, { password_hash: hashPassword(baru), updated_at: nowIso() });
    logAudit({ user: req.user, aksi: 'pengguna.ganti_sandi_sendiri', entitas: 'users', entitasId: saya.id });
    res.json({ ok: true });
  }),
);

router.delete(
  '/pengguna/:id',
  ...adminOnly,
  asyncHandler((req, res) => {
    const id = toInt(req.params.id, -1);
    const db = getDb();
    const ada = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!ada) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    if (id === req.user.id) return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri.' });
    if (ada.role === 'admin' && hitungAdminAktif(id) === 0) {
      return res.status(400).json({ error: 'Tidak bisa menghapus Admin aktif terakhir.' });
    }
    const dipakai = db.prepare('SELECT COUNT(*) AS c FROM transaksi WHERE petugas_id = ?').get(id).c;
    if (dipakai > 0) {
      update('users', id, { aktif: 0, updated_at: nowIso(), updated_by: req.user.id });
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      logAudit({ user: req.user, aksi: 'pengguna.nonaktif', entitas: 'users', entitasId: id });
      return res.json({
        ok: true,
        mode: 'nonaktif',
        pesan: `Pengguna ${ada.nama} dinonaktifkan karena memiliki ${dipakai} riwayat transaksi.`,
      });
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    logAudit({ user: req.user, aksi: 'pengguna.hapus', entitas: 'users', entitasId: id, detail: ada.username });
    res.json({ ok: true, mode: 'hapus', pesan: `Pengguna ${ada.nama} dihapus.` });
  }),
);

// ---------------------------------------------------------------------------
// Catatan aktivitas
// ---------------------------------------------------------------------------

router.get(
  '/audit',
  ...adminOnly,
  asyncHandler((req, res) => {
    res.json({ data: listAudit(req.query.limit) });
  }),
);

// ---------------------------------------------------------------------------
// Pengaturan
// ---------------------------------------------------------------------------

router.get(
  '/pengaturan',
  ...adminOnly,
  asyncHandler((req, res) => {
    res.json({
      pengaturan: {
        nama_event: getSetting('nama_event', 'Event'),
        jeda_duplikat_detik: Number(getSetting('jeda_duplikat_detik', '5')),
      },
    });
  }),
);

router.put(
  '/pengaturan',
  ...adminOnly,
  asyncHandler((req, res) => {
    const errors = [];
    const body = req.body || {};
    if (body.nama_event !== undefined) {
      const v = trimOrNull(body.nama_event);
      if (!v) errors.push('Nama event tidak boleh kosong.');
      else setSetting('nama_event', v.slice(0, 120), req.user.id);
    }
    if (body.jeda_duplikat_detik !== undefined) {
      const n = Number(body.jeda_duplikat_detik);
      if (!Number.isInteger(n) || n < 0 || n > 300) {
        errors.push('Jeda anti-duplikat harus angka bulat 0-300 detik (0 = nonaktif).');
      } else setSetting('jeda_duplikat_detik', n, req.user.id);
    }
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    logAudit({ user: req.user, aksi: 'pengaturan.ubah', entitas: 'pengaturan', detail: body });
    res.json({ ok: true });
  }),
);

module.exports = router;
