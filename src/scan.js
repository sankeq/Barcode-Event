'use strict';

/**
 * Mesin pemindaian: satu-satunya tempat kuota peserta boleh bertambah.
 *
 * Seluruh pemeriksaan (peserta terdaftar -> deteksi pemindaian ganda ->
 * cek sisa kuota -> pencatatan) dijalankan di dalam SATU transaksi InnoDB
 * memakai satu koneksi dari pool: beginTransaction + SELECT ... FOR UPDATE
 * pada baris peserta sebagai titik serialisasi. Dengan begitu kuota tidak
 * dapat terlampaui walaupun banyak pemindaian diproses bersamaan.
 */

const { query, getConnection, getNumberSetting } = require('./db');

async function jenisAktifById(jenisId) {
  const rows = await query('SELECT * FROM jenis_transaksi WHERE id = ? AND aktif = 1', [jenisId]);
  return rows[0] || null;
}

/**
 * Cari peserta memakai koneksi transaksi & kunci barisnya (FOR UPDATE).
 * Pencocokan berdasarkan kode_barcode lalu fallback nomor_peserta.
 */
async function cariPesertaTx(conn, kode) {
  const teks = String(kode || '').trim();
  if (!teks) return null;
  const [byBarcode] = await conn.query(
    'SELECT * FROM peserta WHERE kode_barcode = ? LIMIT 1 FOR UPDATE',
    [teks],
  );
  if (byBarcode.length) return byBarcode[0];
  const [byNomor] = await conn.query(
    'SELECT * FROM peserta WHERE nomor_peserta = ? LIMIT 1 FOR UPDATE',
    [teks],
  );
  return byNomor.length ? byNomor[0] : null;
}

/** Versi pool biasa (tanpa FOR UPDATE) untuk pemakaian di luar transaksi scan. */
async function cariPeserta(kode) {
  const teks = String(kode || '').trim();
  if (!teks) return null;
  const byBarcode = await query('SELECT * FROM peserta WHERE kode_barcode = ? LIMIT 1', [teks]);
  if (byBarcode.length) return byBarcode[0];
  const byNomor = await query('SELECT * FROM peserta WHERE nomor_peserta = ? LIMIT 1', [teks]);
  return byNomor.length ? byNomor[0] : null;
}

/** Batas berlaku = override per peserta bila ada, jika tidak batas_default jenis. */
async function batasEfektif(pesertaId, jenisId, batasDefault) {
  const rows = await query(
    'SELECT batas FROM kuota_peserta WHERE peserta_id = ? AND jenis_id = ?',
    [pesertaId, jenisId],
  );
  return rows.length ? rows[0].batas : batasDefault;
}

async function batasEfektifTx(conn, pesertaId, jenisId, batasDefault) {
  const [rows] = await conn.query(
    'SELECT batas FROM kuota_peserta WHERE peserta_id = ? AND jenis_id = ?',
    [pesertaId, jenisId],
  );
  return rows.length ? rows[0].batas : batasDefault;
}

async function jumlahTerpakai(pesertaId, jenisId) {
  const rows = await query(
    `SELECT COUNT(*) AS c FROM transaksi
      WHERE peserta_id = ? AND jenis_id = ? AND status = 'berhasil'`,
    [pesertaId, jenisId],
  );
  return rows[0].c;
}

async function jumlahTerpakaiTx(conn, pesertaId, jenisId) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM transaksi
      WHERE peserta_id = ? AND jenis_id = ? AND status = 'berhasil'`,
    [pesertaId, jenisId],
  );
  return rows[0].c;
}

async function catatTx(conn, { status, alasan, jenis, peserta, kode, user, batas, urutanKe, sisaSetelah }) {
  await conn.query(
    `INSERT INTO transaksi
      (status, alasan, waktu, jenis_id, jenis_nama, peserta_id, nomor_peserta,
       nama_peserta, kategori, kode_barcode, batas, urutan_ke, sisa_setelah,
       petugas_id, petugas_nama, petugas_role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      status,
      alasan || null,
      new Date().toISOString(),
      jenis.id,
      jenis.nama,
      peserta ? peserta.id : null,
      peserta ? peserta.nomor_peserta : null,
      peserta ? peserta.nama : null,
      peserta ? peserta.kategori : null,
      String(kode || '').slice(0, 120),
      batas == null ? null : batas,
      urutanKe == null ? null : urutanKe,
      sisaSetelah == null ? null : sisaSetelah,
      user.id,
      user.nama,
      user.role,
    ],
  );
}

function ringkas(peserta, jenis, batas, dipakai) {
  return {
    peserta: peserta
      ? {
          id: peserta.id,
          nomorPeserta: peserta.nomor_peserta,
          nama: peserta.nama,
          kategori: peserta.kategori,
          aktif: !!peserta.aktif,
        }
      : null,
    jenisTransaksi: { id: jenis.id, nama: jenis.nama, kode: jenis.kode },
    batas,
    terpakai: dipakai,
    sisa: Math.max(batas - dipakai, 0),
    waktu: new Date().toISOString(),
  };
}

/**
 * Proses satu pemindaian barcode.
 * @returns {{status:'berhasil'|'ditolak'|'ganda', pesan:string, ...}}
 */
