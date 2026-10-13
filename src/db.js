'use strict';

/**
 * Lapisan database: koneksi SQLite, skema, dan helper transaksi.
 *
 * Menggunakan better-sqlite3 (sinkron) sehingga setiap transaksi berjalan
 * atomik pada satu proses. Untuk transaksi pemindaian kita memakai
 * BEGIN IMMEDIATE (.immediate()) agar kuota tidak bisa terlampaui meskipun
 * ada banyak permintaan bersamaan atau beberapa proses menulis ke DB yang sama.
 */

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(ROOT, 'data', 'event.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  nama          TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK (role IN ('admin','petugas')),
  password_hash TEXT    NOT NULL,
  aktif         INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  updated_by    INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS peserta (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nomor_peserta TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  nama          TEXT    NOT NULL,
  kategori      TEXT,
  kontak        TEXT,
  kode_barcode  TEXT    NOT NULL UNIQUE,
  aktif         INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  created_by    INTEGER,
  updated_by    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_peserta_nama ON peserta(nama);

CREATE TABLE IF NOT EXISTS jenis_transaksi (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kode          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  nama          TEXT    NOT NULL,
  batas_default INTEGER NOT NULL DEFAULT 1 CHECK (batas_default >= 0),
  urutan        INTEGER NOT NULL DEFAULT 0,
  aktif         INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT    NOT NULL,
  updated_by    INTEGER
);

-- Batas khusus per peserta (override). Bila tidak ada baris di sini,
-- batas_default dari jenis_transaksi yang dipakai.
CREATE TABLE IF NOT EXISTS kuota_peserta (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  peserta_id INTEGER NOT NULL REFERENCES peserta(id) ON DELETE CASCADE,
  jenis_id   INTEGER NOT NULL REFERENCES jenis_transaksi(id) ON DELETE CASCADE,
  batas      INTEGER NOT NULL CHECK (batas >= 0),
  updated_at TEXT    NOT NULL,
  updated_by INTEGER,
  UNIQUE (peserta_id, jenis_id)
);

-- Riwayat semua percobaan pemindaian (berhasil / ditolak / ganda).
CREATE TABLE IF NOT EXISTS transaksi (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  status         TEXT    NOT NULL CHECK (status IN ('berhasil','ditolak','ganda')),
  alasan         TEXT,
  waktu          TEXT    NOT NULL,
  jenis_id       INTEGER NOT NULL REFERENCES jenis_transaksi(id),
  jenis_nama     TEXT    NOT NULL,
  peserta_id     INTEGER REFERENCES peserta(id),
  nomor_peserta  TEXT,
  nama_peserta   TEXT,
  kode_barcode   TEXT    NOT NULL,
  kategori       TEXT,
  batas          INTEGER,
  urutan_ke      INTEGER,
  sisa_setelah   INTEGER,
  petugas_id     INTEGER NOT NULL,
  petugas_nama   TEXT    NOT NULL,
  petugas_role   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trx_waktu      ON transaksi(waktu DESC);
CREATE INDEX IF NOT EXISTS idx_trx_peserta    ON transaksi(peserta_id);
CREATE INDEX IF NOT EXISTS idx_trx_jenis      ON transaksi(jenis_id);
CREATE INDEX IF NOT EXISTS idx_trx_status     ON transaksi(status);
CREATE INDEX IF NOT EXISTS idx_trx_kuota      ON transaksi(peserta_id, jenis_id, status, waktu);
CREATE INDEX IF NOT EXISTS idx_trx_barcode    ON transaksi(kode_barcode);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  waktu      TEXT    NOT NULL,
  user_id    INTEGER,
  user_nama  TEXT,
  aksi       TEXT    NOT NULL,
  entitas    TEXT,
  entitas_id TEXT,
  detail     TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_waktu ON audit_log(waktu DESC);

CREATE TABLE IF NOT EXISTS pengaturan (
  kunci      TEXT PRIMARY KEY,
  nilai      TEXT NOT NULL,
  updated_at TEXT,
  updated_by INTEGER
);
`;

let db = null;

function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 8000');
  db.exec(SCHEMA);
  return db;
}

/** Insert / update cepat dengan nama kolom eksplisit. */
function insert(table, data) {
  const d = getDb();
  const cols = Object.keys(data);
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  const info = d.prepare(sql).run(...cols.map((c) => data[c]));
  return info.lastInsertRowid;
}

function update(table, id, data) {
  const d = getDb();
  const cols = Object.keys(data);
  const sql = `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
  return d.prepare(sql).run(...cols.map((c) => data[c]), id);
}

/** Baca pengaturan dengan fallback nilai bawaan. */
function getSetting(key, fallback = null) {
  const row = getDb().prepare('SELECT nilai FROM pengaturan WHERE kunci = ?').get(key);
  return row ? row.nilai : fallback;
}

function setSetting(key, value, userId = null) {
  getDb()
    .prepare(
      `INSERT INTO pengaturan (kunci, nilai, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .run(key, String(value), new Date().toISOString(), userId);
}

function getNumberSetting(key, fallback) {
  const raw = getSetting(key, null);
  if (raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  DB_PATH,
  ROOT,
  getDb,
  insert,
  update,
  getSetting,
  setSetting,
  getNumberSetting,
};
