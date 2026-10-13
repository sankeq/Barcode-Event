'use strict';

/**
 * Semua urusan Excel: template impor, pembacaan file impor, dan ekspor laporan.
 * Memakai exceljs (baca + tulis) sehingga tidak perlu file CSV perantara.
 */

const ExcelJS = require('exceljs');
const { getDb, insert, update } = require('./db');
const { generateKodeBarcode } = require('./barcode');

const JENIS_COL = (nama) => `Batas ${nama}`;

function jenisAktif() {
  return getDb().prepare('SELECT * FROM jenis_transaksi WHERE aktif = 1 ORDER BY urutan, id').all();
}

function sel(value) {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text).join('');
    if ('text' in value && value.text != null) return value.text;
    if ('result' in value && value.result != null) return value.result;
    return null;
  }
  return value;
}

function teksSel(value) {
  const v = sel(value);
  if (v == null) return '';
  return String(v).trim();
}

/** Nomor peserta untuk excel: angka bulat ditulis tanpa desimal. */
function nomorSel(value) {
  const v = sel(value);
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  return teksSel(v);
}

function gayaJudul(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  row.alignment = { vertical: 'middle', horizontal: 'center' };
  row.height = 20;
}

/** Bangun workbook template impor peserta (dinamis mengikuti jenis transaksi aktif). */
async function buildTemplate(namaEvent) {
  const jenis = jenisAktif();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Aplikasi Barcode Peserta Event';
  wb.created = new Date();

  // --- Sheet Petunjuk ---
  const info = wb.addWorksheet('Petunjuk', { properties: { defaultColWidth: 100 } });
  const barisInfo = [
    ['TEMPLATE IMPOR PESERTA'],
    [`Event: ${namaEvent || '-'}`],
    [''],
    ['Cara pakai:'],
    ['1. Isi data pada sheet "Peserta". Jangan mengubah atau menghapus baris judul (baris 1).'],
    ['2. Kolom bertanda * wajib diisi.'],
    ['3. Kolom "Nomor Peserta" harus unik. Jika sudah pernah diimpor, gunakan opsi "Perbarui data yang sudah ada".'],
    ['4. Kolom "Batas <Jenis Transaksi>" bersifat opsional. Kosongkan bila peserta memakai batas bawaan event.'],
    ['5. Isi angka 0 bila peserta tidak boleh memakai transaksi tersebut.'],
    ['6. Simpan file lalu unggah pada menu Peserta > Impor Excel.'],
    [''],
    ['Contoh baris:'],
    ['Nomor Peserta 25001 | Nama Siti Aminah | Kategori VIP | Kontak 0812xxxx | (Batas parkir: 2)'],
  ];
  barisInfo.forEach((r, i) => {
    const row = info.addRow(r);
    if (i === 0) row.font = { bold: true, size: 14 };
    if (i === 1) row.font = { bold: true };
  });

  // --- Sheet Peserta ---
  const ws = wb.addWorksheet('Peserta', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const headers = [
    { header: 'Nomor Peserta *', key: 'nomor', width: 18 },
    { header: 'Nama *', key: 'nama', width: 30 },
    { header: 'Kategori', key: 'kategori', width: 20 },
    { header: 'Kontak', key: 'kontak', width: 18 },
    ...jenis.map((j) => ({ header: JENIS_COL(j.nama), key: `batas_${j.kode}`, width: 16 })),
  ];
  ws.columns = headers;
  gayaJudul(ws.getRow(1));
  ws.autoFilter = { from: 'A1', to: ws.getRow(1).getCell(headers.length).address };

  // Baris contoh supaya format langsung jelas.
  const contoh = ['25001', 'Siti Aminah', 'VIP', '0812-3456-7890'];
  jenis.forEach(() => contoh.push(''));
  const rowContoh = ws.addRow(contoh);
  rowContoh.font = { italic: true, color: { argb: 'FF808080' } };
  ws.addRow(['25002', 'Budi Santoso', 'Reguler', '0813-1111-2222', ...jenis.map(() => '')]);

  for (let i = 2; i <= 500; i += 1) {
    for (let c = 1; c <= headers.length; c += 1) {
      ws.getCell(i, c).border = { bottom: { style: 'hair', color: { argb: 'FFD0D0D0' } } };
    }
  }

  // --- Sheet Jenis Transaksi (referensi) ---
  const wsJenis = wb.addWorksheet('Jenis Transaksi');
  wsJenis.columns = [
    { header: 'Kode', key: 'kode', width: 18 },
    { header: 'Nama Jenis Transaksi', key: 'nama', width: 28 },
    { header: 'Batas Bawaan', key: 'batas', width: 14 },
  ];
  gayaJudul(wsJenis.getRow(1));
  jenis.forEach((j) => wsJenis.addRow({ kode: j.kode, nama: j.nama, batas: j.batas_default }));

  return wb.xlsx.writeBuffer();
}

/**
 * Baca file Excel impor.
 * @returns {{kolom:object, kolomBatas:Array, baris:Array}}
 */
async function parseImportFile(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  let ws = wb.getWorksheet('Peserta') || wb.worksheets[0];
  if (!ws) throw new Error('File Excel tidak memiliki sheet data.');

  const headerRow = ws.getRow(1);
  const kolom = { nomor: null, nama: null, kategori: null, kontak: null };
  const kolomBatas = []; // [{ index, jenis }]
  const jenis = jenisAktif();
  const byNama = new Map(jenis.map((j) => [j.nama.toLowerCase(), j]));

  const norm = (s) => teksSel(s).toLowerCase().replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim();

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const h = norm(cell.value);
    if (!h) return;
    if (['nomor peserta', 'nomor', 'id', 'id peserta', 'no peserta', 'nomor_peserta'].includes(h)) {
      kolom.nomor = colNumber;
    } else if (['nama', 'nama peserta', 'nama_peserta'].includes(h)) {
      kolom.nama = colNumber;
    } else if (['kategori', 'kelompok', 'grup', 'group'].includes(h)) {
      kolom.kategori = colNumber;
    } else if (['kontak', 'no hp', 'telepon', 'phone', 'whatsapp'].includes(h)) {
      kolom.kontak = colNumber;
    } else if (h.startsWith('batas ')) {
      const namaJenis = h.slice('batas '.length).trim();
      const j = byNama.get(namaJenis);
      // Kolom "Batas X" yang tidak dikenal diabaikan agar file lama tetap bisa diimpor.
      if (j) kolomBatas.push({ index: colNumber, jenis: j });
    }
  });

  const baris = [];
  const kolomTerakhir = headerRow.cellCount || ws.columnCount;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const get = (idx) => (idx ? row.getCell(idx) : null);
    const nomor = nomorSel(get(kolom.nomor) ? get(kolom.nomor).value : null);
    const nama = teksSel(get(kolom.nama) ? get(kolom.nama).value : null);
    const kategori = teksSel(get(kolom.kategori) ? get(kolom.kategori).value : null);
    const kontak = teksSel(get(kolom.kontak) ? get(kolom.kontak).value : null);

    const batas = {};
    kolomBatas.forEach(({ index, jenis: j }) => {
      const raw = teksSel(row.getCell(index).value);
      if (raw !== '') batas[j.id] = raw;
    });

    const kosong =
      !nomor && !nama && !kategori && !kontak && Object.keys(batas).length === 0;
    if (kosong) return;

    baris.push({ baris: rowNumber, nomor, nama, kategori, kontak, batas });
  });

  return { kolom, kolomBatas, baris, kolomTerakhir, sheetName: ws.name };
}

