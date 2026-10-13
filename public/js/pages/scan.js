/** Halaman pemindaian: pilih jenis transaksi, pindai, lihat hasil seketika. */

import { api } from '../api.js';
import { state, muatJenis } from '../state.js';
import { esc, galat, peringatan, bunyi, fmtJam, lencanaStatus, kosongkan, jalankan } from '../ui.js';

const JEDA_KLIEN_MS = 1200;

let kodeTerakhir = '';
let waktuTerakhir = 0;
let scanner = null;
let kameraAktif = false;

/** Judul besar pada panel hasil, mengikuti alasan sebenarnya. */
function judulStatus(h) {
  if (h.status === 'berhasil') return ['BERHASIL', '✓', 'berhasil'];
  if (h.status === 'ganda') return ['PEMINDAIAN GANDA', '↺', 'ganda'];
  const pesan = (h.pesan || '').toLowerCase();
  if (pesan.includes('tidak terdaftar')) return ['BARCODE TIDAK TERDAFTAR', '✕', 'ditolak'];
  if (pesan.includes('kuota habis')) return ['KUOTA HABIS', '✕', 'ditolak'];
  return ['TRANSAKSI DITOLAK', '✕', 'ditolak'];
}

async function muatPustakaKamera() {
  if (window.Html5Qrcode) return window.Html5Qrcode;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/html5-qrcode.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Pustaka kamera gagal dimuat.'));
    document.head.appendChild(s);
  });
  if (!window.Html5Qrcode) throw new Error('Pustaka kamera tidak tersedia.');
  return window.Html5Qrcode;
}

