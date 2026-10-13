/** Halaman pengaturan event & keamanan transaksi. */

import { api } from '../api.js';
import { state, muatPengaturan } from '../state.js';
import { esc, sukses, galat, jalankan } from '../ui.js';

export default {
  judul: 'Pengaturan',
  peran: ['admin'],

  render(konten) {
    konten.innerHTML = `
      <div class="kisi j2">
        <div class="kartu">
          <header><h3>Identitas event</h3></header>
          <form id="form-pengaturan">
            <label class="bidang"><span>Nama event (tampil di barcode & kartu peserta)</span>
              <input name="nama_event" required maxlength="120" value="${esc(state.pengaturan.nama_event || '')}" /></label>
            <label class="bidang"><span>Jeda anti-duplikat (detik)</span>
              <input type="number" name="jeda_duplikat_detik" min="0" max="300"
                     value="${esc(state.pengaturan.jeda_duplikat_detik ?? 5)}" /></label>
            <p class="muted kecil">
              Bila barcode yang sama dipindai lagi untuk jenis transaksi yang sama dalam rentang jeda ini,
              transaksi dianggap pemindaian ganda: kuota <strong>tidak</strong> berkurang dua kali.
              Isi <strong>0</strong> untuk menonaktifkan pengaman ini.
            </p>
            <div class="pesan-galat" id="p-error" hidden></div>
            <button class="tombol utama" type="submit" id="p-simpan">Simpan pengaturan</button>
          </form>
        </div>

        <div class="kartu">
          <header><h3>Keamanan & data</h3></header>
          <ul class="muted kecil" style="padding-left:1.1rem">
            <li>Peran <strong>Admin</strong> dapat mengelola peserta, batas transaksi, pengguna, dan laporan.</li>
            <li>Peran <strong>Petugas</strong> hanya dapat memindai dan melihat hasil transaksi.</li>
            <li>Setiap penambahan, perubahan, penghapusan, dan transaksi dicatat beserta pelakunya.</li>
            <li>Batas kuota diperiksa di dalam satu transaksi database, sehingga kuota tidak bisa terlampaui
                meskipun banyak pemindaian masuk bersamaan.</li>
            <li>Gunakan menu <strong>Pengguna → Catatan aktivitas</strong> untuk menelusuri perubahan.</li>
          </ul>
          <p class="muted kecil" style="margin-top:.6rem">
            Lokasi basis data ditentukan saat server dijalankan (<code class="mono">data/event.db</code>).
            Cadangkan berkas tersebut secara berkala selama event berlangsung.
          </p>
        </div>
      </div>`;

    const form = konten.querySelector('#form-pengaturan');
    const kotak = konten.querySelector('#p-error');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      kotak.hidden = true;
      await jalankan(konten.querySelector('#p-simpan'), async () => {
        try {
          await api.put('/api/pengaturan', {
            nama_event: form.nama_event.value.trim(),
            jeda_duplikat_detik: Number(form.jeda_duplikat_detik.value),
          });
          await muatPengaturan();
          document.getElementById('nama-event-top').textContent = state.pengaturan.nama_event;
          sukses('Pengaturan disimpan.');
        } catch (err) {
          kotak.textContent = err.message;
          kotak.hidden = false;
        }
      });
    });
  },
};
