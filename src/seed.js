'use strict';

/**
 * Data awal aplikasi.
 *
 * - ensureSeed(): wajib, dijalankan setiap start. Membuat pengguna bawaan,
 *   daftar jenis transaksi event, dan pengaturan dasar (idempoten).
 * - seedContoh(): data contoh peserta + transaksi agar alur bisa langsung dicoba.
 *
 * Jalankan `npm run seed` untuk memaksa penambahan data contoh.
 */

const { getDb, insert, setSetting } = require('./db');
const { hashPassword } = require('./auth');
const { generateKodeBarcode } = require('./barcode');

const JENIS_DEFAULT = [
  { kode: 'PARKIR', nama: 'Parkir', batas_default: 1, urutan: 1 },
  { kode: 'ARENA', nama: 'Masuk Arena', batas_default: 1, urutan: 2 },
  { kode: 'SNACK_PAGI', nama: 'Snack Pagi', batas_default: 1, urutan: 3 },
  { kode: 'MAKAN_SIANG', nama: 'Makan Siang', batas_default: 1, urutan: 4 },
  { kode: 'ESKRIM', nama: 'Es Krim', batas_default: 1, urutan: 5 },
  { kode: 'BAKSO', nama: 'Bakso/Coto', batas_default: 1, urutan: 6 },
  { kode: 'DOORPRIZE', nama: 'Kupon Doorprize', batas_default: 1, urutan: 7 },
];

const PESERTA_CONTOH = [
  ['25001', 'Siti Aminah', 'VIP', '0812-3456-7890'],
  ['25002', 'Budi Santoso', 'Reguler', '0813-1111-2222'],
  ['25003', 'Rizky Pratama', 'Reguler', '0857-2222-3333'],
  ['25004', 'Dewi Lestari', 'VIP', '0812-9999-8888'],
  ['25005', 'Ahmad Fauzi', 'Reguler', '0878-4444-5555'],
  ['25006', 'Nur Hidayah', 'Panitia', '0811-7777-6666'],
  ['25007', 'Eko Wibowo', 'Reguler', '0819-3333-4444'],
  ['25008', 'Maya Sari', 'VIP', '0877-5555-1111'],
  ['25009', 'Hendra Gunawan', 'Reguler', '0856-8888-2222'],
  ['25010', 'Putri Amelia', 'Reguler', '0812-1212-3434'],
  ['25011', 'Joko Susilo', 'Panitia', '0813-5656-7878'],
  ['25012', 'Kartika Dewi', 'Reguler', '0878-9090-1212'],
];

function ensureSeed() {
  const db = getDb();
  const waktu = new Date().toISOString();

  // 1. Pengguna bawaan
  const jmlUser = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (jmlUser === 0) {
    insert('users', {
      username: 'admin',
      nama: 'Administrator Event',
      role: 'admin',
      password_hash: hashPassword('admin123'),
      aktif: 1,
      created_at: waktu,
      updated_at: waktu,
    });
    insert('users', {
      username: 'petugas',
      nama: 'Petugas Lapangan',
      role: 'petugas',
      password_hash: hashPassword('petugas123'),
      aktif: 1,
      created_at: waktu,
      updated_at: waktu,
    });
  }

  // 2. Jenis transaksi
  const adaJenis = db.prepare('SELECT kode FROM jenis_transaksi WHERE kode = ?');
  for (const j of JENIS_DEFAULT) {
    if (!adaJenis.get(j.kode)) {
      insert('jenis_transaksi', { ...j, aktif: 1, updated_at: waktu });
    }
  }

  // 3. Pengaturan dasar
  if (!db.prepare('SELECT 1 AS x FROM pengaturan WHERE kunci = ?').get('nama_event')) {
    setSetting('nama_event', 'Event Contoh 2026');
  }
  if (!db.prepare('SELECT 1 AS x FROM pengaturan WHERE kunci = ?').get('jeda_duplikat_detik')) {
    setSetting('jeda_duplikat_detik', 5);
  }
}

/** Tambahkan data contoh (peserta + transaksi) bila belum ada. */
function seedContoh({ force = false } = {}) {
  ensureSeed();
  const db = getDb();

  const jml = db.prepare('SELECT COUNT(*) AS c FROM peserta').get().c;
  if (jml > 0 && !force) return { ditambahkan: 0, dilewati: true };

  const waktu = new Date().toISOString();
  const kodeTaken = db.prepare('SELECT 1 AS x FROM peserta WHERE kode_barcode = ?');
  const adaNomor = db.prepare('SELECT * FROM peserta WHERE nomor_peserta = ?');
  let ditambahkan = 0;

  const simpanPeserta = db.transaction(([nomor, nama, kategori, kontak]) => {
    if (adaNomor.get(nomor)) return;
    insert('peserta', {
      nomor_peserta: nomor,
      nama,
      kategori,
      kontak,
      kode_barcode: generateKodeBarcode(nomor, (k) => !!kodeTaken.get(k)),
      aktif: 1,
      created_at: waktu,
      updated_at: waktu,
    });
    ditambahkan += 1;
  });
  PESERTA_CONTOH.forEach((p) => simpanPeserta.immediate(p));

  // Contoh kuota khusus: Rizky dapat 2 porsi makan siang, Maya 0 es krim.
  const rizky = adaNomor.get('25003');
  const maya = adaNomor.get('25008');
  const jenis = Object.fromEntries(
    db.prepare('SELECT id, kode FROM jenis_transaksi').all().map((j) => [j.kode, j.id]),
  );
  const setKuota = db.prepare(
    `INSERT INTO kuota_peserta (peserta_id, jenis_id, batas, updated_at)
     VALUES (?, ?, ?, ?) ON CONFLICT(peserta_id, jenis_id) DO UPDATE SET batas = excluded.batas`,
  );
  if (rizky && jenis.MAKAN_SIANG) setKuota.run(rizky.id, jenis.MAKAN_SIANG, 2, waktu);
  if (maya && jenis.ESKRIM) setKuota.run(maya.id, jenis.ESKRIM, 0, waktu);

  seedContohTransaksi();
  return { ditambahkan, dilewati: false };
}

