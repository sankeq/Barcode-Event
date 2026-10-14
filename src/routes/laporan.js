'use strict';

/**
 * Laporan & ringkasan:
 *  - /api/laporan/ringkasan     : angka untuk dashboard
 *  - /api/laporan/per-peserta   : matriks pemakaian kuota tiap peserta
 *  - /api/laporan/rekap-jenis   : rekap per jenis transaksi
 *  - /api/laporan/export.xlsx   : ekspor Excel
 */

const express = require('express');
const ExcelJS = require('exceljs');
const { query } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const {
  asyncHandler, parsePaging, toInt, trimOrNull, rentangTanggal, nowIso,
  tanggalLokal, awalHariLokalIso,
} = require('../util');
const { sheetDariData } = require('../excel');

const router = express.Router();
const adminOnly = [requireAuth, requireRole('admin')];

/**
 * Jenis yang ikut tampil di laporan: yang sedang dipakai event,
 * ditambah jenis yang sudah pernah dipakai agar riwayatnya tidak "hilang"
 * ketika admin mengeluarkannya dari pilihan.
 */
async function semuaJenis() {
  return query(
    `SELECT * FROM jenis_transaksi
      WHERE aktif = 1
         OR EXISTS (SELECT 1 FROM transaksi t WHERE t.jenis_id = jenis_transaksi.id)
      ORDER BY urutan, id`,
  );
}

async function petaDipakai(pesertaIds) {
  const map = new Map();
  if (!pesertaIds.length) return map;
  const ph = pesertaIds.map(() => '?').join(',');
  const rows = await query(
    `SELECT peserta_id, jenis_id, COUNT(*) AS c
       FROM transaksi
      WHERE status = 'berhasil' AND peserta_id IN (${ph})
      GROUP BY peserta_id, jenis_id`,
    pesertaIds,
  );
  rows.forEach((r) => map.set(`${r.peserta_id}:${r.jenis_id}`, r.c));
  return map;
}

async function petaOverride(pesertaIds) {
  const map = new Map();
  if (!pesertaIds.length) return map;
  const ph = pesertaIds.map(() => '?').join(',');
  (await query(`SELECT peserta_id, jenis_id, batas FROM kuota_peserta WHERE peserta_id IN (${ph})`, pesertaIds))
    .forEach((r) => map.set(`${r.peserta_id}:${r.jenis_id}`, r.batas));
  return map;
}

