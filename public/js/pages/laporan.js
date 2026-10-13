/** Halaman laporan: penggunaan per peserta, rekap per jenis transaksi, ekspor Excel. */

import { api, qs, unduhBerkas } from '../api.js';
import {
  esc, galat, sukses, jalankan, potonganHalaman, kosongkan, angka,
  bilahPersen, tanggalHariIni, tanggalKe,
} from '../ui.js';

const f = { q: '', kategori: '', status: '', page: 1, perPage: 25 };
const periode = { dari: '', sampai: '' };

export default {
  judul: 'Laporan',
  peran: ['admin'],

  render(konten) {
    konten.innerHTML = `
      <div class="kartu">
        <div class="tab">
          <button data-tab="peserta" class="aktif">Penggunaan per peserta</button>
          <button data-tab="jenis">Rekap per jenis transaksi</button>
        </div>
        <div id="panel"></div>
      </div>`;

    const panel = konten.querySelector('#panel');
    const tabs = konten.querySelectorAll('.tab button');

    tabs.forEach((b) =>
      b.addEventListener('click', () => {
        tabs.forEach((x) => x.classList.toggle('aktif', x === b));
        if (b.dataset.tab === 'peserta') gambarPerPeserta();
        else gambarRekapJenis();
      }),
    );

    async function isiKategori(selectEl) {
      try {
        const k = await api.get('/api/peserta/kategori');
        selectEl.innerHTML =
          '<option value="">Semua kategori</option>' +
          (k.kategori || []).map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
        selectEl.value = f.kategori;
      } catch {
        /* abaikan */
      }
    }

    // -------------------------------------------------- per peserta
    async function gambarPerPeserta() {
      panel.innerHTML = `
        <div class="baris-bidang" style="margin-bottom:.6rem">
          <label class="bidang"><span>Pencarian peserta</span>
            <input type="search" id="l-q" value="${esc(f.q)}" placeholder="Nama atau nomor peserta" /></label>
          <label class="bidang"><span>Kategori</span><select id="l-kategori"></select></label>
          <label class="bidang"><span>Status peserta</span>
            <select id="l-status">
              <option value="">Semua</option><option value="aktif">Aktif</option><option value="nonaktif">Nonaktif</option>
            </select></label>
          <label class="bidang"><span>&nbsp;</span>
            <button class="tombol biru" id="l-ekspor">⬇ Ekspor Excel</button></label>
        </div>
        <p class="muted kecil">Angka pada tiap kolom berarti <strong>terpakai / batas</strong>. Tanda “—” berarti peserta tidak berhak.</p>
        <div id="l-daftar"><div class="pemuat">Memuat…</div></div>`;

      const daftar = panel.querySelector('#l-daftar');
      const refQ = panel.querySelector('#l-q');
      await isiKategori(panel.querySelector('#l-kategori'));
      panel.querySelector('#l-status').value = f.status;

      let timer = null;
      refQ.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          f.q = refQ.value.trim();
          f.page = 1;
          muat();
        }, 320);
      });
      panel.querySelector('#l-kategori').addEventListener('change', (e) => {
        f.kategori = e.target.value;
        f.page = 1;
        muat();
      });
      panel.querySelector('#l-status').addEventListener('change', (e) => {
        f.status = e.target.value;
        f.page = 1;
        muat();
      });
      panel.querySelector('#l-ekspor').addEventListener('click', (e) =>
        jalankan(e.currentTarget, () =>
          unduhBerkas(
            `/api/laporan/export.xlsx${qs({ tipe: 'per-peserta', q: f.q, kategori: f.kategori, status: f.status })}`,
          ),
        ).then(() => sukses('Ekspor laporan dimulai.'), (err) => galat(err.message)),
      );

      async function muat() {
        daftar.innerHTML = '<div class="pemuat">Memuat…</div>';
        try {
          const r = await api.get(
            `/api/laporan/per-peserta${qs({ q: f.q, kategori: f.kategori, status: f.status, page: f.page, perPage: f.perPage })}`,
          );
          if (!r.data.length) {
            daftar.innerHTML = kosongkan('Tidak ada peserta yang cocok.');
            return;
          }
          daftar.innerHTML = `
            <div class="bungkus-tabel"><table class="data" style="min-width:${420 + r.jenis.length * 120}px">
              <thead><tr>
                <th>Peserta</th>
                ${r.jenis.map((j) => `<th class="angka">${esc(j.nama)}</th>`).join('')}
                <th class="angka">Total terpakai</th><th class="angka">Total kuota</th>
              </tr></thead>
              <tbody>
                ${r.data
                  .map(
                    (p) => `<tr>
                      <td><strong>${esc(p.nama)}</strong><br>
                        <span class="muted kecil mono">${esc(p.nomorPeserta)}</span>
                        ${p.aktif ? '' : '<span class="lencana abu">nonaktif</span>'}</td>
                      ${p.perJenis
                        .map((k) => {
                          const penuh = k.batas > 0 && k.terpakai >= k.batas;
                          const kosong = k.batas === 0;
                          return `<td class="angka ${penuh ? 'peringatan-kuota' : ''}">
                            ${kosong ? '—' : `${angka(k.terpakai)} / ${angka(k.batas)}`}
                            ${k.khusus ? '<br><span class="lencana biru">khusus</span>' : ''}
                          </td>`;
                        })
                        .join('')}
                      <td class="angka">${angka(p.totalTerpakai)}</td>
                      <td class="angka">${angka(p.totalBatas)}</td>
                    </tr>`,
                  )
                  .join('')}
              </tbody>
            </table></div>`;
          daftar.appendChild(
            potonganHalaman(r, (h) => {
              f.page = h;
              muat();
            }),
          );
        } catch (err) {
          daftar.innerHTML = kosongkan(err.message);
        }
      }
      muat();
    }

    // -------------------------------------------------- rekap per jenis
    async function gambarRekapJenis() {
      panel.innerHTML = `
        <div class="baris-bidang" style="margin-bottom:.6rem">
          <label class="bidang"><span>Dari tanggal</span><input type="date" id="rj-dari" value="${esc(periode.dari)}" /></label>
          <label class="bidang"><span>Sampai tanggal</span><input type="date" id="rj-sampai" value="${esc(periode.sampai)}" /></label>
          <label class="bidang"><span>&nbsp;</span>
            <div class="aksi-baris">
              <button class="tombol kecil" id="rj-hariini">Hari ini</button>
              <button class="tombol kecil" id="rj-semua">Semua</button>
              <button class="tombol kecil biru" id="rj-ekspor">⬇ Ekspor Excel</button>
            </div></label>
        </div>
        <div id="rj-daftar"><div class="pemuat">Memuat…</div></div>`;

      const daftar = panel.querySelector('#rj-daftar');
      const refDari = panel.querySelector('#rj-dari');
      const refSampai = panel.querySelector('#rj-sampai');

      function atur(dari, sampai) {
        periode.dari = dari;
        periode.sampai = sampai;
        refDari.value = dari;
        refSampai.value = sampai;
        muat();
      }
      refDari.addEventListener('change', () => {
        periode.dari = refDari.value;
        muat();
      });
      refSampai.addEventListener('change', () => {
        periode.sampai = refSampai.value;
        muat();
      });
      panel.querySelector('#rj-hariini').addEventListener('click', () => atur(tanggalHariIni(), tanggalHariIni()));
      panel.querySelector('#rj-semua').addEventListener('click', () => atur('', ''));
      panel.querySelector('#rj-ekspor').addEventListener('click', (e) =>
        jalankan(e.currentTarget, () => unduhBerkas('/api/laporan/export.xlsx?tipe=rekap-jenis')).then(
          () => sukses('Ekspor rekap dimulai.'),
          (err) => galat(err.message),
        ),
      );

      async function muat() {
        daftar.innerHTML = '<div class="pemuat">Memuat…</div>';
        try {
          const r = await api.get(`/api/laporan/rekap-jenis${qs({ dari: periode.dari, sampai: periode.sampai })}`);
          const totalKuota = r.data.reduce((a, b) => a + b.batasTotal, 0);
          const totalPakai = r.data.reduce((a, b) => a + b.terpakai, 0);
          daftar.innerHTML = `
            <div class="kisi j4" style="margin-bottom:.7rem">
              <div class="kartu-stat"><span class="angka">${angka(totalKuota)}</span><span class="label">Total kuota tersedia</span></div>
              <div class="kartu-stat hijau"><span class="angka">${angka(totalPakai)}</span><span class="label">Total terpakai</span></div>
              <div class="kartu-stat biru"><span class="angka">${angka(totalKuota - totalPakai)}</span><span class="label">Sisa kuota</span></div>
              <div class="kartu-stat kuning"><span class="angka">${totalKuota ? Math.round((totalPakai / totalKuota) * 1000) / 10 : 0}%</span><span class="label">Serapan</span></div>
            </div>
            <div class="bungkus-tabel"><table class="data" style="min-width:820px">
              <thead><tr>
                <th>Jenis Transaksi</th><th class="angka">Batas bawaan</th><th>Serapan</th>
                <th class="angka">Terpakai</th><th class="angka">Total kuota</th><th class="angka">Sisa</th>
                <th class="angka">Peserta memakai</th><th class="angka">Ditolak</th>
              </tr></thead>
              <tbody>
                ${r.data
                  .map(
                    (j) => `<tr>
                      <td><strong>${esc(j.nama)}</strong></td>
                      <td class="angka">${angka(j.batasDefault)}</td>
                      <td style="min-width:130px">${bilahPersen(j.persen)}<span class="muted kecil">${j.persen}%</span></td>
                      <td class="angka">${angka(j.terpakai)}</td>
                      <td class="angka">${angka(j.batasTotal)}</td>
                      <td class="angka">${angka(j.sisa)}</td>
                      <td class="angka">${angka(j.pesertaMemakai)} / ${angka(j.jumlahPeserta)}</td>
                      <td class="angka">${angka(j.ditolak)}</td>
                    </tr>`,
                  )
                  .join('')}
              </tbody>
            </table></div>`;
        } catch (err) {
          daftar.innerHTML = kosongkan(err.message);
        }
      }
      muat();
    }

    gambarPerPeserta();
  },
};
