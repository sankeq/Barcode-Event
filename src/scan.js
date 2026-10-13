'use strict';

/**
 * Mesin pemindaian: satu-satunya tempat kuota peserta boleh bertambah.
 *
 * Seluruh pemeriksaan (peserta terdaftar -> deteksi pemindaian ganda ->
 * cek sisa kuota -> pencatatan) dijalankan di dalam SATU transaksi
 * BEGIN IMMEDIATE. Dengan begitu kuota tidak dapat terlampaui walaupun
 * banyak pemindaian diproses bersamaan.
 */

const { getDb, insert, getNumberSetting } = require('./db');

function jenisAktifById(jenisId) {
  return getDb()
    .prepare('SELECT * FROM jenis_transaksi WHERE id = ? AND aktif = 1')
    .get(jenisId);
}

function cariPeserta(kode) {
  const d = getDb();
  const teks = String(kode || '').trim();
  if (!teks) return null;
  return (
    d.prepare('SELECT * FROM peserta WHERE kode_barcode = ? COLLATE NOCASE').get(teks) ||
    d.prepare('SELECT * FROM peserta WHERE nomor_peserta = ? COLLATE NOCASE').get(teks) ||
    null
  );
}

/** Batas berlaku = override per peserta bila ada, jika tidak batas_default jenis. */
function batasEfektif(pesertaId, jenisId, batasDefault) {
  const ov = getDb()
    .prepare('SELECT batas FROM kuota_peserta WHERE peserta_id = ? AND jenis_id = ?')
    .get(pesertaId, jenisId);
  return ov ? ov.batas : batasDefault;
}

