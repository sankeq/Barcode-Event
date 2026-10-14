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

const { query, insert, setSetting, getConnection } = require('./db');
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

/** Buat kode barcode unik via pool query (dipakai saat seeding). */
async function buatKodeUnik(nomor) {
  for (let i = 0; i < 25; i += 1) {
    const kode = generateKodeBarcode(nomor, () => false);
    const rows = await query('SELECT 1 AS x FROM peserta WHERE kode_barcode = ? LIMIT 1', [kode]);
    if (!rows.length) return kode;
  }
  return generateKodeBarcode(`${nomor}-${Date.now()}`, () => false);
}

async function ensureSeed() {
  const waktu = new Date().toISOString();

  // 1. Pengguna bawaan
  const jmlUser = (await query('SELECT COUNT(*) AS c FROM users'))[0].c;
  if (jmlUser === 0) {
    await insert('users', {
      username: 'admin',
      nama: 'Administrator Event',
      role: 'admin',
      password_hash: hashPassword('admin123'),
      aktif: 1,
      created_at: waktu,
      updated_at: waktu,
    });
    await insert('users', {
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
  for (const j of JENIS_DEFAULT) {
    const ada = await query('SELECT kode FROM jenis_transaksi WHERE kode = ?', [j.kode]);
    if (!ada.length) {
      await insert('jenis_transaksi', { ...j, aktif: 1, updated_at: waktu });
    }
  }

  // 3. Pengaturan dasar
  const adaNamaEvent = await query('SELECT 1 AS x FROM pengaturan WHERE kunci = ?', ['nama_event']);
  if (!adaNamaEvent.length) {
    await setSetting('nama_event', 'Event Contoh 2026');
  }
  const adaJeda = await query('SELECT 1 AS x FROM pengaturan WHERE kunci = ?', ['jeda_duplikat_detik']);
  if (!adaJeda.length) {
    await setSetting('jeda_duplikat_detik', 5);
  }
}

/** Tambahkan data contoh (peserta + transaksi) bila belum ada. */
async function seedContoh({ force = false } = {}) {
  await ensureSeed();

  const jml = (await query('SELECT COUNT(*) AS c FROM peserta'))[0].c;
  if (jml > 0 && !force) return { ditambahkan: 0, dilewati: true };

  const waktu = new Date().toISOString();
  let ditambahkan = 0;

  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    for (const [nomor, nama, kategori, kontak] of PESERTA_CONTOH) {
      const [ada] = await conn.query('SELECT id FROM peserta WHERE nomor_peserta = ? LIMIT 1', [nomor]);
      if (ada.length) continue;
      const kode = await buatKodeUnik(nomor);
      await conn.query(
        `INSERT INTO peserta
          (nomor_peserta, nama, kategori, kontak, kode_barcode, aktif, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        [nomor, nama, kategori, kontak, kode, waktu, waktu],
      );
      ditambahkan += 1;
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
  conn.release();

  // Contoh kuota khusus: Rizky dapat 2 porsi makan siang, Maya 0 es krim.
  const rizky = (await query('SELECT id FROM peserta WHERE nomor_peserta = ?', ['25003']))[0];
  const maya = (await query('SELECT id FROM peserta WHERE nomor_peserta = ?', ['25008']))[0];
  const jenis = Object.fromEntries(
    (await query('SELECT id, kode FROM jenis_transaksi')).map((j) => [j.kode, j.id]),
  );
  const UPSERT_KUOTA =
    `INSERT INTO kuota_peserta (peserta_id, jenis_id, batas, updated_at)
     VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE batas = VALUES(batas)`;
  if (rizky && jenis.MAKAN_SIANG) await query(UPSERT_KUOTA, [rizky.id, jenis.MAKAN_SIANG, 2, waktu]);
  if (maya && jenis.ESKRIM) await query(UPSERT_KUOTA, [maya.id, jenis.ESKRIM, 0, waktu]);

  await seedContohTransaksi();
  return { ditambahkan, dilewati: false };
}

/** Beberapa transaksi contoh supaya halaman riwayat & laporan langsung terisi. */
async function seedContohTransaksi() {
  // Hindari transaksi contoh ganda bila sudah pernah diisi.
  if ((await query('SELECT COUNT(*) AS c FROM transaksi'))[0].c > 0) return;

  const petugas = (await query("SELECT * FROM users WHERE role = 'petugas' LIMIT 1"))[0];
  const admin = (await query("SELECT * FROM users WHERE role = 'admin' LIMIT 1"))[0];
  const jenisByKode = Object.fromEntries(
    (await query('SELECT * FROM jenis_transaksi')).map((j) => [j.kode, j]),
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

  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const urutTerpakai = new Map();
    for (const [nomor, kodeJenis, kali, petugasnya, menitLalu] of rencana) {
      const [pesertaRows] = await conn.query('SELECT * FROM peserta WHERE nomor_peserta = ? LIMIT 1', [nomor]);
      const peserta = pesertaRows[0];
      const jenis = jenisByKode[kodeJenis];
      if (!peserta || !jenis) continue;
      const [ovRows] = await conn.query(
        'SELECT batas FROM kuota_peserta WHERE peserta_id = ? AND jenis_id = ?',
        [peserta.id, jenis.id],
      );
      const batas = ovRows.length ? ovRows[0].batas : jenis.batas_default;
      const key = `${peserta.id}:${jenis.id}`;
      const mulai = urutTerpakai.get(key) ?? 0;
      for (let i = 0; i < kali && mulai + i < batas; i += 1) {
        const urutanKe = mulai + i + 1;
        await conn.query(
          `INSERT INTO transaksi
            (status, alasan, waktu, jenis_id, jenis_nama, peserta_id, nomor_peserta,
             nama_peserta, kategori, kode_barcode, batas, urutan_ke, sisa_setelah,
             petugas_id, petugas_nama, petugas_role)
           VALUES ('berhasil', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            new Date(Date.now() - menitLalu * 60_000 - i * 1000).toISOString(),
            jenis.id,
            jenis.nama,
            peserta.id,
            peserta.nomor_peserta,
            peserta.nama,
            peserta.kategori,
            peserta.kode_barcode,
            batas,
            urutanKe,
            batas - urutanKe,
            petugasnya.id,
            petugasnya.nama,
            petugasnya.role,
          ],
        );
      }
      urutTerpakai.set(key, mulai + kali);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
  conn.release();
}

if (require.main === module) {
  (async () => {
    await require('./db').initDb();
    const force = process.argv.includes('--force');
    await ensureSeed();
    await (force ? seedContoh({ force: true }) : seedContoh());
    console.log('Seed selesai.');
    console.log('  Pengguna   :', (await query('SELECT COUNT(*) AS c FROM users'))[0].c);
    console.log('  Peserta    :', (await query('SELECT COUNT(*) AS c FROM peserta'))[0].c);
    console.log('  Transaksi  :', (await query('SELECT COUNT(*) AS c FROM transaksi'))[0].c);
    console.log('  Login      : admin/admin123 (Admin), petugas/petugas123 (Petugas)');
    process.exit(0);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { ensureSeed, seedContoh, JENIS_DEFAULT, PESERTA_CONTOH };
