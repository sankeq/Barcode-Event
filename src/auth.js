'use strict';

/**
 * Autentikasi + otorisasi.
 *
 * - Kata sandi disimpan sebagai scrypt hash (salt acak per pengguna).
 * - Sesi disimpan di tabel `sessions`, token acak 32 byte, dikirim via cookie httpOnly.
 * - Peran: 'admin' (semua akses) dan 'petugas' (hanya pemindaian + info transaksi).
 */

const crypto = require('node:crypto');
const { getDb, insert } = require('./db');

const COOKIE_NAME = 'sesi';
const SESSION_HOURS = 12;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltB64, keyB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function createSession(userId, userAgent) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 3600 * 1000);
  insert('sessions', {
    token,
    user_id: userId,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    user_agent: (userAgent || '').slice(0, 200),
  });
  return { token, expires };
}

function destroySession(token) {
  if (!token) return;
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/** Ambil pengguna dari sesi; null bila tidak ada / kedaluwarsa / nonaktif. */
function userFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT s.token, s.expires_at, u.id, u.username, u.nama, u.role, u.aktif
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`,
    )
    .get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now() || !row.aktif) {
    destroySession(token);
    return null;
  }
  return { token, id: row.id, username: row.username, nama: row.nama, role: row.role };
}

function setSessionCookie(res, token, expires) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expires.toUTCString()}`,
  ];
  if (process.env.COOKIE_SECURE === '1') parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function requireAuth(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Sesi tidak valid. Silakan masuk kembali.' });
  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sesi tidak valid.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Akses ditolak. Menu ini hanya untuk Admin.' });
    }
    next();
  };
}

/** Batas percobaan login sederhana per username+IP. */
const loginAttempts = new Map();
const MAX_ATTEMPTS = 8;
const LOCK_MS = 60_000;

function loginLockRemaining(key) {
  const rec = loginAttempts.get(key);
  if (!rec) return 0;
  const left = rec.until - Date.now();
  if (left <= 0) {
    loginAttempts.delete(key);
    return 0;
  }
  return left;
}

function noteLoginFailure(key) {
  const rec = loginAttempts.get(key) || { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.until = Date.now() + LOCK_MS;
    rec.count = 0;
  }
  loginAttempts.set(key, rec);
}

function clearLoginFailures(key) {
  loginAttempts.delete(key);
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  userFromRequest,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireRole,
  loginLockRemaining,
  noteLoginFailure,
  clearLoginFailures,
};
