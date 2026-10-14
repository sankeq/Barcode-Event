'use strict';

/**
 * Lapisan database: koneksi MySQL (mysql2/promise), skema, dan helper async.
 *
 * Memakai satu connection pool (lazy) ke database event_barcode. Semua helper
 * bersifat async karena mysql2/promise mengembalikan Promise. Untuk transaksi
 * pemindaian berkuota, pakai getConnection() lalu beginTransaction + SELECT
 * ... FOR UPDATE pada satu koneksi (FEAT-002) agar kuota tidak terlampaui
 * meskipun ada banyak permintaan bersamaan.
 */

const path = require('node:path');
const mysql = require('mysql2/promise');

const ROOT = path.join(__dirname, '..');

/**
 * Baca konfigurasi koneksi dari process.env. Bila DATABASE_URL ada, ia
 * di-parse (new URL) dan menang atas variabel individual.
 */
function bacaConfig() {
  const cfg = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'event_barcode',
  };

  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    if (u.hostname) cfg.host = u.hostname;
    if (u.port) cfg.port = Number(u.port);
    if (u.username) cfg.user = decodeURIComponent(u.username);
    // Password bisa kosong secara sengaja, jadi cek keberadaannya saja.
    if (u.password !== '') cfg.password = decodeURIComponent(u.password);
    const nama = u.pathname.replace(/^\//, '');
    if (nama) cfg.database = nama;
  }

  return cfg;
}

const CONFIG = bacaConfig();