/**
 * Validasi + impor. Mode: 'tambah' (lewati ID yang sudah ada) atau 'perbarui'.
 * Baris valid tetap diimpor; baris bermasalah dilaporkan dengan nomor barisnya.
 */
function validasiDanImpor(rows, { mode, user }) {
  const db = getDb();
  const jenisAktifMap = new Map(jenisAktif().map((j) => [j.id, j]));

  const errors = [];
  const terlihatDiFile = new Map();
  let inserted = 0;
  let updated = 0;
  let dilewati = 0;
  const ID_RE = /^[A-Za-z0-9._\-/]{1,40}$/;

  const adaNomor = db.prepare('SELECT * FROM peserta WHERE nomor_peserta = ? COLLATE NOCASE');
  const kodeTaken = db.prepare('SELECT 1 AS x FROM peserta WHERE kode_barcode = ? COLLATE NOCASE');
  const setKuota = db.prepare(
    `INSERT INTO kuota_peserta (peserta_id, jenis_id, batas, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(peserta_id, jenis_id) DO UPDATE SET batas = excluded.batas,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  );

  const simpan = db.transaction((row) => {
    const eksisting = adaNomor.get(row.nomor);

    // Validasi kolom wajib + format.
    if (!row.nomor) errors.push({ baris: row.baris, kolom: 'Nomor Peserta', pesan: 'Kolom wajib belum diisi.' });
    else if (!ID_RE.test(row.nomor))
      errors.push({
        baris: row.baris,
        kolom: 'Nomor Peserta',
        pesan: `Format tidak valid ("${row.nomor}"). Gunakan huruf/angka/tanda - _ . / maksimal 40 karakter.`,
      });
    if (!row.nama)
      errors.push({ baris: row.baris, kolom: 'Nama', pesan: 'Kolom wajib belum diisi.' });
    else if (row.nama.length > 120)
      errors.push({ baris: row.baris, kolom: 'Nama', pesan: 'Nama terlalu panjang (maksimal 120 karakter).' });

    // Batas per jenis transaksi.
    const batasFinal = {};
    for (const [jenisIdStr, raw] of Object.entries(row.batas)) {
      const jenisId = Number(jenisIdStr);
      const j = jenisAktifMap.get(jenisId);
      if (!j) continue;
      if (!/^\d+$/.test(String(raw))) {
        errors.push({
          baris: row.baris,
          kolom: JENIS_COL(j.nama),
          pesan: `Harus berupa angka bulat 0 atau lebih (ditemukan "${raw}").`,
        });
        continue;
      }
      const n = Number(raw);
      if (n < 0 || n > 999) {
        errors.push({
          baris: row.baris,
          kolom: JENIS_COL(j.nama),
          pesan: `Batas di luar rentang yang wajar (0-999).`,
        });
        continue;
      }
      batasFinal[jenisId] = n;
    }

    if (errors.some((e) => e.baris === row.baris)) return;

    // Duplikat di dalam file.
    const kunci = row.nomor.toLowerCase();
    if (terlihatDiFile.has(kunci)) {
      errors.push({
        baris: row.baris,
        kolom: 'Nomor Peserta',
        pesan: `ID ganda di dalam file, sudah dipakai pada baris ${terlihatDiFile.get(kunci)}.`,
      });
      return;
    }
    terlihatDiFile.set(kunci, row.baris);

    const waktu = new Date().toISOString();

    if (eksisting) {
      if (mode !== 'perbarui') {
        errors.push({
          baris: row.baris,
          kolom: 'Nomor Peserta',
          pesan: `ID "${row.nomor}" sudah terdaftar sebagai ${eksisting.nama}. Pilih opsi "Perbarui data yang sudah ada" bila ingin menimpa.`,
        });
        return;
      }
      update('peserta', eksisting.id, {
        nama: row.nama,
        kategori: row.kategori || null,
        kontak: row.kontak || null,
        updated_at: waktu,
        updated_by: user.id,
      });
      updated += 1;
      Object.entries(batasFinal).forEach(([jenisId, batas]) => {
        setKuota.run(eksisting.id, Number(jenisId), batas, waktu, user.id);
      });
      return;
    }

    const kode = generateKodeBarcode(row.nomor, (k) => !!kodeTaken.get(k));
    const pesertaId = insert('peserta', {
      nomor_peserta: row.nomor,
      nama: row.nama,
      kategori: row.kategori || null,
      kontak: row.kontak || null,
      kode_barcode: kode,
      aktif: 1,
      created_at: waktu,
      updated_at: waktu,
      created_by: user.id,
      updated_by: user.id,
    });
    Object.entries(batasFinal).forEach(([jenisId, batas]) => {
      setKuota.run(pesertaId, Number(jenisId), batas, waktu, user.id);
    });
    inserted += 1;
  });

  for (const row of rows) simpan.immediate(row);

  return { inserted, updated, dilewati, errors, totalBaris: rows.length };
}

/** Helper: tulis array of objects ke worksheet dengan lebar kolom otomatis. */
function sheetDariData(wb, nama, kolomDef, data) {
  const ws = wb.addWorksheet(nama, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = kolomDef.map((c) => ({ header: c.header, key: c.key, width: c.width || 16 }));
  gayaJudul(ws.getRow(1));
  data.forEach((d) => ws.addRow(d));
  ws.autoFilter = { from: 'A1', to: ws.getRow(1).getCell(kolomDef.length).address };
  return ws;
}

module.exports = {
  buildTemplate,
  parseImportFile,
  validasiDanImpor,
  sheetDariData,
  gayaJudul,
  teksSel,
  JENIS_COL,
};