function jumlahTerpakai(pesertaId, jenisId) {
  return getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM transaksi
        WHERE peserta_id = ? AND jenis_id = ? AND status = 'berhasil'`,
    )
    .get(pesertaId, jenisId).c;
}

function catat({ status, alasan, jenis, peserta, kode, user, batas, urutanKe, sisaSetelah }) {
  insert('transaksi', {
    status,
    alasan: alasan || null,
    waktu: new Date().toISOString(),
    jenis_id: jenis.id,
    jenis_nama: jenis.nama,
    peserta_id: peserta ? peserta.id : null,
    nomor_peserta: peserta ? peserta.nomor_peserta : null,
    nama_peserta: peserta ? peserta.nama : null,
    kategori: peserta ? peserta.kategori : null,
    kode_barcode: String(kode || '').slice(0, 120),
    batas: batas == null ? null : batas,
    urutan_ke: urutanKe == null ? null : urutanKe,
    sisa_setelah: sisaSetelah == null ? null : sisaSetelah,
    petugas_id: user.id,
    petugas_nama: user.nama,
    petugas_role: user.role,
  });
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
function prosesScan({ kode, jenisId, user, metode = 'scan' }) {
  const d = getDb();
  const jenis = jenisAktifById(jenisId);
  if (!jenis) {
    return {
      status: 'ditolak',
      pesan: 'Transaksi ditolak: jenis transaksi tidak ditemukan atau tidak aktif.',
      jenisTransaksi: null,
      peserta: null,
      sisa: null,
    };
  }

  const jedaGanda = getNumberSetting('jeda_duplikat_detik', 5) * 1000;

  const jalankan = d.transaction(() => {
    const peserta = cariPeserta(kode);

    if (!peserta) {
      catat({ status: 'ditolak', alasan: 'Barcode tidak terdaftar', jenis, peserta: null, kode, user });
      return {
        status: 'ditolak',
        pesan: 'Barcode tidak terdaftar. Peserta belum terdaftar pada event ini.',
        ...ringkas(null, jenis, null, 0),
      };
    }

    if (!peserta.aktif) {
      catat({ status: 'ditolak', alasan: 'Peserta tidak aktif', jenis, peserta, kode, user });
      return {
        status: 'ditolak',
        pesan: `Transaksi ditolak: peserta ${peserta.nama} berstatus tidak aktif.`,
        ...ringkas(peserta, jenis, 0, 0),
      };
    }

    const batas = batasEfektif(peserta.id, jenis.id, jenis.batas_default);
    const dipakai = jumlahTerpakai(peserta.id, jenis.id);

    // Pencegahan transaksi ganda akibat pemindaian berulang dalam waktu singkat.
    if (jedaGanda > 0) {
      const terakhir = d
        .prepare(
          `SELECT waktu FROM transaksi
            WHERE peserta_id = ? AND jenis_id = ? AND status = 'berhasil'
            ORDER BY id DESC LIMIT 1`,
        )
        .get(peserta.id, jenis.id);
      if (terakhir && Date.now() - new Date(terakhir.waktu).getTime() <= jedaGanda) {
        catat({
          status: 'ganda',
          alasan: 'Pemindaian ganda dalam waktu singkat',
          jenis,
          peserta,
          kode,
          user,
          batas,
          sisaSetelah: Math.max(batas - dipakai, 0),
        });
        return {
          status: 'ganda',
          pesan: 'Pemindaian ganda terdeteksi. Transaksi ini sudah tercatat beberapa detik lalu, kuota tidak dikurangi lagi.',
          ...ringkas(peserta, jenis, batas, dipakai),
        };
      }
    }

    if (batas <= 0) {
      catat({
        status: 'ditolak',
        alasan: 'Kuota tidak tersedia (batas 0)',
        jenis,
        peserta,
        kode,
        user,
        batas,
        sisaSetelah: 0,
      });
      return {
        status: 'ditolak',
        pesan: `Transaksi ditolak: ${peserta.nama} tidak memiliki kuota untuk ${jenis.nama}.`,
        ...ringkas(peserta, jenis, batas, dipakai),
      };
    }

    if (dipakai >= batas) {
      catat({
        status: 'ditolak',
        alasan: 'Kuota habis',
        jenis,
        peserta,
        kode,
        user,
        batas,
        sisaSetelah: 0,
      });
      return {
        status: 'ditolak',
        pesan: `Kuota habis. ${jenis.nama} untuk ${peserta.nama} sudah dipakai ${dipakai} dari ${batas} kali.`,
        ...ringkas(peserta, jenis, batas, dipakai),
      };
    }

    const urutanKe = dipakai + 1;
    const sisaSetelah = batas - urutanKe;
    catat({
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
    return {
      status: 'berhasil',
      pesan: `Berhasil. ${jenis.nama} tercatat untuk ${peserta.nama}.`,
      ...ringkas(peserta, jenis, batas, urutanKe),
    };
  });

  // .immediate() -> BEGIN IMMEDIATE: ambil kunci tulis sebelum membaca kuota.
  return jalankan.immediate();
}

/** Ringkasan kuota semua jenis untuk satu peserta (dipakai halaman scan & detail). */
function ringkasanKuotaPeserta(pesertaId) {
  const d = getDb();
  const jenis = d.prepare('SELECT * FROM jenis_transaksi WHERE aktif = 1 ORDER BY urutan, id').all();
  return jenis.map((j) => {
    const batas = batasEfektif(pesertaId, j.id, j.batas_default);
    const dipakai = jumlahTerpakai(pesertaId, j.id);
    return {
      jenisId: j.id,
      kode: j.kode,
      nama: j.nama,
      batas,
      terpakai: dipakai,
      sisa: Math.max(batas - dipakai, 0),
      khusus: d
        .prepare('SELECT 1 AS x FROM kuota_peserta WHERE peserta_id = ? AND jenis_id = ?')
        .get(pesertaId, j.id)
        ? true
        : false,
    };
  });
}

module.exports = {
  prosesScan,
  cariPeserta,
  batasEfektif,
  jumlahTerpakai,
  ringkasanKuotaPeserta,
};