/** Beberapa transaksi contoh supaya halaman riwayat & laporan langsung terisi. */
function seedContohTransaksi() {
  const db = getDb();
  // Hindari transaksi contoh ganda bila sudah pernah diisi.
  if (db.prepare('SELECT COUNT(*) AS c FROM transaksi').get().c > 0) return;

  const petugas = db.prepare("SELECT * FROM users WHERE role = 'petugas' LIMIT 1").get();
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  const jenisByKode = Object.fromEntries(
    db.prepare('SELECT * FROM jenis_transaksi').all().map((j) => [j.kode, j]),
  );

  // [nomor peserta, kode jenis, berapa kali, petugas, selisih menit dari sekarang]
  const rencana = [
    ['25001', 'PARKIR', 1, petugas, 95],
    ['25001', 'ARENA', 1, petugas, 90],
    ['25001', 'SNACK_PAGI', 1, petugas, 88],
    ['25001', 'MAKAN_SIANG', 1, admin, 40],
    ['25002', 'PARKIR', 1, petugas, 92],
    ['25002', 'ARENA', 1, petugas, 80],
    ['25002', 'MAKAN_SIANG', 1, petugas, 35],
    ['25003', 'ARENA', 1, petugas, 75],
    ['25003', 'MAKAN_SIANG', 2, petugas, 30],
    ['25004', 'PARKIR', 1, petugas, 70],
    ['25004', 'ARENA', 1, petugas, 68],
    ['25004', 'ESKRIM', 1, admin, 20],
    ['25005', 'ARENA', 1, petugas, 60],
    ['25006', 'ARENA', 1, petugas, 55],
    ['25006', 'BAKSO', 1, petugas, 15],
    ['25007', 'ARENA', 1, petugas, 50],
    ['25008', 'ARENA', 1, petugas, 45],
    ['25008', 'DOORPRIZE', 1, admin, 12],
    ['25009', 'PARKIR', 1, petugas, 44],
    ['25010', 'ARENA', 1, petugas, 25],
  ];

  const simpan = db.transaction(() => {
    const urutTerpakai = new Map();
    for (const [nomor, kodeJenis, kali, petugasnya, menitLalu] of rencana) {
      const peserta = db.prepare('SELECT * FROM peserta WHERE nomor_peserta = ?').get(nomor);
      const jenis = jenisByKode[kodeJenis];
      if (!peserta || !jenis) continue;
      const ov = db
        .prepare('SELECT batas FROM kuota_peserta WHERE peserta_id = ? AND jenis_id = ?')
        .get(peserta.id, jenis.id);
      const batas = ov ? ov.batas : jenis.batas_default;
      const key = `${peserta.id}:${jenis.id}`;
      let mulai = urutTerpakai.get(key) ?? 0;
      for (let i = 0; i < kali && mulai + i < batas; i += 1) {
        const urutanKe = mulai + i + 1;
        insert('transaksi', {
          status: 'berhasil',
          alasan: null,
          waktu: new Date(Date.now() - menitLalu * 60_000 - i * 1000).toISOString(),
          jenis_id: jenis.id,
          jenis_nama: jenis.nama,
          peserta_id: peserta.id,
          nomor_peserta: peserta.nomor_peserta,
          nama_peserta: peserta.nama,
          kategori: peserta.kategori,
          kode_barcode: peserta.kode_barcode,
          batas,
          urutan_ke: urutanKe,
          sisa_setelah: batas - urutanKe,
          petugas_id: petugasnya.id,
          petugas_nama: petugasnya.nama,
          petugas_role: petugasnya.role,
        });
      }
      urutTerpakai.set(key, mulai + kali);
    }
  });
  simpan.immediate();
}

if (require.main === module) {
  const force = process.argv.includes('--force');
  ensureSeed();
  const hasil = force ? seedContoh({ force: true }) : seedContoh();
  const db = getDb();
  console.log('Seed selesai.');
  console.log('  Pengguna   :', db.prepare('SELECT COUNT(*) AS c FROM users').get().c);
  console.log('  Peserta    :', db.prepare('SELECT COUNT(*) AS c FROM peserta').get().c);
  console.log('  Transaksi  :', db.prepare('SELECT COUNT(*) AS c FROM transaksi').get().c);
  console.log('  Login      : admin/admin123 (Admin), petugas/petugas123 (Petugas)');
}

module.exports = { ensureSeed, seedContoh, JENIS_DEFAULT, PESERTA_CONTOH };
