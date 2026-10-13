/**
 * Menu gabungan **Jenis Transaksi**.
 *
 * Dulu terpisah menjadi dua menu yang tumpang tindih:
 *   - "Pilih Jenis Transaksi" (centang jenis yang dipakai + tambah jenis)
 *   - "Batas Transaksi"       (batas bawaan + batas khusus per peserta)
 *
 * Keduanya menyentuh entitas yang sama (jenis transaksi), jadi disatukan:
 *   Tab 1 — Jenis & batas bawaan : centang jenis yang dipakai, edit batas bawaan,
 *                                  statistik pemakaian, tambah/ubah jenis transaksi.
 *   Tab 2 — Batas per peserta    : batas khusus tiap peserta × jenis.
 *
 * Hanya jenis yang dicentang yang muncul di halaman Pemindaian dan bisa dipindai.
 * Jenis yang tidak dipakai tidak bisa dipindai, tetapi riwayatnya tetap
 * ditampilkan di menu Riwayat & Laporan.
 */

import { api, qs } from '../api.js';
import { muatJenis } from '../state.js';
import {
  esc, sukses, galat, peringatan, bukaDialog, tutupDialog, konfirmasi, jalankan,
  potonganHalaman, kosongkan, angka, bilahPersen,
} from '../ui.js';

