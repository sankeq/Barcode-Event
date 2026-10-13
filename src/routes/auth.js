'use strict';

/** Rute autentikasi: masuk, keluar, dan info sesi aktif. */

const express = require('express');
const { getDb } = require('../db');
const {
  verifyPassword,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  userFromRequest,
  loginLockRemaining,
  noteLoginFailure,
  clearLoginFailures,
} = require('../auth');
const { logAudit } = require('../audit');
const { asyncHandler } = require('../util');

const router = express.Router();

router.post(
  '/login',
  asyncHandler((req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!username || !password) {
      return res.status(400).json({ error: 'Nama pengguna dan kata sandi wajib diisi.' });
    }

    const kunci = `${username.toLowerCase()}|${req.ip}`;
    const terkunciMs = loginLockRemaining(kunci);
    if (terkunciMs > 0) {
      return res.status(429).json({
        error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil(terkunciMs / 1000)} detik.`,
      });
    }

    const user = getDb()
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
      .get(username);

    if (!user || !verifyPassword(password, user.password_hash)) {
      noteLoginFailure(kunci);
      return res.status(401).json({ error: 'Nama pengguna atau kata sandi salah.' });
    }
    if (!user.aktif) {
      return res.status(403).json({ error: 'Akun ini dinonaktifkan. Hubungi Admin.' });
    }

    clearLoginFailures(kunci);
    const { token, expires } = createSession(user.id, req.headers['user-agent']);
    setSessionCookie(res, token, expires);
    logAudit({
      user: { id: user.id, nama: user.nama, username: user.username },
      aksi: 'login',
      entitas: 'users',
      entitasId: user.id,
    });
    res.json({
      user: { id: user.id, username: user.username, nama: user.nama, role: user.role },
    });
  }),
);

router.post(
  '/logout',
  asyncHandler((req, res) => {
    const user = userFromRequest(req);
    if (user) {
      destroySession(user.token);
      logAudit({ user, aksi: 'logout', entitas: 'users', entitasId: user.id });
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

router.get(
  '/me',
  asyncHandler((req, res) => {
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Belum masuk.' });
    const { token, ...bersih } = user;
    res.json({ user: bersih });
  }),
);

module.exports = router;
