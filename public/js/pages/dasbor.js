/** Dasbor: ringkasan cepat kondisi event. */

import { api } from '../api.js';
import { state } from '../state.js';
import { esc, angka, bilahPersen, kosongkan, fmtJam, lencanaStatus } from '../ui.js';

export default {
  judul: 'Dasbor',
  peran: ['admin'],

  render(konten) {
    konten.innerHTML = '<div class="pemuat">Memuat ringkasan…</div>';

    async function muat() {
      try {
        const r = await api.get('/api/laporan/ringkasan');
        const maxHari = Math.max(1, ...r.perHari.map((h) => (h.berhasil || 0) + (h.ditolak || 0)));

        konten.innerHTML = `
          <div class="kisi j4" style="margin-bottom:1rem">
            <div class="kartu kartu-stat hijau">
              <span class="angka">${angka(r.transaksi.berhasil)}</span>
              <span class="label">Transaksi berhasil</span>
              <span class="muted kecil">${angka(r.transaksi.hariIni)} di antaranya hari ini</span>
            </div>
            <div class="kartu kartu-stat merah">
              <span class="angka">${angka(r.transaksi.ditolak)}</span>
              <span class="label">Transaksi ditolak</span>
              <span class="muted kecil">barcode tak dikenal / kuota habis</span>
            </div>
            <div class="kartu kartu-stat kuning">
              <span class="angka">${angka(r.transaksi.ganda)}</span>
              <span class="label">Pemindaian ganda dicegah</span>
            </div>
            <div class="kartu kartu-stat biru">
              <span class="angka">${angka(r.peserta.aktif)}</span>
              <span class="label">Peserta aktif</span>
              <span class="muted kecil">dari ${angka(r.peserta.total)} terdaftar</span>
            </div>
          </div>

          <div class="kisi j2">
            <div class="kartu">
              <header><h3>Pemakaian per jenis transaksi</h3></header>
              ${
                r.perJenis.length
                  ? `<div class="bungkus-tabel"><table class="data" style="min-width:420px">
                      <thead><tr><th>Jenis</th><th>Serapan kuota</th><th class="angka">Terpakai</th><th class="angka">Sisa</th></tr></thead>
                      <tbody>
                        ${r.perJenis
                          .map((j) => {
                            const persen = j.batasTotal ? Math.round((j.terpakai / j.batasTotal) * 100) : 0;
                            return `<tr>
                              <td><strong>${esc(j.nama)}</strong><br><span class="muted kecil">bawaan ${angka(j.batasDefault)}×</span></td>
                              <td style="min-width:120px">${bilahPersen(persen)}<span class="muted kecil">${persen}%</span></td>
                              <td class="angka">${angka(j.terpakai)}</td>
                              <td class="angka">${angka(j.sisa)}</td>
                            </tr>`;
                          })
                          .join('')}
                      </tbody>
                    </table></div>`
                  : kosongkan('Belum ada jenis transaksi.')
              }
            </div>

            <div class="kartu">
              <header><h3>7 hari terakhir</h3></header>
              ${
                r.perHari.length
                  ? `<div class="kisi" style="gap:.55rem">
                      ${r.perHari
                        .map((h) => {
                          const total = (h.berhasil || 0) + (h.ditolak || 0);
                          const w = Math.round((total / maxHari) * 100);
                          return `<div>
                            <div class="aksi-baris kecil"><strong>${esc(h.tanggal)}</strong>
                              <span class="spacer"></span>
                              <span class="muted">${angka(h.berhasil)} berhasil · ${angka(h.ditolak)} ditolak</span></div>
                            <div class="bar" style="height:10px"><i class="${total && h.berhasil / total > 0.5 ? '' : 'penuh'}" style="width:${w}%"></i></div>
                          </div>`;
                        })
                        .join('')}
                    </div>`
                  : kosongkan('Belum ada transaksi.')
              }
            </div>
          </div>

          <div class="kartu">
            <header><h3>Aktivitas terbaru</h3></header>
            ${
              r.aktivitasTerbaru.length
                ? `<div class="bungkus-tabel"><table class="data">
                    <thead><tr><th>Waktu</th><th>Status</th><th>Peserta</th><th>Jenis</th><th>Petugas</th></tr></thead>
                    <tbody>
                      ${r.aktivitasTerbaru
                        .map(
                          (t) => `<tr>
                            <td>${esc(fmtJam(t.waktu))}</td>
                            <td>${lencanaStatus(t.status)}</td>
                            <td>${esc(t.nama_peserta || t.kode_barcode || '-')}</td>
                            <td>${esc(t.jenis_nama)}</td>
                            <td>${esc(t.petugas_nama)}</td>
                          </tr>`,
                        )
                        .join('')}
                    </tbody>
                  </table></div>`
                : kosongkan('Belum ada aktivitas.')
            }
          </div>`;
      } catch (err) {
        konten.innerHTML = kosongkan(err.message);
      }
    }

    muat();
  },
};