export default {
  judul: 'Jenis Transaksi',
  peran: ['admin'],

  render(konten, { pergi }) {
    konten.innerHTML = `
      <div class="kartu">
        <header>
          <h2>Jenis Transaksi</h2>
          <div class="spacer"></div>
          <span class="lencana biru" id="lencana-terpilih">…</span>
          <button class="tombol biru kecil" id="tombol-lanjut">Lanjut ke Pemindaian →</button>
        </header>
        <p class="muted" style="margin:0">
          Centang jenis transaksi yang dipakai saat event. Hanya jenis yang
          <strong>tercentang</strong> yang muncul di halaman Pemindaian dan bisa dipindai;
          jenis yang tidak dipakai tetap tercatat riwayatnya di Riwayat &amp; Laporan.
          Batas khusus per peserta diatur pada tab <strong>Batas per peserta</strong>.
        </p>
      </div>

      <div class="kartu">
        <div class="tab">
          <button data-tab="jenis" class="aktif">Jenis &amp; batas bawaan</button>
          <button data-tab="peserta">Batas per peserta</button>
        </div>
        <div id="panel"></div>
      </div>`;

    const panel = konten.querySelector('#panel');
    const lencana = konten.querySelector('#lencana-terpilih');
    const tabButtons = konten.querySelectorAll('.tab button');

    /** Pilihan tersimpan di server — dipakai untuk menandai perubahan belum disimpan. */
    let asalTerpilih = [];

    function daftarJenis() {
      return [...panel.querySelectorAll('input[data-pilih]')];
    }
    function terpilih() {
      return daftarJenis().filter((i) => i.checked).map((i) => Number(i.dataset.pilih));
    }
    function setara(a, b) {
      const x = [...a].sort((m, n) => m - n);
      const y = [...b].sort((m, n) => m - n);
      return x.length === y.length && x.every((v, i) => v === y[i]);
    }

    function perbaruiLencana() {
      const semua = daftarJenis();
      if (!semua.length) {
        lencana.textContent = 'Belum ada jenis transaksi';
        lencana.className = 'lencana merah';
        return;
      }
      const pilih = terpilih();
      const bersih = setara(pilih, asalTerpilih);
      lencana.textContent = bersih
        ? `${angka(pilih.length)} dari ${angka(semua.length)} jenis dipakai`
        : `${angka(pilih.length)} dari ${angka(semua.length)} belum disimpan`;
      lencana.className = `lencana ${bersih ? (pilih.length ? 'biru' : 'merah') : 'kuning'}`;
      const tombolSimpan = panel.querySelector('#tombol-simpan');
      if (tombolSimpan) tombolSimpan.disabled = pilih.length === 0;
      const tombolTambah = panel.querySelector('#tombol-terapkan-semua');
      if (tombolTambah) tombolTambah.disabled = pilih.length === 0;
    }

    function pasangTab(nama) {
      tabButtons.forEach((b) => b.classList.toggle('aktif', b.dataset.tab === nama));
      if (nama === 'jenis') gambarJenis();
      else gambarPeserta();
    }
    tabButtons.forEach((b) => b.addEventListener('click', () => pasangTab(b.dataset.tab)));
    konten.querySelector('#tombol-lanjut').addEventListener('click', () => pergi('scan'));

    // ------------------------------------------- Tab 1: jenis & batas bawaan
    async function gambarJenis() {
      panel.innerHTML = `
        <header class="aksi-baris" style="margin-bottom:.7rem">
          <button class="tombol kecil" id="tombol-semua">☑ Pilih semua transaksi</button>
          <button class="tombol kecil" id="tombol-kosong">Kosongkan pilihan</button>
          <button class="tombol utama kecil" id="tombol-simpan" disabled>Simpan pilihan</button>
          <span class="spacer"></span>
          <button class="tombol kecil" id="tambah-jenis">+ Jenis transaksi baru</button>
        </header>
        <div id="jenis-isi"><div class="pemuat">Memuat…</div></div>`;

      const isi = panel.querySelector('#jenis-isi');

      try {
        const r = await api.get('/api/jenis');
        const jenis = r.jenis;
        if (!jenis.length) {
          isi.innerHTML = kosongkan('Belum ada jenis transaksi. Tambahkan dengan tombol "Jenis transaksi baru".');
          perbaruiLencana();
          return;
        }
        asalTerpilih = jenis.filter((j) => j.aktif).map((j) => j.id);

        isi.innerHTML = `
          <div class="bungkus-tabel"><table class="data" style="min-width:1060px">
            <thead><tr>
              <th style="width:56px">Pakai</th>
              <th>Jenis Transaksi</th>
              <th class="angka" style="width:112px">Batas bawaan</th>
              <th style="width:132px">Pemakaian</th>
              <th class="angka">Hari ini</th>
              <th class="angka">Terpakai</th>
              <th class="angka">Ditolak</th>
              <th class="angka">Batas khusus</th>
              <th style="width:320px">Aksi</th>
            </tr></thead>
            <tbody>
              ${jenis
                .map((j) => {
                  const total = j.batas_default * (j.totalPesertaAktif || 0);
                  const persen = total > 0 ? Math.round((j.total_terpakai / total) * 100) : 0;
                  return `<tr data-jenis="${j.id}">
                    <td>
                      <input type="checkbox" data-pilih="${j.id}" ${j.aktif ? 'checked' : ''}
                             aria-label="Pakai ${esc(j.nama)}" style="width:20px;height:20px" />
                    </td>
                    <td>
                      <strong>${esc(j.nama)}</strong>
                      <br><span class="muted kecil mono">${esc(j.kode)}</span>
                    </td>
                    <td class="angka"><input type="number" min="0" max="999" data-batas="${j.id}" value="${j.batas_default}" /></td>
                    <td>${bilahPersen(persen)}<span class="muted kecil">${persen}% dari kuota bawaan</span></td>
                    <td class="angka">${angka(j.terpakai_hari_ini)}</td>
                    <td class="angka">${angka(j.total_terpakai)}</td>
                    <td class="angka">${angka(j.total_ditolak)}</td>
                    <td class="angka">${angka(j.jumlah_override)}</td>
                    <td>
                      <div class="aksi-baris">
                        <button class="tombol kecil utama" data-simpan="${j.id}">Simpan</button>
                        <button class="tombol kecil" data-terapkan="${j.id}">Terapkan ke semua peserta</button>
                        <button class="tombol kecil" data-hapus-ovr="${j.id}" ${j.jumlah_override ? '' : 'disabled'}>Hapus batas khusus</button>
                        <button class="tombol kecil" data-ubah="${j.id}">Ubah</button>
                      </div>
                    </td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table></div>
          <p class="muted kecil" style="margin-top:.6rem">
            Angka <strong>0</strong> pada batas bawaan berarti peserta tidak berhak atas transaksi tersebut.
            <strong>Hari ini</strong> dihitung pada tanggal lokal ${esc(r.ringkasan.tanggal)} (waktu panitia, bukan UTC).
            Batas bawaan berlaku untuk semua peserta yang tidak punya batas khusus.
          </p>`;

        isi.querySelectorAll('input[data-pilih]').forEach((i) =>
          i.addEventListener('change', perbaruiLencana),
        );

        isi.querySelectorAll('[data-simpan]').forEach((b) =>
          b.addEventListener('click', (e) =>
            jalankan(e.currentTarget, async () => {
              const id = Number(b.dataset.simpan);
              const nilai = isi.querySelector(`input[data-batas="${id}"]`).value;
              try {
                await api.put(`/api/jenis/${id}`, { batas_default: Number(nilai) });
                sukses('Batas bawaan disimpan.');
                await muatJenis(true);
                gambarJenis();
              } catch (err) {
                galat(err.message);
              }
            }),
          ),
        );

        isi.querySelectorAll('[data-terapkan]').forEach((b) =>
          b.addEventListener('click', () => {
            const id = Number(b.dataset.terapkan);
            const j = jenis.find((x) => x.id === id);
            const nilai = isi.querySelector(`input[data-batas="${id}"]`).value;
            konfirmasi({
              judul: 'Terapkan ke semua peserta aktif?',
              pesan: `Batas ${nilai} untuk "${j.nama}" akan ditulis sebagai batas khusus pada semua peserta aktif (${j.totalPesertaAktif} orang). Gunakan ini untuk menyeragamkan kuota seluruh peserta.`,
              tombol: 'Terapkan',
              jenis: 'utama',
            }).then(async (ok) => {
              if (!ok) return;
              try {
                const res = await api.post(`/api/kuota/jenis/${id}/terapkan`, { batas: Number(nilai) });
                sukses(`Batas ${res.batas} diterapkan ke ${res.jumlahPeserta} peserta.`);
                gambarJenis();
              } catch (err) {
                galat(err.message);
              }
            });
          }),
        );

        isi.querySelectorAll('[data-hapus-ovr]').forEach((b) =>
          b.addEventListener('click', async () => {
            const id = Number(b.dataset.hapusOvr);
            const j = jenis.find((x) => x.id === id);
            const ok = await konfirmasi({
              judul: 'Hapus semua batas khusus?',
              pesan: `Semua peserta akan kembali memakai batas bawaan untuk "${j.nama}".`,
              tombol: 'Hapus',
            });
            if (!ok) return;
            try {
              const res = await api.post(`/api/kuota/jenis/${id}/hapus-override`);
              sukses(`${res.dihapus} batas khusus dihapus.`);
              gambarJenis();
            } catch (err) {
              galat(err.message);
            }
          }),
        );

        isi.querySelectorAll('[data-ubah]').forEach((b) =>
          b.addEventListener('click', () => {
            dialogJenis(jenis.find((x) => x.id === Number(b.dataset.ubah)), gambarJenis);
          }),
        );

        perbaruiLencana();
      } catch (err) {
        isi.innerHTML = kosongkan(err.message);
      }
    }

    // Simpan pilihan jenis (endpoint yang sama dipakai tombol "pilih semua").
    async function simpanPilihan(pilihan, tombol) {
      const ids = terpilih();
      if (!ids.length) {
        peringatan('Minimal satu jenis transaksi harus dipilih, jika tidak petugas tidak bisa memindai apa pun.');
        return;
      }
      await jalankan(tombol, async () => {
        try {
          const res = await api.post('/api/jenis/pilih', pilihan || { ids });
          const bagian = [];
          if (res.dinyalakan.length) bagian.push(`${res.dinyalakan.length} ditambahkan`);
          if (res.dimatikan.length) bagian.push(`${res.dimatikan.length} dikeluarkan`);
          sukses(
            `Pilihan disimpan: ${res.jumlahDipilih} dari ${res.jumlahTotal} jenis dipakai${
              bagian.length ? ` (${bagian.join(', ')})` : ''
            }.`,
          );
          await muatJenis(true);
          gambarJenis();
        } catch (err) {
          galat(err.message);
        }
      });
    }

    panel.addEventListener('click', (e) => {
      const id = e.target.closest('button')?.id;
      if (id === 'tombol-semua') {
        daftarJenis().forEach((i) => {
          i.checked = true;
        });
        perbaruiLencana();
        simpanPilihan({ aktifkanSemua: true }, e.target.closest('button'));
      } else if (id === 'tombol-kosong') {
        daftarJenis().forEach((i) => {
          i.checked = false;
        });
        perbaruiLencana();
        peringatan(
          'Semua centang dilepas. Klik "Simpan pilihan" untuk menerapkannya, atau centang kembali jenis yang dipakai.',
        );
      } else if (id === 'tombol-simpan') {
        simpanPilihan(null, e.target.closest('button'));
      } else if (id === 'tambah-jenis') {
        dialogJenis(null, async () => {
          await muatJenis(true);
          gambarJenis();
        });
      }
    });

    // ------------------------------------------- Tab 2: batas per peserta
    const fp = { q: '', page: 1, perPage: 25 };
    let waktuCari = null;

    async function gambarPeserta() {
      panel.innerHTML = `
        <header class="aksi-baris" style="margin-bottom:.7rem">
          <input type="search" id="kp-q" placeholder="Cari nama / nomor peserta" value="${esc(fp.q)}" style="max-width:320px" />
          <span class="muted kecil">Isi kolom untuk memberi batas khusus. Kosongkan agar memakai batas bawaan.</span>
        </header>
        <div id="kp-daftar"><div class="pemuat">Memuat…</div></div>`;

      const daftar = panel.querySelector('#kp-daftar');
      panel.querySelector('#kp-q').addEventListener('input', (e) => {
        clearTimeout(waktuCari);
        waktuCari = setTimeout(() => {
          fp.q = e.target.value.trim();
          fp.page = 1;
          muatBaris();
        }, 320);
      });

      async function muatBaris() {
        daftar.innerHTML = '<div class="pemuat">Memuat…</div>';
        try {
          const r = await api.get(`/api/laporan/per-peserta${qs({ q: fp.q, page: fp.page, perPage: fp.perPage })}`);
          if (!r.data.length) {
            daftar.innerHTML = fp.q
              ? kosongkan('Tidak ada peserta yang cocok dengan pencarian ini.')
              : kosongkan(
                  'Belum ada peserta. Impor data peserta lewat menu Peserta → Impor Excel terlebih dahulu.',
                );
            return;
          }
          const jenis = r.jenis;
          daftar.innerHTML = `
            <div class="bungkus-tabel"><table class="data" style="min-width:${420 + jenis.length * 110}px">
              <thead><tr>
                <th>Peserta</th>
                ${jenis.map((j) => `<th class="angka">${esc(j.nama)}<br><span class="muted kecil">bawaan ${j.batas_default}</span></th>`).join('')}
                <th style="width:190px">Aksi</th>
              </tr></thead>
              <tbody>
                ${r.data
                  .map(
                    (p) => `<tr data-peserta="${p.pesertaId}">
                      <td><strong>${esc(p.nama)}</strong><br>
                        <span class="muted kecil mono">${esc(p.nomorPeserta)}</span>
                        ${p.aktif ? '' : '<span class="lencana abu">nonaktif</span>'}</td>
                      ${p.perJenis
                        .map((k) => {
                          const penuh = k.batas > 0 && k.terpakai >= k.batas;
                          return `<td class="angka">
                            <input type="number" min="0" max="999" data-jenis="${k.jenisId}"
                                   value="${k.khusus ? k.batas : ''}" placeholder="${k.batas}" style="width:72px"
                                   title="${k.khusus ? 'Batas khusus' : 'Batas bawaan'}: ${k.batas}" />
                            <div class="muted kecil ${penuh ? 'peringatan-kuota' : ''}">pakai ${k.terpakai}/${k.batas}</div>
                          </td>`;
                        })
                        .join('')}
                      <td>
                        <div class="aksi-baris">
                          <button class="tombol kecil utama" data-simpan-peserta="${p.pesertaId}">Simpan</button>
                          <button class="tombol kecil" data-reset-peserta="${p.pesertaId}">Bawaan</button>
                        </div>
                      </td>
                    </tr>`,
                  )
                  .join('')}
              </tbody>
            </table></div>`;
          daftar.appendChild(
            potonganHalaman({ ...r, perPage: fp.perPage }, (h) => {
              fp.page = h;
              muatBaris();
            }),
          );

          daftar.querySelectorAll('[data-simpan-peserta]').forEach((b) =>
            b.addEventListener('click', (e) =>
              jalankan(e.currentTarget, async () => {
                const baris = b.closest('tr');
                const items = [...baris.querySelectorAll('input[data-jenis]')].map((inp) => ({
                  jenisId: Number(inp.dataset.jenis),
                  batas: inp.value === '' ? null : Number(inp.value),
                }));
                try {
                  await api.put(`/api/kuota/peserta/${b.dataset.simpanPeserta}`, { items });
                  sukses('Batas peserta disimpan.');
                  muatBaris();
                } catch (err) {
                  galat(err.message);
                }
              }),
            ),
          );

          daftar.querySelectorAll('[data-reset-peserta]').forEach((b) =>
            b.addEventListener('click', async () => {
              const ok = await konfirmasi({
                judul: 'Kembalikan ke batas bawaan?',
                pesan: 'Semua batas khusus peserta ini akan dihapus.',
                tombol: 'Kembalikan',
              });
              if (!ok) return;
              try {
                await api.post(`/api/kuota/peserta/${b.dataset.resetPeserta}/reset`);
                sukses('Batas peserta dikembalikan ke bawaan.');
                muatBaris();
              } catch (err) {
                galat(err.message);
              }
            }),
          );
        } catch (err) {
          daftar.innerHTML = kosongkan(err.message);
        }
      }
      muatBaris();
    }

    pasangTab('jenis');
  },
};

/** Satu-satunya form tambah/ubah jenis transaksi (dipakai menu ini saja). */
function dialogJenis(jenis, setelah) {
  const baru = !jenis;
  bukaDialog(
    `<header><h3>${baru ? 'Jenis transaksi baru' : 'Ubah jenis transaksi'}</h3></header>
     <form id="form-jenis">
       <div class="baris-bidang">
         <label class="bidang"><span>Kode (huruf/angka/garis bawah)</span>
           <input name="kode" required value="${esc(jenis?.kode || '')}" ${baru ? '' : 'readonly'} /></label>
         <label class="bidang"><span>Nama tampilan di tombol pindai</span>
           <input name="nama" required value="${esc(jenis?.nama || '')}" /></label>
       </div>
       <div class="baris-bidang">
         <label class="bidang"><span>Batas bawaan</span>
           <input type="number" name="batas_default" min="0" max="999" value="${jenis?.batas_default ?? 1}" /></label>
         <label class="bidang"><span>Urutan tampil</span>
           <input type="number" name="urutan" value="${jenis?.urutan ?? 99}" /></label>
       </div>
       <p class="muted kecil">Jenis baru langsung tercentang sehingga bisa langsung dipakai memindai.</p>
       <div class="pesan-galat" id="jenis-error" hidden></div>
       <footer>
         <button type="button" class="tombol" data-tutup>Batal</button>
         <button type="submit" class="tombol utama" id="simpan-jenis">${baru ? 'Tambah jenis' : 'Simpan'}</button>
       </footer>
     </form>`,
    {
      onMount(isi) {
        const form = isi.querySelector('#form-jenis');
        const kotak = isi.querySelector('#jenis-error');
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          kotak.hidden = true;
          const data = {
            kode: form.kode.value.trim(),
            nama: form.nama.value.trim(),
            batas_default: Number(form.batas_default.value),
            urutan: Number(form.urutan.value),
          };
          await jalankan(isi.querySelector('#simpan-jenis'), async () => {
            try {
              if (baru) await api.post('/api/jenis', data);
              else await api.put(`/api/jenis/${jenis.id}`, data);
              sukses(baru ? `Jenis transaksi "${data.nama}" ditambahkan.` : 'Jenis transaksi diperbarui.');
              tutupDialog();
              setelah && setelah();
            } catch (err) {
              kotak.textContent = err.message;
              kotak.hidden = false;
            }
          });
        });
      },
    },
  );
}