async function prosesScan({ kode, jenisId, user, metode = 'scan' }) {
  const jenis = await jenisAktifById(jenisId);
  if (!jenis) {
    return {
      status: 'ditolak',
      pesan: 'Transaksi ditolak: jenis transaksi tidak ditemukan atau tidak aktif.',
      jenisTransaksi: null,
      peserta: null,
      sisa: null,
    };
  }

  const jedaGanda = (await getNumberSetting('jeda_duplikat_detik', 5)) * 1000;

  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    // Mengunci baris peserta sebagai titik serialisasi: pemindaian bersamaan
    // untuk peserta yang sama akan antre di sini sampai transaksi ini selesai.
    const peserta = await cariPesertaTx(conn, kode);

    if (!peserta) {
      await catatTx(conn, { status: 'ditolak', alasan: 'Barcode tidak terdaftar', jenis, peserta: null, kode, user });
      await conn.commit();
      return {
        status: 'ditolak',
        pesan: 'Barcode tidak terdaftar. Peserta belum terdaftar pada event ini.',
        ...ringkas(null, jenis, null, 0),
      };
    }

    if (!peserta.aktif) {
      await catatTx(conn, { status: 'ditolak', alasan: 'Peserta tidak aktif', jenis, peserta, kode, user });
      await conn.commit();
      return {
        status: 'ditolak',
        pesan: `Transaksi ditolak: peserta ${peserta.nama} berstatus tidak aktif.`,
        ...ringkas(peserta, jenis, 0, 0),
      };
    }

    const batas = await batasEfektifTx(conn, peserta.id, jenis.id, jenis.batas_default);
    const dipakai = await jumlahTerpakaiTx(conn, peserta.id, jenis.id);

    // Pencegahan transaksi ganda akibat pemindaian berulang dalam waktu singkat.
    if (jedaGanda > 0) {
      const [terakhirRows] = await conn.query(
        `SELECT waktu FROM transaksi
          WHERE peserta_id = ? AND jenis_id = ? AND status = 'berhasil'
          ORDER BY id DESC LIMIT 1`,
        [peserta.id, jenis.id],
      );
      const terakhir = terakhirRows[0];
      if (terakhir && Date.now() - new Date(terakhir.waktu).getTime() <= jedaGanda) {
        await catatTx(conn, {
          status: 'ganda',
          alasan: 'Pemindaian ganda dalam waktu singkat',
          jenis,
          peserta,
          kode,
          user,
          batas,
          sisaSetelah: Math.max(batas - dipakai, 0),
        });
        await conn.commit();
        return {
          status: 'ganda',
          pesan: 'Pemindaian ganda terdeteksi. Transaksi ini sudah tercatat beberapa detik lalu, kuota tidak dikurangi lagi.',
          ...ringkas(peserta, jenis, batas, dipakai),
        };
      }
    }

    if (batas <= 0) {
      await catatTx(conn, {
        status: 'ditolak',
        alasan: 'Kuota tidak tersedia (batas 0)',
        jenis,
        peserta,
        kode,
        user,
        batas,
        sisaSetelah: 0,
      });
      await conn.commit();
      return {
        status: 'ditolak',
        pesan: `Transaksi ditolak: ${peserta.nama} tidak memiliki kuota untuk ${jenis.nama}.`,
        ...ringkas(peserta, jenis, batas, dipakai),
      };
    }

    if (dipakai >= batas) {
      await catatTx(conn, {
        status: 'ditolak',
        alasan: 'Kuota habis',
        jenis,
        peserta,
        kode,
        user,
        batas,
        sisaSetelah: 0,
      });
      await conn.commit();
      return {
        status: 'ditolak',
        pesan: `Kuota habis. ${jenis.nama} untuk ${peserta.nama} sudah dipakai ${dipakai} dari ${batas} kali.`,
        ...ringkas(peserta, jenis, batas, dipakai),
      };
    }

    const urutanKe = dipakai + 1;
    const sisaSetelah = batas - urutanKe;
    await catatTx(conn, {
      status: 'berhasil',
      alasan: metode === 'manual' ? 'Input manual nomor peserta' : null,
      jenis,
      peserta,
      kode,
      user,
      batas,
      urutanKe,
      sisaSetelah,
    });
    await conn.commit();
    return {
      status: 'berhasil',
      pesan: `Berhasil. ${jenis.nama} tercatat untuk ${peserta.nama}.`,
      ...ringkas(peserta, jenis, batas, urutanKe),
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Ringkasan kuota semua jenis untuk satu peserta (dipakai halaman scan & detail). */
async function ringkasanKuotaPeserta(pesertaId) {
  const jenis = await query('SELECT * FROM jenis_transaksi WHERE aktif = 1 ORDER BY urutan, id');
  const out = [];
  for (const j of jenis) {
    const batas = await batasEfektif(pesertaId, j.id, j.batas_default);
    const dipakai = await jumlahTerpakai(pesertaId, j.id);
    const khususRows = await query(
      'SELECT 1 AS x FROM kuota_peserta WHERE peserta_id = ? AND jenis_id = ?',
      [pesertaId, j.id],
    );
    out.push({
      jenisId: j.id,
      kode: j.kode,
      nama: j.nama,
      batas,
      terpakai: dipakai,
      sisa: Math.max(batas - dipakai, 0),
      khusus: khususRows.length ? true : false,
    });
  }
  return out;
}

module.exports = {
  prosesScan,
  cariPeserta,
  batasEfektif,
  jumlahTerpakai,
  ringkasanKuotaPeserta,
};
