/** Halaman peserta: CRUD, impor/template Excel, barcode, dan batas per peserta. */

import { api, qs, unduhBerkas } from '../api.js';
import { state, muatJenis } from '../state.js';
import {
  esc, sukses, galat, bukaDialog, tutupDialog, konfirmasi, jalankan,
  potonganHalaman, kosongkan, angka,
} from '../ui.js';

const filter = { q: '', kategori: '', status: 'semua', page: 1, perPage: 25 };

export default {
  judul: 'Data Peserta',
  peran: ['admin'],

  render(konten) {
    konten.innerHTML = `
      <div class="kartu">
        <header>
          <h3>Data peserta</h3>
          <div class="spacer"></div>
          <button class="tombol kecil" id="btn-template">⬇ Unduh template Excel</button>
          <button class="tombol kecil biru" id="btn-impor">⬆ Impor Excel</button>
          <button class="tombol kecil" id="btn-ekspor">⬇ Ekspor Excel</button>
          <button class="tombol kecil" id="btn-cetak">🖨 Cetak barcode</button>
          <button class="tombol utama kecil" id="btn-tambah">+ Peserta</button>
        </header>

        <div class="baris-bidang" style="margin-bottom:.7rem">
          <label class="bidang"><span>Pencarian</span>
            <input type="search" id="f-q" placeholder="Nama, nomor peserta, atau kode barcode" value="${esc(filter.q)}" />
          </label>
          <label class="bidang"><span>Kategori</span><select id="f-kategori"></select></label>
          <label class="bidang"><span>Status</span>
            <select id="f-status">
              <option value="semua">Semua</option>
              <option value="aktif">Aktif</option>
              <option value="nonaktif">Nonaktif</option>
            </select>
          </label>
          <label class="bidang"><span>Baris per halaman</span>
            <select id="f-perPage">
              <option value="25">25</option><option value="50">50</option>
              <option value="100">100</option><option value="200">200</option>
            </select>
          </label>
        </div>

        <div id="daftar"><div class="pemuat">Memuat…</div></div>
      </div>`;

    const refs = {
      q: konten.querySelector('#f-q'),
      kategori: konten.querySelector('#f-kategori'),
      status: konten.querySelector('#f-status'),
      perPage: konten.querySelector('#f-perPage'),
      daftar: konten.querySelector('#daftar'),
    };

    async function muatKategori() {
      try {
        const r = await api.get('/api/peserta/kategori');
        refs.kategori.innerHTML =
          `<option value="">Semua kategori</option>` +
          (r.kategori || []).map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
        refs.kategori.value = filter.kategori;
      } catch {
        refs.kategori.innerHTML = '<option value="">Semua kategori</option>';
      }
    }

    async function muat() {
      refs.daftar.innerHTML = '<div class="pemuat">Memuat…</div>';
      try {
        const r = await api.get(
          `/api/peserta${qs({
            q: filter.q, kategori: filter.kategori,
            status: filter.status === 'semua' ? '' : filter.status,
            page: filter.page, perPage: filter.perPage,
          })}`,
        );
        if (!r.data.length) {
          refs.daftar.innerHTML = kosongkan('Tidak ada peserta yang cocok dengan filter.');
          return;
        }
        refs.daftar.innerHTML = `
          <div class="bungkus-tabel">
            <table class="data">
              <thead><tr>
                <th>Nomor</th><th>Nama</th><th>Kategori</th><th>Kontak</th>
                <th>Kode Barcode</th><th class="angka">Transaksi</th><th>Status</th><th>Aksi</th>
              </tr></thead>
              <tbody>
                ${r.data
                  .map(
                    (p) => `<tr>
                      <td class="mono">${esc(p.nomor_peserta)}</td>
                      <td><strong>${esc(p.nama)}</strong></td>
                      <td>${esc(p.kategori || '-')}</td>
                      <td>${esc(p.kontak || '-')}</td>
                      <td><span class="kotak-kode">${esc(p.kode_barcode)}</span></td>
                      <td class="angka">${angka(p.total_transaksi)}</td>
                      <td>${p.aktif ? '<span class="lencana ok">Aktif</span>' : '<span class="lencana abu">Nonaktif</span>'}</td>
                      <td>
                        <div class="aksi-baris">
                          <button class="tombol kecil" data-barcode="${p.id}">Barcode</button>
                          <button class="tombol kecil" data-kuota="${p.id}">Batas</button>
                          <button class="tombol kecil" data-ubah="${p.id}">Ubah</button>
                          <button class="tombol kecil" data-status="${p.id}" data-aktif="${p.aktif ? 1 : 0}">${p.aktif ? 'Nonaktifkan' : 'Aktifkan'}</button>
                          <button class="tombol kecil bahaya" data-hapus="${p.id}">Hapus</button>
                        </div>
                      </td>
                    </tr>`,
                  )
                  .join('')}
              </tbody>
            </table>
          </div>`;
        refs.daftar.appendChild(
          potonganHalaman(r, (p) => {
            filter.page = p;
            muat();
          }),
        );

        refs.daftar.querySelectorAll('[data-barcode]').forEach((b) =>
          b.addEventListener('click', () => dialogBarcode(Number(b.dataset.barcode), muat)),
        );
        refs.daftar.querySelectorAll('[data-kuota]').forEach((b) =>
          b.addEventListener('click', () => dialogKuota(Number(b.dataset.kuota), muat)),
        );
        refs.daftar.querySelectorAll('[data-ubah]').forEach((b) =>
          b.addEventListener('click', () => dialogForm(Number(b.dataset.ubah), muat)),
        );
        refs.daftar.querySelectorAll('[data-status]').forEach((b) =>
          b.addEventListener('click', () =>
            ubahStatusPeserta(Number(b.dataset.status), b.dataset.aktif === '1', muat),
          ),
        );
        refs.daftar.querySelectorAll('[data-hapus]').forEach((b) =>
          b.addEventListener('click', () => hapusPeserta(Number(b.dataset.hapus), muat)),
        );
      } catch (err) {
        refs.daftar.innerHTML = kosongkan(err.message);
      }
    }

    // --------------------------------------------------------- filter event
    let timerCari = null;
    refs.q.addEventListener('input', () => {
      clearTimeout(timerCari);
      timerCari = setTimeout(() => {
        filter.q = refs.q.value.trim();
        filter.page = 1;
        muat();
      }, 320);
    });
    refs.kategori.addEventListener('change', () => {
      filter.kategori = refs.kategori.value;
      filter.page = 1;
      muat();
    });
    refs.status.addEventListener('change', () => {
      filter.status = refs.status.value;
      filter.page = 1;
      muat();
    });
    refs.perPage.addEventListener('change', () => {
      filter.perPage = Number(refs.perPage.value);
      filter.page = 1;
      muat();
    });

    // --------------------------------------------------------------- tombol
    konten.querySelector('#btn-tambah').addEventListener('click', () => dialogForm(null, async () => {
      await muatKategori();
      muat();
    }));
    konten.querySelector('#btn-template').addEventListener('click', (e) =>
      jalankan(e.currentTarget, () => unduhBerkas('/api/peserta/template.xlsx')).catch((err) =>
        galat(err.message),
      ),
    );
    konten.querySelector('#btn-ekspor').addEventListener('click', (e) =>
      jalankan(e.currentTarget, () => unduhBerkas('/api/peserta/export.xlsx')).then(
        () => sukses('Ekspor dimulai.'),
        (err) => galat(err.message),
      ),
    );
    konten.querySelector('#btn-impor').addEventListener('click', () => dialogImpor(async () => {
      await muatKategori();
      muat();
    }));
    konten.querySelector('#btn-cetak').addEventListener('click', () => {
      const url = `/cetak-barcode.html${qs({ q: filter.q, kategori: filter.kategori })}`;
      window.open(url, '_blank');
    });

    refs.status.value = filter.status;
    refs.perPage.value = String(filter.perPage);
    muatKategori();
    muat();
  },
};