// Skema penuh (port InnoDB dari SQLite). Setiap pernyataan dijalankan satu per
// satu oleh initDb(). Semua index didefinisikan INLINE di dalam CREATE TABLE.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(190) NOT NULL COLLATE utf8mb4_unicode_ci,
    nama          VARCHAR(255) NOT NULL,
    role          VARCHAR(20)  NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    aktif         TINYINT(1)   NOT NULL DEFAULT 1,
    created_at    VARCHAR(40)  NOT NULL,
    updated_at    VARCHAR(40)  NOT NULL,
    updated_by    INT,
    UNIQUE KEY uq_users_username (username),
    CHECK (role IN ('admin','petugas'))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS sessions (
    token      VARCHAR(190) NOT NULL,
    user_id    INT          NOT NULL,
    created_at VARCHAR(40)  NOT NULL,
    expires_at VARCHAR(40)  NOT NULL,
    user_agent VARCHAR(255),
    PRIMARY KEY (token),
    KEY idx_sessions_user (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS peserta (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    nomor_peserta VARCHAR(190) NOT NULL COLLATE utf8mb4_unicode_ci,
    nama          VARCHAR(255) NOT NULL,
    kategori      VARCHAR(255),
    kontak        VARCHAR(255),
    kode_barcode  VARCHAR(190) NOT NULL COLLATE utf8mb4_unicode_ci,
    aktif         TINYINT(1)   NOT NULL DEFAULT 1,
    created_at    VARCHAR(40)  NOT NULL,
    updated_at    VARCHAR(40)  NOT NULL,
    created_by    INT,
    updated_by    INT,
    UNIQUE KEY uq_peserta_nomor (nomor_peserta),
    UNIQUE KEY uq_peserta_barcode (kode_barcode),
    KEY idx_peserta_nama (nama)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS jenis_transaksi (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    kode          VARCHAR(190) NOT NULL COLLATE utf8mb4_unicode_ci,
    nama          VARCHAR(255) NOT NULL,
    batas_default INT          NOT NULL DEFAULT 1,
    urutan        INT          NOT NULL DEFAULT 0,
    aktif         TINYINT(1)   NOT NULL DEFAULT 1,
    updated_at    VARCHAR(40)  NOT NULL,
    updated_by    INT,
    UNIQUE KEY uq_jenis_kode (kode),
    CHECK (batas_default >= 0)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // Batas khusus per peserta (override). Bila tidak ada baris di sini,
  // batas_default dari jenis_transaksi yang dipakai.
  `CREATE TABLE IF NOT EXISTS kuota_peserta (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    peserta_id INT         NOT NULL,
    jenis_id   INT         NOT NULL,
    batas      INT         NOT NULL,
    updated_at VARCHAR(40) NOT NULL,
    updated_by INT,
    UNIQUE KEY uq_kuota_peserta_jenis (peserta_id, jenis_id),
    FOREIGN KEY (peserta_id) REFERENCES peserta(id) ON DELETE CASCADE,
    FOREIGN KEY (jenis_id) REFERENCES jenis_transaksi(id) ON DELETE CASCADE,
    CHECK (batas >= 0)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // Riwayat semua percobaan pemindaian (berhasil / ditolak / ganda).
  `CREATE TABLE IF NOT EXISTS transaksi (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    status         VARCHAR(20)  NOT NULL,
    alasan         VARCHAR(255),
    waktu          VARCHAR(40)  NOT NULL,
    jenis_id       INT          NOT NULL,
    jenis_nama     VARCHAR(255) NOT NULL,
    peserta_id     INT,
    nomor_peserta  VARCHAR(190),
    nama_peserta   VARCHAR(255),
    kode_barcode   VARCHAR(190) NOT NULL,
    kategori       VARCHAR(255),
    batas          INT,
    urutan_ke      INT,
    sisa_setelah   INT,
    petugas_id     INT          NOT NULL,
    petugas_nama   VARCHAR(255) NOT NULL,
    petugas_role   VARCHAR(20)  NOT NULL,
    KEY idx_trx_waktu   (waktu),
    KEY idx_trx_peserta (peserta_id),
    KEY idx_trx_jenis   (jenis_id),
    KEY idx_trx_status  (status),
    KEY idx_trx_kuota   (peserta_id, jenis_id, status, waktu),
    KEY idx_trx_barcode (kode_barcode),
    FOREIGN KEY (jenis_id) REFERENCES jenis_transaksi(id),
    FOREIGN KEY (peserta_id) REFERENCES peserta(id),
    CHECK (status IN ('berhasil','ditolak','ganda'))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS audit_log (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    waktu      VARCHAR(40)  NOT NULL,
    user_id    INT,
    user_nama  VARCHAR(255),
    aksi       VARCHAR(100) NOT NULL,
    entitas    VARCHAR(100),
    entitas_id VARCHAR(100),
    detail     TEXT,
    KEY idx_audit_waktu (waktu)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS pengaturan (
    kunci      VARCHAR(190) NOT NULL,
    nilai      TEXT         NOT NULL,
    updated_at VARCHAR(40),
    updated_by INT,
    PRIMARY KEY (kunci)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

let pool = null;

/** Mengembalikan (atau membuat secara lazy) pool ke database event_barcode. */
function getPool() {
  if (pool) return pool;
  pool = mysql.createPool({
    host: CONFIG.host,
    port: CONFIG.port,
    user: CONFIG.user,
    password: CONFIG.password,
    database: CONFIG.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
  });
  return pool;
}

/**
 * Siapkan database & semua tabel. Idempoten (aman dipanggil berkali-kali):
 * CREATE DATABASE/TABLE memakai IF NOT EXISTS.
 */
async function initDb() {
  // (1) Koneksi sementara TANPA opsi database untuk membuat database bila
  // belum ada, lalu ditutup.
  const bootstrap = await mysql.createConnection({
    host: CONFIG.host,
    port: CONFIG.port,
    user: CONFIG.user,
    password: CONFIG.password,
    charset: 'utf8mb4',
  });
  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${CONFIG.database}\` ` +
        'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
    );
  } finally {
    await bootstrap.end();
  }

  // (2) Pool ke database target, lalu (3) jalankan tiap CREATE TABLE.
  const p = getPool();
  for (const stmt of SCHEMA) {
    await p.query(stmt);
  }
}

/** Jalankan query SELECT/umum dan kembalikan baris. */
async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

/** Insert cepat dengan nama kolom eksplisit; kembalikan insertId. */
async function insert(table, data) {
  const cols = Object.keys(data);
  const sql = `INSERT INTO \`${table}\` (${cols.join(', ')}) VALUES (${cols
    .map(() => '?')
    .join(', ')})`;
  const [res] = await getPool().query(sql, cols.map((c) => data[c]));
  return res.insertId;
}

/** Update by id; kembalikan jumlah baris terpengaruh. */
async function update(table, id, data) {
  const cols = Object.keys(data);
  const sql = `UPDATE \`${table}\` SET ${cols
    .map((c) => `${c} = ?`)
    .join(', ')} WHERE id = ?`;
  const [res] = await getPool().query(sql, [...cols.map((c) => data[c]), id]);
  return res.affectedRows;
}

/** Baca pengaturan dengan fallback nilai bawaan. */
async function getSetting(key, fallback = null) {
  const rows = await query('SELECT nilai FROM pengaturan WHERE kunci = ?', [key]);
  return rows.length ? rows[0].nilai : fallback;
}

async function setSetting(key, value, userId = null) {
  await getPool().query(
    `INSERT INTO pengaturan (kunci, nilai, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE nilai = VALUES(nilai),
       updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)`,
    [key, String(value), new Date().toISOString(), userId],
  );
}

async function getNumberSetting(key, fallback) {
  const raw = await getSetting(key, null);
  if (raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Ambil satu koneksi dari pool untuk transaksi row-lock (FOR UPDATE).
 * Pemanggil wajib conn.release() setelah commit/rollback.
 */
function getConnection() {
  return getPool().getConnection();
}

/**
 * Kompatibilitas nama lama: getDb() kini async dan mengembalikan pool
 * mysql2/promise (bukan lagi instance better-sqlite3 sinkron).
 */
async function getDb() {
  return getPool();
}

module.exports = {
  ROOT,
  // DB_PATH khusus SQLite dipertahankan sebagai null demi kompatibilitas impor.
  DB_PATH: null,
  getDb,
  initDb,
  query,
  insert,
  update,
  getSetting,
  setSetting,
  getNumberSetting,
  getConnection,
  getPool,
};