/** Ambil peserta sesuai filter (q, kategori, status). */
async function ambilPeserta({ q, kategori, status, limit = null, offset = 0 }) {
  const where = [];
  const params = [];
  if (q) {
    where.push('(nomor_peserta LIKE ? OR nama LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (kategori) {
    where.push('kategori = ?');
    params.push(kategori);
  }
  if (status === 'aktif') where.push('aktif = 1');
  else if (status === 'nonaktif') where.push('aktif = 0');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (await query(`SELECT COUNT(*) AS c FROM peserta ${whereSql}`, params))[0].c;
  const sql = `SELECT * FROM peserta ${whereSql} ORDER BY nomor_peserta${
    limit == null ? '' : ' LIMIT ? OFFSET ?'
  }`;
  const data = limit == null ? await query(sql, params) : await query(sql, [...params, limit, offset]);
  return { data, total };
}

/** Susun matriks peserta x jenis transaksi. */
async function bangunMatriks(pesertaList, jenisList) {
  const ids = pesertaList.map((p) => p.id);
  const dipakai = await petaDipakai(ids);
  const override = await petaOverride(ids);
  return pesertaList.map((p) => {
    const perJenis = jenisList.map((j) => {
      const ovKey = `${p.id}:${j.id}`;
      const batas = override.has(ovKey) ? override.get(ovKey) : j.batas_default;
      const terpakai = dipakai.get(ovKey) || 0;
      return {
        jenisId: j.id,
        kode: j.kode,
        nama: j.nama,
        batas,
        terpakai,
        sisa: Math.max(batas - terpakai, 0),
        khusus: override.has(ovKey),
      };
    });
    return {
      pesertaId: p.id,
      nomorPeserta: p.nomor_peserta,
      nama: p.nama,
      kategori: p.kategori,
      aktif: !!p.aktif,
      perJenis,
      totalBatas: perJenis.reduce((a, b) => a + b.batas, 0),
      totalTerpakai: perJenis.reduce((a, b) => a + b.terpakai, 0),
    };
  });
}

router.get(
  '/ringkasan',
  requireAuth,
  asyncHandler(async (req, res) => {
    const peserta = (
      await query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN aktif = 1 THEN 1 ELSE 0 END) AS aktif,
                SUM(CASE WHEN aktif = 0 THEN 1 ELSE 0 END) AS nonaktif
           FROM peserta`,
      )
    )[0];
    const trx = (
      await query(
        `SELECT SUM(CASE WHEN status = 'berhasil' THEN 1 ELSE 0 END) AS berhasil,
                SUM(CASE WHEN status = 'ditolak'  THEN 1 ELSE 0 END) AS ditolak,
                SUM(CASE WHEN status = 'ganda'    THEN 1 ELSE 0 END) AS ganda
           FROM transaksi`,
      )
    )[0];

    // "Hari ini" dihitung pada tanggal lokal (waktu panitia), bukan UTC,
    // memakai rentang ISO [awal hari ini, awal besok).
    const hariIni = (
      await query(
        `SELECT COUNT(*) AS c FROM transaksi
          WHERE status = 'berhasil' AND waktu >= ? AND waktu < ?`,
        [awalHariLokalIso(0), awalHariLokalIso(1)],
      )
    )[0].c;

    const jenis = await semuaJenis();
    const idsAktif = (await query('SELECT id FROM peserta WHERE aktif = 1')).map((r) => r.id);
    const override = await petaOverride(idsAktif);
    const dipakaiAll = await query(
      `SELECT jenis_id, COUNT(*) AS c, COUNT(DISTINCT peserta_id) AS peserta
         FROM transaksi WHERE status = 'berhasil' GROUP BY jenis_id`,
    );
    const dipakaiMap = new Map(dipakaiAll.map((r) => [r.jenis_id, r]));
    const ditolakMap = new Map(
      (await query(`SELECT jenis_id, COUNT(*) AS c FROM transaksi WHERE status = 'ditolak' GROUP BY jenis_id`))
        .map((r) => [r.jenis_id, r.c]),
    );

    const perJenis = jenis.map((j) => {
      const batasTotal = idsAktif.reduce(
        (a, id) => a + (override.has(`${id}:${j.id}`) ? override.get(`${id}:${j.id}`) : j.batas_default),
        0,
      );
      const terpakai = dipakaiMap.get(j.id)?.c || 0;
      return {
        id: j.id,
        kode: j.kode,
        nama: j.nama,
        batasDefault: j.batas_default,
        batasTotal,
        terpakai,
        sisa: Math.max(batasTotal - terpakai, 0),
        pesertaMemakai: dipakaiMap.get(j.id)?.peserta || 0,
        ditolak: ditolakMap.get(j.id) || 0,
      };
    });

    // 7 hari terakhir: ambil baris mentah lalu kelompokkan per tanggal lokal di JS.
    const barisHarian = await query(
      `SELECT waktu, status FROM transaksi WHERE waktu >= ?`,
      [awalHariLokalIso(-6)],
    );
    const petaHarian = new Map();
    for (const row of barisHarian) {
      const tanggal = tanggalLokal(new Date(row.waktu));
      let agg = petaHarian.get(tanggal);
      if (!agg) {
        agg = { tanggal, berhasil: 0, ditolak: 0 };
        petaHarian.set(tanggal, agg);
      }
      if (row.status === 'berhasil') agg.berhasil += 1;
      else if (row.status === 'ditolak') agg.ditolak += 1;
    }
    const perHari = [...petaHarian.values()].sort((a, b) => a.tanggal.localeCompare(b.tanggal));

    const aktivitasTerbaru = await query(
      `SELECT id, status, alasan, waktu, jenis_nama, nomor_peserta, nama_peserta, petugas_nama
         FROM transaksi ORDER BY id DESC LIMIT 8`,
    );

    res.json({
      peserta: {
        total: peserta.total || 0,
        aktif: peserta.aktif || 0,
        nonaktif: peserta.nonaktif || 0,
      },
      transaksi: {
        berhasil: trx.berhasil || 0,
        ditolak: trx.ditolak || 0,
        ganda: trx.ganda || 0,
        hariIni: hariIni || 0,
      },
      jumlahJenis: jenis.length,
      perJenis,
      perHari,
      aktivitasTerbaru,
      namaEvent: (await query('SELECT nilai FROM pengaturan WHERE kunci = ?', ['nama_event']))[0]?.nilai || 'Event',
    });
  }),
);

router.get(
  '/per-peserta',
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const { page, perPage, offset } = parsePaging(req.query, 25);
    const filter = {
      q: trimOrNull(req.query.q),
      kategori: trimOrNull(req.query.kategori),
      status: trimOrNull(req.query.status),
    };
    const jenisList = await semuaJenis();
    const { data, total } = await ambilPeserta({ ...filter, limit: perPage, offset });
    res.json({
      data: await bangunMatriks(data, jenisList),
      jenis: jenisList,
      page,
      perPage,
      total,
      totalHalaman: Math.max(Math.ceil(total / perPage), 1),
    });
  }),
);

router.get(
  '/rekap-jenis',
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const { dariIso, sampaiIso } = rentangTanggal(trimOrNull(req.query.dari), trimOrNull(req.query.sampai));
    const jenisList = await semuaJenis();

    const idsAktif = (await query('SELECT id FROM peserta WHERE aktif = 1')).map((r) => r.id);
    const override = await petaOverride(idsAktif);

    const where = ["status = 'berhasil'"];
    const params = [];
    if (dariIso) {
      where.push('waktu >= ?');
      params.push(dariIso);
    }
    if (sampaiIso) {
      where.push('waktu <= ?');
      params.push(sampaiIso);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    const dipakai = new Map(
      (
        await query(
          `SELECT jenis_id, COUNT(*) AS c, COUNT(DISTINCT peserta_id) AS peserta
             FROM transaksi ${whereSql} GROUP BY jenis_id`,
          params,
        )
      ).map((r) => [r.jenis_id, r]),
    );
    const ditolak = new Map(
      (await query(`SELECT jenis_id, COUNT(*) AS c FROM transaksi WHERE status = 'ditolak' GROUP BY jenis_id`))
        .map((r) => [r.jenis_id, r.c]),
    );

    const data = jenisList.map((j) => {
      const batasTotal = idsAktif.reduce(
        (a, id) => a + (override.has(`${id}:${j.id}`) ? override.get(`${id}:${j.id}`) : j.batas_default),
        0,
      );
      const terpakai = dipakai.get(j.id)?.c || 0;
      return {
        jenisId: j.id,
        kode: j.kode,
        nama: j.nama,
        batasDefault: j.batas_default,
        batasTotal,
        terpakai,
        sisa: Math.max(batasTotal - terpakai, 0),
        persen: batasTotal > 0 ? Math.round((terpakai / batasTotal) * 1000) / 10 : 0,
        pesertaMemakai: dipakai.get(j.id)?.peserta || 0,
        jumlahPeserta: idsAktif.length,
        ditolak: ditolak.get(j.id) || 0,
      };
    });

    res.json({ data, periode: { dari: dariIso, sampai: sampaiIso } });
  }),
);

router.get(
  '/export.xlsx',
  ...adminOnly,
  asyncHandler(async (req, res) => {
    const tipe = trimOrNull(req.query.tipe) || 'per-peserta';
    const jenisList = await semuaJenis();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Aplikasi Barcode Peserta Event';
    const namaEvent = (await query('SELECT nilai FROM pengaturan WHERE kunci = ?', ['nama_event']))[0]?.nilai || 'Event';

    if (tipe === 'rekap-jenis') {
      const idsAktif = (await query('SELECT id FROM peserta WHERE aktif = 1')).map((r) => r.id);
      const override = await petaOverride(idsAktif);
      const dipakai = new Map(
        (
          await query(
            `SELECT jenis_id, COUNT(*) AS c, COUNT(DISTINCT peserta_id) AS peserta
               FROM transaksi WHERE status = 'berhasil' GROUP BY jenis_id`,
          )
        ).map((r) => [r.jenis_id, r]),
      );
      const ditolak = new Map(
        (await query(`SELECT jenis_id, COUNT(*) AS c FROM transaksi WHERE status = 'ditolak' GROUP BY jenis_id`))
          .map((r) => [r.jenis_id, r.c]),
      );
      const rows = jenisList.map((j) => {
        const batasTotal = idsAktif.reduce(
          (a, id) => a + (override.has(`${id}:${j.id}`) ? override.get(`${id}:${j.id}`) : j.batas_default),
          0,
        );
        const terpakai = dipakai.get(j.id)?.c || 0;
        return {
          nama: j.nama,
          batasDefault: j.batas_default,
          jumlahPeserta: idsAktif.length,
          batasTotal,
          terpakai,
          sisa: Math.max(batasTotal - terpakai, 0),
          persen: batasTotal ? `${Math.round((terpakai / batasTotal) * 1000) / 10}%` : '0%',
          pesertaMemakai: dipakai.get(j.id)?.peserta || 0,
          ditolak: ditolak.get(j.id) || 0,
        };
      });
      const ws = sheetDariData(wb, 'Rekap per Jenis', [
        { header: 'Jenis Transaksi', key: 'nama', width: 24 },
        { header: 'Batas Bawaan', key: 'batasDefault', width: 14 },
        { header: 'Jumlah Peserta Aktif', key: 'jumlahPeserta', width: 18 },
        { header: 'Total Kuota Tersedia', key: 'batasTotal', width: 20 },
        { header: 'Terpakai', key: 'terpakai', width: 12 },
        { header: 'Sisa', key: 'sisa', width: 12 },
        { header: 'Terpakai (%)', key: 'persen', width: 14 },
        { header: 'Peserta yang Memakai', key: 'pesertaMemakai', width: 21 },
        { header: 'Transaksi Ditolak', key: 'ditolak', width: 18 },
      ], rows);
      ws.addRow([]);
      ws.addRow([`Event: ${namaEvent}`, `Dicetak: ${new Date().toLocaleString('id-ID')}`]);
      const buffer = await wb.xlsx.writeBuffer();
      res.setHeader('Content-Disposition', `attachment; filename="rekap-jenis-transaksi-${nowIso().slice(0, 10)}.xlsx"`);
      return res
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .send(Buffer.from(buffer));
    }

    // Default: laporan penggunaan per peserta
    const { data } = await ambilPeserta({ q: trimOrNull(req.query.q), kategori: trimOrNull(req.query.kategori), status: trimOrNull(req.query.status) });
    const matriks = await bangunMatriks(data, jenisList);

    const kolom = [
      { header: 'Nomor Peserta', key: 'nomorPeserta', width: 15 },
      { header: 'Nama Peserta', key: 'nama', width: 28 },
      { header: 'Kategori', key: 'kategori', width: 15 },
      { header: 'Status', key: 'status', width: 11 },
      ...jenisList.map((j) => ({
        header: `${j.nama} (terpakai/batas)`,
        key: `j_${j.id}`,
        width: 22,
      })),
      { header: 'Total Terpakai', key: 'totalTerpakai', width: 15 },
      { header: 'Total Kuota', key: 'totalBatas', width: 13 },
    ];

    const rows = matriks.map((m) => {
      const row = {
        nomorPeserta: m.nomorPeserta,
        nama: m.nama,
        kategori: m.kategori || '-',
        status: m.aktif ? 'Aktif' : 'Nonaktif',
        totalTerpakai: m.totalTerpakai,
        totalBatas: m.totalBatas,
      };
      m.perJenis.forEach((pj) => {
        row[`j_${pj.jenisId}`] = pj.batas === 0 ? 'tidak berhak' : `${pj.terpakai}/${pj.batas}`;
      });
      return row;
    });

    const ws = sheetDariData(wb, 'Penggunaan per Peserta', kolom, rows);
    ws.addRow([]);
    ws.addRow([`Event: ${namaEvent}`, `Dicetak: ${new Date().toLocaleString('id-ID')}`]);
    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', `attachment; filename="laporan-penggunaan-peserta-${nowIso().slice(0, 10)}.xlsx"`);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(buffer));
  }),
);

module.exports = router;