// ---------------------------------------------------------------------------
// Form tambah / ubah
// ---------------------------------------------------------------------------

export function dialogForm(id, setelahSimpan) {
  const baru = id === null;
  bukaDialog(
    `<header><h3>${baru ? 'Tambah peserta' : 'Ubah peserta'}</h3></header>
     <form id="form-peserta">
       <div class="baris-bidang">
         <label class="bidang"><span>Nomor peserta / ID unik *</span>
           <input name="nomor_peserta" required maxlength="40" placeholder="mis. 25013" /></label>
         <label class="bidang"><span>Nama lengkap *</span>
           <input name="nama" required maxlength="120" placeholder="mis. Andi Wijaya" /></label>
       </div>
       <div class="baris-bidang">
         <label class="bidang"><span>Kategori / kelompok</span>
           <select name="kategori">
             <option value="">— Pilih —</option>
             <option value="VIP">VIP</option>
             <option value="Karyawan">Karyawan</option>
             <option value="Panitia">Panitia</option>
           </select></label>
         <label class="bidang"><span>Kontak</span>
           <input name="kontak" maxlength="60" placeholder="mis. 0812xxxxxxx" /></label>
       </div>
       <label class="bidang" id="bidang-aktif" hidden><span>Status</span>
         <select name="aktif"><option value="1">Aktif</option><option value="0">Nonaktif</option></select></label>
       <div class="pesan-galat" id="form-error" hidden></div>
       <footer>
         <button type="button" class="tombol" data-tutup>Batal</button>
         <button type="submit" class="tombol utama" id="simpan-peserta">Simpan</button>
       </footer>
     </form>`,
    {
      onMount(isi) {
        const form = isi.querySelector('#form-peserta');
        const kotak = isi.querySelector('#form-error');
        if (!baru) {
          isi.querySelector('#bidang-aktif').hidden = false;
          api
            .get(`/api/peserta/${id}`)
            .then((r) => {
              form.nomor_peserta.value = r.peserta.nomor_peserta;
              form.nama.value = r.peserta.nama;
              const katLama = r.peserta.kategori || '';
              // Pertahankan kategori lama yang di luar daftar bawaan agar tidak
              // hilang diam-diam saat peserta diubah.
              if (katLama && ![...form.kategori.options].some((o) => o.value === katLama)) {
                form.kategori.add(new Option(katLama, katLama));
              }
              form.kategori.value = katLama;
              form.kontak.value = r.peserta.kontak || '';
              form.aktif.value = r.peserta.aktif ? '1' : '0';
            })
            .catch((err) => galat(err.message));
        } else {
          form.nomor_peserta.focus();
        }

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          kotak.hidden = true;
          const data = {
            nomor_peserta: form.nomor_peserta.value.trim(),
            nama: form.nama.value.trim(),
            kategori: form.kategori.value.trim(),
            kontak: form.kontak.value.trim(),
          };
          if (!baru) data.aktif = form.aktif.value === '1';
          await jalankan(isi.querySelector('#simpan-peserta'), async () => {
            try {
              if (baru) {
                const r = await api.post('/api/peserta', data);
                sukses(`Peserta ditambahkan. Kode barcode: ${r.kode_barcode}`);
              } else {
                await api.put(`/api/peserta/${id}`, data);
                sukses('Data peserta diperbarui.');
              }
              tutupDialog();
              setelahSimpan && setelahSimpan();
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

async function ubahStatusPeserta(id, aktifSekarang, setelah) {
  const jadiAktif = !aktifSekarang;
  const ya = await konfirmasi({
    judul: jadiAktif ? 'Aktifkan peserta?' : 'Nonaktifkan peserta?',
    pesan: jadiAktif
      ? 'Peserta akan aktif kembali dan barcode-nya dapat dipindai.'
      : 'Peserta dinonaktifkan. Barcode-nya tidak dapat dipindai sampai diaktifkan lagi. Riwayat transaksi tetap tersimpan.',
    tombol: jadiAktif ? 'Aktifkan' : 'Nonaktifkan',
  });
  if (!ya) return;
  try {
    await api.put(`/api/peserta/${id}`, { aktif: jadiAktif });
    sukses(jadiAktif ? 'Peserta diaktifkan.' : 'Peserta dinonaktifkan.');
    setelah();
  } catch (err) {
    galat(err.message);
  }
}

async function hapusPeserta(id, setelah) {
  const ya = await konfirmasi({
    judul: 'Hapus total peserta?',
    pesan:
      'Peserta akan dihapus total beserta SELURUH riwayat transaksinya. Data yang hilang tidak bisa dikembalikan dan angka laporannya ikut hilang. Lanjutkan?',
    tombol: 'Hapus total',
  });
  if (!ya) return;
  try {
    const r = await api.del(`/api/peserta/${id}`);
    sukses(r.pesan || 'Peserta dihapus.');
    setelah();
  } catch (err) {
    galat(err.message);
  }
}

// ---------------------------------------------------------------------------
// Barcode
// ---------------------------------------------------------------------------

export function dialogBarcode(id, setelah) {
  bukaDialog(
    `<header class="baris-judul">
       <h3>Barcode peserta</h3>
       <button type="button" class="tombol-x" data-tutup aria-label="Tutup">✕</button>
     </header>
     <div id="isi-barcode" class="tengah"><div class="pemuat">Memuat…</div></div>`,
    {
      onMount(isi) {
        api
          .get(`/api/peserta/${id}`)
          .then((r) => {
            const p = r.peserta;
            isi.querySelector('#isi-barcode').innerHTML = `
              <p class="muted kecil">Tunjukkan / cetak kartu ini kepada peserta.</p>
              <div style="border:1px solid var(--garis);border-radius:12px;padding:.8rem;display:inline-block;background:#fff">
                <div style="font-weight:700">${esc(state.pengaturan.nama_event || 'Event')}</div>
                <div style="font-size:1.15rem;font-weight:800;margin:.15rem 0">${esc(p.nama)}</div>
                <div class="muted kecil">${esc(p.nomor_peserta)} &middot; ${esc(p.kategori || 'Tanpa kategori')}</div>
                <img src="/api/peserta/${p.id}/barcode.svg?scale=4" alt="Barcode ${esc(p.nomor_peserta)}"
                     style="width:180px;height:180px;max-width:100%;margin:.5rem auto;display:block;image-rendering:pixelated" />
                <div class="kotak-kode">${esc(p.kode_barcode)}</div>
              </div>
              <div class="aksi-baris" style="justify-content:center;margin-top:.8rem">
                <button class="tombol kecil" id="unduh-png">⬇ Unduh PNG</button>
                <button class="tombol kecil" id="cetak-satu">🖨 Cetak</button>
                <button class="tombol kecil" id="cetak-kartu">🖨 Cetak kartu ukuran kartu nama</button>
                <button class="tombol kecil bahaya" id="reset-barcode">↺ Reset barcode</button>
              </div>
              <p class="muted kecil" style="margin-top:.6rem">
                Reset barcode membuat kode baru; barcode lama langsung tidak berlaku.
              </p>
              <footer>
                <button type="button" class="tombol" data-tutup>Tutup</button>
              </footer>`;

            // Tombol tutup di footer dimuat belakangan (lewat innerHTML),
            // jadi listener bawaan bukaDialog belum menjangkaunya — pasang manual.
            isi
              .querySelectorAll('[data-tutup]')
              .forEach((b) => b.addEventListener('click', tutupDialog));

            isi.querySelector('#unduh-png').addEventListener('click', () =>
              unduhBerkas(`/api/peserta/${p.id}/barcode.png?scale=4&tinggi=16`).catch((e) => galat(e.message)),
            );
            isi.querySelector('#cetak-satu').addEventListener('click', () =>
              window.open(`/cetak-barcode.html?ids=${p.id}&otomatis=1`, '_blank'),
            );
            isi.querySelector('#cetak-kartu').addEventListener('click', () => {
              const w = window.open('', '_blank');
              w.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8">
                <title>Kartu ${esc(p.nomor_peserta)}</title>
                <style>
                  @page { size: 90mm 55mm; margin: 3mm; }
                  body { font-family: "Segoe UI", system-ui, sans-serif; margin:0; }
                  .kartu { width: 84mm; height: 49mm; border:1px dashed #94a3b8; border-radius:6px;
                           padding:3mm; display:flex; flex-direction:column; align-items:center; }
                  .event { font-size:9pt; font-weight:600; color:#0f766e; }
                  .nama { font-size:13pt; font-weight:800; margin-top:1mm; }
                  .nomor { font-size:9pt; color:#475569; }
                  img { width:28mm; height:28mm; margin-top:auto; image-rendering:pixelated; }
                  .kode { font-family: ui-monospace, monospace; font-size:8pt; margin-top:1mm; }
                </style></head><body>
                <div class="kartu">
                  <div class="event">${esc(state.pengaturan.nama_event || 'Event')}</div>
                  <div class="nama">${esc(p.nama)}</div>
                  <div class="nomor">${esc(p.nomor_peserta)} &middot; ${esc(p.kategori || '-')}</div>
                  <img src="${location.origin}/api/peserta/${p.id}/barcode.svg?scale=4" alt="" />
                  <div class="kode">${esc(p.kode_barcode)}</div>
                </div>
                <script>window.onload=()=>setTimeout(()=>window.print(),400);<\/script>
                </body></html>`);
            });
            isi.querySelector('#reset-barcode').addEventListener('click', async () => {
              const ya = await konfirmasi({
                judul: 'Reset barcode?',
                pesan: `Barcode lama (${p.kode_barcode}) tidak akan berlaku lagi. Riwayat transaksi tetap tersimpan.`,
                tombol: 'Reset',
              });
              if (!ya) return;
              try {
                const r = await api.post(`/api/peserta/${p.id}/reset-barcode`);
                sukses(`Barcode baru: ${r.kode_barcode}`);
                tutupDialog();
                setelah && setelah();
              } catch (err) {
                galat(err.message);
              }
            });
          })
          .catch((err) => {
            isi.querySelector('#isi-barcode').innerHTML = `<div class="kosong">${esc(err.message)}</div>`;
          });
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Batas kuota per peserta
// ---------------------------------------------------------------------------

export function dialogKuota(id, setelah) {
  bukaDialog(
    `<header><h3>Batas transaksi peserta</h3></header>
     <div id="isi-kuota"><div class="pemuat">Memuat…</div></div>`,
    {
      besar: true,
      onMount(isi) {
        api
          .get(`/api/peserta/${id}/kuota`)
          .then((r) => {
            const p = r.peserta;
            isi.querySelector('#isi-kuota').innerHTML = `
              <p class="muted">${esc(p.nama)} &middot; <span class="mono">${esc(p.nomorPeserta)}</span></p>
              <p class="kecil muted">Kosongkan sebuah kolom lalu simpan untuk memakai batas bawaan event.</p>
              <div class="bungkus-tabel"><table class="data">
                <thead><tr><th>Jenis Transaksi</th><th class="angka">Terpakai</th>
                  <th class="angka">Batas berlaku</th><th class="angka">Sisa</th><th>Batas khusus peserta</th></tr></thead>
                <tbody>
                  ${r.kuota
                    .map(
                      (k) => `<tr>
                        <td>${esc(k.nama)} ${k.khusus ? '<span class="lencana biru">khusus</span>' : ''}</td>
                        <td class="angka">${angka(k.terpakai)}</td>
                        <td class="angka">${k.batas === 0 ? '<span class="peringatan-kuota">tidak berhak</span>' : angka(k.batas)}</td>
                        <td class="angka">${angka(k.sisa)}</td>
                        <td><input type="number" min="0" max="999" data-jenis="${k.jenisId}" value="${k.khusus ? k.batas : ''}"
                              placeholder="${k.batas}" style="width:90px" /></td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table></div>
              <div class="pesan-galat" id="kuota-error" hidden></div>
              <footer>
                <button type="button" class="tombol" data-tutup>Batal</button>
                <button type="button" class="tombol" id="kuota-default">Kembalikan ke bawaan</button>
                <button type="button" class="tombol utama" id="kuota-simpan">Simpan</button>
              </footer>`;

            isi.querySelector('#kuota-simpan').addEventListener('click', (e) =>
              jalankan(e.currentTarget, async () => {
                const items = [...isi.querySelectorAll('input[data-jenis]')].map((inp) => ({
                  jenisId: Number(inp.dataset.jenis),
                  batas: inp.value === '' ? null : Number(inp.value),
                }));
                try {
                  await api.put(`/api/kuota/peserta/${id}`, { items });
                  sukses('Batas transaksi peserta disimpan.');
                  tutupDialog();
                  setelah && setelah();
                } catch (err) {
                  const k = isi.querySelector('#kuota-error');
                  k.textContent = err.message;
                  k.hidden = false;
                }
              }),
            );

            isi.querySelector('#kuota-default').addEventListener('click', async () => {
              const ya = await konfirmasi({
                judul: 'Kembalikan ke batas bawaan?',
                pesan: 'Semua batas khusus peserta ini akan dihapus sehingga mengikuti batas bawaan event.',
                tombol: 'Kembalikan',
              });
              if (!ya) return;
              try {
                const r = await api.post(`/api/kuota/peserta/${id}/reset`);
                sukses(`${r.dihapus} batas khusus dihapus.`);
                tutupDialog();
                setelah && setelah();
              } catch (err) {
                galat(err.message);
              }
            });
          })
          .catch((err) => {
            isi.querySelector('#isi-kuota').innerHTML = `<div class="kosong">${esc(err.message)}</div>`;
          });
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Impor Excel
// ---------------------------------------------------------------------------

export function dialogImpor(setelah) {
  bukaDialog(
    `<header><h3>Impor peserta dari Excel</h3></header>
     <p class="muted kecil">Gunakan template resmi agar kolom terbaca dengan benar.
       Kolom <strong>Nomor Peserta</strong> dan <strong>Nama</strong> wajib diisi.</p>
     <label class="bidang"><span>File Excel (.xlsx)</span><input type="file" id="file-impor" accept=".xlsx" /></label>
     <div class="bidang"><span>Bila nomor peserta sudah terdaftar</span>
       <label class="kecil"><input type="radio" name="mode" value="tambah" checked /> Lewati dan laporkan sebagai kesalahan</label>
       <label class="kecil"><input type="radio" name="mode" value="perbarui" /> Perbarui data yang sudah ada</label>
     </div>
     <div id="hasil-impor"></div>
     <footer>
       <button type="button" class="tombol" data-tutup>Tutup</button>
       <button type="button" class="tombol utama" id="jalankan-impor">Impor sekarang</button>
     </footer>`,
    {
      besar: true,
      onMount(isi) {
        const tombol = isi.querySelector('#jalankan-impor');
        const hasil = isi.querySelector('#hasil-impor');

        tombol.addEventListener('click', () =>
          jalankan(tombol, async () => {
            const file = isi.querySelector('#file-impor').files[0];
            if (!file) {
              hasil.innerHTML = `<div class="pesan-galat">Pilih file Excel terlebih dahulu.</div>`;
              return;
            }
            const mode = isi.querySelector('input[name="mode"]:checked').value;
            hasil.innerHTML = '<div class="pemuat">Mengunggah dan memeriksa data…</div>';
            try {
              const r = await api.unggah(`/api/peserta/import?mode=${mode}`, file);
              const ringkas = `
                <div class="kisi j4" style="margin:.6rem 0">
                  <div class="kartu-stat hijau"><span class="angka">${angka(r.ditambahkan)}</span><span class="label">Peserta baru</span></div>
                  <div class="kartu-stat biru"><span class="angka">${angka(r.diperbarui)}</span><span class="label">Diperbarui</span></div>
                  <div class="kartu-stat merah"><span class="angka">${angka(r.gagal)}</span><span class="label">Gagal / dilewati</span></div>
                  <div class="kartu-stat"><span class="angka">${angka(r.totalBaris)}</span><span class="label">Total baris dibaca</span></div>
                </div>`;

              let tabel = '';
              if (r.errors && r.errors.length) {
                tabel = `
                  <h4>Rincian kesalahan</h4>
                  <div class="bungkus-tabel"><table class="data">
                    <thead><tr><th>Baris</th><th>Kolom</th><th>Keterangan</th></tr></thead>
                    <tbody>
                      ${r.errors
                        .map(
                          (e) => `<tr class="galat-baris"><td class="mono">${esc(e.baris)}</td>
                            <td>${esc(e.kolom || '-')}</td><td>${esc(e.pesan)}</td></tr>`,
                        )
                        .join('')}
                    </tbody>
                  </table></div>
                  ${r.errorsDipotong ? '<p class="muted kecil">Sebagian kesalahan tidak ditampilkan.</p>' : ''}`;
              }

              hasil.innerHTML = ringkas + tabel + (r.gagal === 0 ? '<p class="muted">Semua baris berhasil diimpor.</p>' : '');
              isi.querySelector('#file-impor').value = '';
              if (r.ditambahkan + r.diperbarui > 0) setelah && setelah();
            } catch (err) {
              hasil.innerHTML = `<div class="pesan-galat">${esc(err.message)}</div>`;
            }
          }),
        );
      },
    },
  );
}
