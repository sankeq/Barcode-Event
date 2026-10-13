/** Halaman riwayat transaksi: pencarian, filter, dan ekspor Excel. */

import { api, qs, unduhBerkas } from '../api.js';
import { muatJenis } from '../state.js';
import {
  esc, galat, sukses, jalankan, potonganHalaman, kosongkan, angka,
  fmtWaktu, lencanaStatus, tanggalHariIni, tanggalKe,
} from '../ui.js';

const f = {
  q: '', jenisId: '', status: '', kategori: '', dari: '', sampai: '', petugasId: '',
  page: 1, perPage: 50,
};

export default {
  judul: 'Riwayat Transaksi',
  peran: ['admin'],

  render(konten) {
    konten.innerHTML = `
      <div class="kartu">
        <header>
          <h3>Riwayat transaksi</h3>
          <div class="spacer"></div>
          <button class="tombol kecil" id="r-hari-ini">Hari ini</button>
          <button class="tombol kecil" id="r-7hari">7 hari terakhir</button>
          <button class="tombol kecil" id="r-semua">Semua</button>
          <button class="tombol kecil biru" id="r-ekspor">⬇ Ekspor Excel</button>
        </header>

        <div class="baris-bidang" style="margin-bottom:.4rem">
          <label class="bidang"><span>Pencarian</span>
            <input type="search" id="r-q" placeholder="Nama, nomor peserta, barcode, jenis" value="${esc(f.q)}" /></label>
          <label class="bidang"><span>Jenis transaksi</span><select id="r-jenis"></select></label>
          <label class="bidang"><span>Status</span>
            <select id="r-status">
              <option value="">Semua status</option>
              <option value="berhasil">Berhasil</option>
              <option value="ditolak">Ditolak</option>
              <option value="ganda">Ganda</option>
            </select></label>
          <label class="bidang"><span>Petugas</span><select id="r-petugas"></select></label>
        </div>
        <div class="baris-bidang" style="margin-bottom:.6rem">
          <label class="bidang"><span>Kategori peserta</span><select id="r-kategori"></select></label>
          <label class="bidang"><span>Dari tanggal</span><input type="date" id="r-dari" value="${esc(f.dari)}" /></label>
          <label class="bidang"><span>Sampai tanggal</span><input type="date" id="r-sampai" value="${esc(f.sampai)}" /></label>
          <label class="bidang"><span>&nbsp;</span>
            <button class="tombol" id="r-reset">Reset filter</button></label>
        </div>

        <div id="r-ringkas" class="kisi j4" style="margin-bottom:.7rem"></div>
        <div id="r-daftar"><div class="pemuat">Memuat…</div></div>
      </div>`;

    const refs = {};
    ['q', 'jenis', 'status', 'petugas', 'kategori', 'dari', 'sampai', 'daftar', 'ringkas'].forEach((k) => {
      refs[k] = konten.querySelector(`#r-${k}`);
    });

    async function isiPilihan() {
      try {
        const jenis = await muatJenis();
        refs.jenis.innerHTML =
          '<option value="">Semua jenis</option>' +
          jenis.map((j) => `<option value="${j.id}">${esc(j.nama)}</option>`).join('');
        refs.jenis.value = f.jenisId;
      } catch {
        /* abaikan */
      }
      try {
        const k = await api.get('/api/peserta/kategori');
        refs.kategori.innerHTML =
          '<option value="">Semua kategori</option>' +
          (k.kategori || []).map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
        refs.kategori.value = f.kategori;
      } catch {
        /* abaikan */
      }
    }

    async function muat() {
      refs.daftar.innerHTML = '<div class="pemuat">Memuat…</div>';
      try {
        const r = await api.get(
          `/api/transaksi${qs({
            q: f.q, jenisId: f.jenisId, status: f.status, kategori: f.kategori,
            petugasId: f.petugasId, dari: f.dari, sampai: f.sampai,
            page: f.page, perPage: f.perPage,
          })}`,
        );

        if (!refs.petugas.options.length) {
          refs.petugas.innerHTML =
            '<option value="">Semua petugas</option>' +
            r.petugas.map((p) => `<option value="${p.id}">${esc(p.nama)} (${esc(p.role)})</option>`).join('');
          refs.petugas.value = f.petugasId;
        }

        refs.ringkas.innerHTML = `
          <div class="kartu-stat hijau"><span class="angka">${angka(r.ringkasan.berhasil)}</span><span class="label">Berhasil</span></div>
          <div class="kartu-stat merah"><span class="angka">${angka(r.ringkasan.ditolak)}</span><span class="label">Ditolak</span></div>
          <div class="kartu-stat kuning"><span class="angka">${angka(r.ringkasan.ganda)}</span><span class="label">Pemindaian ganda</span></div>
          <div class="kartu-stat biru"><span class="angka">${angka(r.total)}</span><span class="label">Total baris</span></div>`;

        if (!r.data.length) {
          refs.daftar.innerHTML = kosongkan('Tidak ada transaksi pada filter ini.');
          return;
        }

        refs.daftar.innerHTML = `
          <div class="bungkus-tabel"><table class="data" style="min-width:1000px">
            <thead><tr>
              <th>Waktu</th><th>Status</th><th>Jenis</th><th>Nomor</th><th>Nama Peserta</th>
              <th>Kategori</th><th class="angka">Kuota</th><th>Petugas</th><th>Keterangan</th>
            </tr></thead>
            <tbody>
              ${r.data
                .map(
                  (t) => `<tr>
                    <td>${esc(fmtWaktu(t.waktu))}</td>
                    <td>${lencanaStatus(t.status)}</td>
                    <td>${esc(t.jenis_nama)}</td>
                    <td class="mono">${esc(t.nomor_peserta || '-')}</td>
                    <td>${esc(t.nama_peserta || '-')}</td>
                    <td>${esc(t.kategori || '-')}</td>
                    <td class="angka">${
                      t.batas === null ? '-' : `${t.urutan_ke ?? 0}/${t.batas}`
                    }</td>
                    <td>${esc(t.petugas_nama)}<br><span class="muted kecil">${esc(t.petugas_role)}</span></td>
                    <td class="muted kecil">${esc(t.alasan || (t.sisa_setelah !== null ? `sisa ${t.sisa_setelah}` : ''))}</td>
                  </tr>`,
                )
                .join('')}
            </tbody>
          </table></div>`;
        refs.daftar.appendChild(
          potonganHalaman(r, (p) => {
            f.page = p;
            muat();
          }),
        );
      } catch (err) {
        refs.daftar.innerHTML = kosongkan(err.message);
      }
    }

    // ------------------------------------------------------------- peristiwa
    let timer = null;
    refs.q.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        f.q = refs.q.value.trim();
        f.page = 1;
        muat();
      }, 320);
    });
    const perubahanSederhana = [
      ['jenis', 'jenisId'], ['status', 'status'], ['petugas', 'petugasId'], ['kategori', 'kategori'],
      ['dari', 'dari'], ['sampai', 'sampai'],
    ];
    perubahanSederhana.forEach(([ref, kunci]) =>
      refs[ref].addEventListener('change', () => {
        f[kunci] = refs[ref].value;
        f.page = 1;
        muat();
      }),
    );

    function aturPeriode(dari, sampai) {
      f.dari = dari;
      f.sampai = sampai;
      f.page = 1;
      refs.dari.value = dari;
      refs.sampai.value = sampai;
      muat();
    }
    konten.querySelector('#r-hari-ini').addEventListener('click', () => aturPeriode(tanggalHariIni(), tanggalHariIni()));
    konten.querySelector('#r-7hari').addEventListener('click', () => aturPeriode(tanggalKe(-6), tanggalHariIni()));
    konten.querySelector('#r-semua').addEventListener('click', () => aturPeriode('', ''));
    konten.querySelector('#r-reset').addEventListener('click', () => {
      Object.assign(f, { q: '', jenisId: '', status: '', kategori: '', dari: '', sampai: '', petugasId: '', page: 1 });
      refs.q.value = '';
      refs.jenis.value = '';
      refs.status.value = '';
      refs.kategori.value = '';
      refs.petugas.value = '';
      refs.dari.value = '';
      refs.sampai.value = '';
      muat();
    });
    konten.querySelector('#r-ekspor').addEventListener('click', (e) =>
      jalankan(e.currentTarget, () =>
        unduhBerkas(
          `/api/transaksi/export.xlsx${qs({
            q: f.q, jenisId: f.jenisId, status: f.status, kategori: f.kategori,
            petugasId: f.petugasId, dari: f.dari, sampai: f.sampai,
          })}`,
        ),
      ).then(() => sukses('Ekspor dimulai.'), (err) => galat(err.message)),
    );

    refs.status.value = f.status;
    isiPilihan();
    muat();
  },
};