export default {
  judul: 'Pemindaian',
  peran: ['admin', 'petugas'],

  render(konten) {
    let metodeTerakhir = 'scan';

    konten.innerHTML = `
      <div class="kartu">
        <header>
          <h3>1. Pilih jenis transaksi</h3>
          <div class="spacer"></div>
          <span class="muted kecil" id="info-jenis"></span>
          <a class="tombol kecil" href="#batas">Atur jenis transaksi</a>
        </header>
        <div class="pilih-jenis" id="pilih-jenis"></div>
      </div>

      <div class="kartu">
        <header>
          <h3>2. Pindai barcode peserta</h3>
          <div class="spacer"></div>
          <button class="tombol kecil" id="tombol-kamera">📷 Pakai kamera</button>
        </header>
        <div class="kotak-scan">
          <input id="input-kode" type="text" inputmode="text" autocomplete="off"
                 placeholder="Scan barcode / ketik nomor peserta lalu Enter" />
          <button class="tombol utama besar" id="tombol-proses">Proses</button>
        </div>
        <div class="peringatan-kamera" id="peringatan-https" hidden>
          Kamera hanya aktif pada alamat <strong>localhost</strong> atau <strong>HTTPS</strong>.
          Pemindai barcode (USB/Bluetooth) dan input manual tetap bisa dipakai.
        </div>
        <div id="kamera-bungkus" hidden style="margin-top:.7rem">
          <div id="kamera-pembaca"></div>
          <div class="aksi-baris" style="justify-content:center;margin-top:.5rem">
            <button class="tombol kecil bahaya" id="tombol-kamera-stop">Hentikan kamera</button>
          </div>
        </div>
        <div id="hasil"></div>
      </div>

      <div class="kartu">
        <header>
          <h3>Pemindaian terakhir saya</h3>
          <div class="spacer"></div>
          <button class="tombol kecil" id="tombol-segar">Muat ulang</button>
        </header>
        <div id="daftar-terakhir"><div class="kosong">Belum ada pemindaian.</div></div>
      </div>`;

    const input = konten.querySelector('#input-kode');
    const panelHasil = konten.querySelector('#hasil');
    const wadahJenis = konten.querySelector('#pilih-jenis');

    // -------------------------------------------------------- pilih jenis
    function gambarJenis() {
      const daftar = state.jenis.filter((j) => j.aktif);
      if (!daftar.length) {
        wadahJenis.innerHTML =
          '<div class="kosong">Belum ada jenis transaksi yang dipakai. Buka menu <strong>Jenis Transaksi</strong> untuk menambah atau memilih jenis.</div>';
        return;
      }
      wadahJenis.innerHTML = daftar
        .map(
          (j) => `
          <button class="tombol-jenis ${state.jenisTerpilih === j.id ? 'aktif' : ''}" data-jenis="${j.id}">
            ${esc(j.nama)}
            <small>${j.batas_default === 0 ? 'tidak berhak' : `bawaan ${j.batas_default}×`}</small>
          </button>`,
        )
        .join('');
      wadahJenis.querySelectorAll('[data-jenis]').forEach((b) =>
        b.addEventListener('click', () => {
          state.jenisTerpilih = Number(b.dataset.jenis);
          gambarJenis();
          perbaruiInfoJenis();
          input.focus();
        }),
      );
    }

    function perbaruiInfoJenis() {
      // Bila jenis yang tadinya dipilih dikeluarkan lewat menu "Jenis Transaksi",
      // bersihkan pilihan agar tidak ada percobaan memindai jenis yang tidak dipakai.
      const masihDipilih = state.jenis.some((x) => x.id === state.jenisTerpilih && x.aktif);
      if (!masihDipilih) state.jenisTerpilih = null;

      const j = state.jenis.find((x) => x.id === state.jenisTerpilih);
      konten.querySelector('#info-jenis').textContent = j
        ? `Terpilih: ${j.nama}`
        : 'Belum ada jenis dipilih';
    }

    // ------------------------------------------------------------ hasil
    function tampilkanHasil(h) {
      const [judul, ikon, kelas] = judulStatus(h);
      const p = h.peserta || {};
      const j = h.jenisTransaksi || {};
      const sisa = h.sisa === null || h.sisa === undefined ? '-' : h.sisa;
      const kuota =
        h.batas === null || h.batas === undefined ? '-' : `${h.terpakai ?? 0} / ${h.batas}`;

      panelHasil.innerHTML = `
        <div class="hasil-scan ${kelas}">
          <div class="judul-status"><span aria-hidden="true">${ikon}</span>${esc(judul)}</div>
          ${p.nama ? `<div class="nama-peserta-besar">${esc(p.nama)}</div>` : ''}
          <div class="pesan">${esc(h.pesan || '')}</div>
          <div class="rincian-scan">
            <div>Nomor Peserta<strong>${esc(p.nomorPeserta || '-')}</strong></div>
            <div>Kategori<strong>${esc(p.kategori || '-')}</strong></div>
            <div>Jenis Transaksi<strong>${esc(j.nama || '-')}</strong></div>
            <div>Kuota (pakai/batas)<strong>${esc(kuota)}</strong></div>
            <div>Sisa Kuota<strong>${esc(sisa)}</strong></div>
            <div>Waktu<strong>${esc(fmtJam(h.waktu))}</strong></div>
          </div>
        </div>`;
      bunyi(h.status === 'berhasil');
    }

    function tampilkanGalatTeknis(pesan) {
      panelHasil.innerHTML = `
        <div class="hasil-scan ditolak">
          <div class="judul-status"><span>✕</span>TRANSAKSI DITOLAK</div>
          <div class="pesan">${esc(pesan)}</div>
        </div>`;
      bunyi(false);
    }

    async function proses(kodeMentah, metode = 'scan') {
      const kode = String(kodeMentah || '').trim();
      if (!state.jenisTerpilih) {
        peringatan('Pilih jenis transaksi terlebih dahulu.');
        input.focus();
        return;
      }
      if (!kode) {
        peringatan('Scan barcode atau ketik nomor peserta.');
        input.focus();
        return;
      }

      const sekarang = Date.now();
      if (kode === kodeTerakhir && sekarang - waktuTerakhir < JEDA_KLIEN_MS) {
        input.value = '';
        return;
      }
      kodeTerakhir = kode;
      waktuTerakhir = sekarang;
      metodeTerakhir = metode;
      input.value = '';

      try {
        const hasil = await api.post('/api/scan', {
          kode,
          jenisId: state.jenisTerpilih,
          metode,
        });
        tampilkanHasil(hasil);
      } catch (err) {
        tampilkanGalatTeknis(err.message);
        galat(err.message);
      } finally {
        muatTerakhir();
        input.focus();
      }
    }

    // -------------------------------------------------- daftar terakhir
    async function muatTerakhir() {
      const wadah = konten.querySelector('#daftar-terakhir');
      try {
        const r = await api.get('/api/scan/terakhir?limit=12');
        if (!r.data.length) {
          wadah.innerHTML = '<div class="kosong">Belum ada pemindaian.</div>';
          return;
        }
        wadah.innerHTML = `
          <div class="bungkus-tabel">
            <table class="data">
              <thead><tr>
                <th>Waktu</th><th>Status</th><th>Peserta</th><th>Jenis</th><th>Keterangan</th>
              </tr></thead>
              <tbody>
                ${r.data
                  .map(
                    (t) => `<tr>
                      <td>${esc(fmtJam(t.waktu))}</td>
                      <td>${lencanaStatus(t.status)}</td>
                      <td>${esc(t.nama_peserta || '-')}<br><span class="muted kecil mono">${esc(
                        t.nomor_peserta || t.kode_barcode || '',
                      )}</span></td>
                      <td>${esc(t.jenis_nama)}</td>
                      <td class="muted kecil">${esc(t.alasan || `Sisa kuota: ${t.sisa_setelah ?? '-'}`)}</td>
                    </tr>`,
                  )
                  .join('')}
              </tbody>
            </table>
          </div>`;
      } catch (err) {
        wadah.innerHTML = `<div class="kosong">${esc(err.message)}</div>`;
      }
    }

    // ---------------------------------------------------------- kamera
    async function mulaiKamera() {
      if (kameraAktif) return stopKamera();
      const bungkus = konten.querySelector('#kamera-bungkus');
      bungkus.hidden = false;
      try {
        const Html5Qrcode = await muatPustakaKamera();
        scanner = new Html5Qrcode('kamera-pembaca');
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 280, height: 160 } },
          (teks) => proses(teks, 'kamera'),
          () => {
            /* abaikan galat per-frame */
          },
        );
        kameraAktif = true;
        konten.querySelector('#tombol-kamera').textContent = '📷 Kamera aktif';
      } catch (err) {
        scanner = null;
        kameraAktif = false;
        bungkus.hidden = true;
        const pesan = String(err?.message || err);
        if (/NotAllowed|Permission|denied/i.test(pesan)) {
          galat('Izin kamera ditolak. Aktifkan izin kamera di peramban lalu coba lagi.');
        } else {
          galat(`Kamera tidak dapat diaktifkan: ${pesan}`);
        }
      }
    }

    async function stopKamera() {
      if (scanner && kameraAktif) {
        try {
          await scanner.stop();
          scanner.clear();
        } catch {
          /* abaikan */
        }
      }
      scanner = null;
      kameraAktif = false;
      const bungkus = konten.querySelector('#kamera-bungkus');
      if (bungkus) bungkus.hidden = true;
      const tombol = konten.querySelector('#tombol-kamera');
      if (tombol) tombol.textContent = '📷 Pakai kamera';
    }

    // ------------------------------------------------------- pemasangan
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        proses(input.value, 'scan');
      }
    });
    konten.querySelector('#tombol-proses').addEventListener('click', () => proses(input.value, 'scan'));
    konten.querySelector('#tombol-kamera').addEventListener('click', mulaiKamera);
    konten.querySelector('#tombol-kamera-stop').addEventListener('click', stopKamera);
    konten.querySelector('#tombol-segar').addEventListener('click', (e) =>
      jalankan(e.currentTarget, muatTerakhir),
    );

    if (!window.isSecureContext) konten.querySelector('#peringatan-https').hidden = false;

    gambarJenis();
    perbaruiInfoJenis();
    muatJenis().then(() => {
      gambarJenis();
      perbaruiInfoJenis();
    });
    muatTerakhir();
    input.focus();

    // Dipanggil kerangka aplikasi saat berpindah halaman.
    return () => stopKamera();
  },
};
