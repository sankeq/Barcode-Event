/** Kerangka aplikasi: masuk/keluar, menu, dan perutean halaman. */

import { api } from './api.js';
import { state, isAdmin, muatJenis, muatPengaturan } from './state.js';
import { esc, sukses, galat, bukaDialog, tutupDialog, jalankan } from './ui.js';

import dasbor from './pages/dasbor.js';
import scan from './pages/scan.js';
import peserta from './pages/peserta.js';
import batas from './pages/batas.js';
import riwayat from './pages/riwayat.js';
import laporan from './pages/laporan.js';
import pengguna from './pages/pengguna.js';
import pengaturan from './pages/pengaturan.js';

const HALAMAN = {
  dasbor, scan, peserta, batas, riwayat, laporan, pengguna, pengaturan,
  // Tautan lama menu "Pilih Jenis Transaksi" tetap hidup: menu itu sekarang
  // disatukan menjadi `batas` (menu "Jenis Transaksi").
  pilihjenis: batas,
};

// `awal` menandai halaman yang dibuka pertama kali untuk peran tersebut.
const MENU = [
  { rute: 'dasbor', label: 'Dasbor', ikon: '📊', peran: ['admin'], awal: 'admin' },
  { rute: 'batas', label: 'Jenis Transaksi', ikon: '☑️', peran: ['admin'] },
  { rute: 'scan', label: 'Pemindaian', ikon: '📷', peran: ['admin', 'petugas'], awal: 'petugas' },
  { rute: 'peserta', label: 'Peserta', ikon: '👥', peran: ['admin'] },
  { rute: 'riwayat', label: 'Riwayat', ikon: '🧾', peran: ['admin'] },
  { rute: 'laporan', label: 'Laporan', ikon: '📈', peran: ['admin'] },
  { rute: 'pengguna', label: 'Pengguna', ikon: '🔐', peran: ['admin'] },
  { rute: 'pengaturan', label: 'Pengaturan', ikon: '⚙️', peran: ['admin'] },
];

let bersihkanHalaman = null;

const el = (id) => document.getElementById(id);

function menuUntukPeran() {
  const peran = state.pengguna?.role || 'petugas';
  return MENU.filter((m) => m.peran.includes(peran));
}

/** Halaman yang dibuka otomatis: Admin mulai dari Dasbor, Petugas langsung ke Pemindaian. */
function halamanAwal() {
  const peran = state.pengguna?.role || 'petugas';
  const menu = menuUntukPeran();
  const cocok = menu.find((m) => m.awal === peran);
  return (cocok || menu[0]).rute;
}

function sembunyikanSemua() {
  el('layar-masuk').hidden = true;
  el('aplikasi').hidden = true;
}

// ------------------------------------------------------------------ Masuk
function tampilkanMasuk(pesan) {
  sembunyikanSemua();
  state.pengguna = null;
  document.getElementById('sidebar')?.classList.remove('terbuka');
  el('layar-masuk').hidden = false;
  const kotak = el('masuk-error');
  if (pesan) {
    kotak.textContent = pesan;
    kotak.hidden = false;
  } else {
    kotak.hidden = true;
  }
  el('form-masuk')?.querySelector('input[name="username"]')?.focus();
}

function tampilkanAplikasi() {
  sembunyikanSemua();
  el('aplikasi').hidden = false;

  const admin = isAdmin();
  el('lencana-peran').textContent = admin ? 'Admin' : 'Petugas';
  el('lencana-peran').className = `lencana-peran ${admin ? '' : 'petugas'}`;
  el('nama-pengguna-top').textContent = state.pengguna.nama;
  el('nama-event-top').textContent = state.pengaturan.nama_event || 'Event';
  el('sidebar-sub').textContent = `${state.pengguna.nama} · ${admin ? 'Admin' : 'Petugas'}`;

  const menu = el('menu');
  menu.innerHTML = menuUntukPeran()
    .map(
      (m) =>
        `<li><a href="#${m.rute}" data-rute="${m.rute}"><span class="ikon" aria-hidden="true">${m.ikon}</span>${esc(m.label)}</a></li>`,
    )
    .join('');
  menu.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', () => el('sidebar').classList.remove('terbuka')),
  );

  if (!location.hash || !HALAMAN[location.hash.slice(1)]) {
    location.hash = `#${halamanAwal()}`;
  } else {
    pergi();
  }
}

async function mulai() {
  try {
    const r = await api.get('/api/auth/me');
    state.pengguna = r.user;
    await muatPengaturan();
    await muatJenis(true);
    tampilkanAplikasi();
  } catch {
    // Belum masuk: coba ambil nama event dari endpoint publik (opsional).
    try {
      const info = await fetch('/api/info', { credentials: 'same-origin' });
      if (info.ok) {
        const j = await info.json();
        el('masuk-nama-event').textContent = j.nama_event || 'Event';
      }
    } catch {
      /* abaikan */
    }
    tampilkanMasuk();
  }
}

// ------------------------------------------------------------- Perutean
export function pergi(rute = null) {
  if (rute) {
    if (location.hash === `#${rute}`) pergi();
    else location.hash = `#${rute}`;
    return;
  }
  const nama = (location.hash || '').slice(1) || halamanAwal();
  const halaman = HALAMAN[nama];
  if (!halaman) return;

  const boleh = halaman.peran ? halaman.peran.includes(state.pengguna?.role) : true;
  if (!boleh) {
    galat('Halaman ini hanya untuk Admin.');
    location.hash = `#${halamanAwal()}`;
    return;
  }

  if (typeof bersihkanHalaman === 'function') {
    try {
      bersihkanHalaman();
    } catch {
      /* abaikan */
    }
    bersihkanHalaman = null;
  }

  document.querySelectorAll('#menu a').forEach((a) => {
    a.classList.toggle('aktif', a.dataset.rute === nama);
  });
  el('nama-halaman-top').textContent = halaman.judul || nama;

  const konten = el('konten');
  konten.innerHTML = '<div class="pemuat">Memuat…</div>';
  try {
    bersihkanHalaman = halaman.render(konten, { pergi }) || null;
  } catch (err) {
    konten.innerHTML = `<div class="kosong">Gagal memuat halaman: ${esc(err.message)}</div>`;
  }
}

// -------------------------------------------------------- Ganti kata sandi
function dialogGantiSandi() {
  bukaDialog(
    `<header><h3>Ganti kata sandi saya</h3></header>
     <form id="form-ganti-sandi">
       <label class="bidang"><span>Kata sandi lama</span><input type="password" name="lama" required /></label>
       <label class="bidang"><span>Kata sandi baru (minimal 6 karakter)</span><input type="password" name="baru" required /></label>
       <label class="bidang"><span>Ulangi kata sandi baru</span><input type="password" name="ulang" required /></label>
       <div class="pesan-galat" id="sandi-error" hidden></div>
       <footer>
         <button type="button" class="tombol" data-tutup>Batal</button>
         <button type="submit" class="tombol utama" id="simpan-sandi">Simpan</button>
       </footer>
     </form>`,
    {
      onMount(isi) {
        const form = isi.querySelector('#form-ganti-sandi');
        const kotak = isi.querySelector('#sandi-error');
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          kotak.hidden = true;
          const data = new FormData(form);
          if (data.get('baru') !== data.get('ulang')) {
            kotak.textContent = 'Kata sandi baru dan ulangannya tidak sama.';
            kotak.hidden = false;
            return;
          }
          await jalankan(isi.querySelector('#simpan-sandi'), async () => {
            try {
              await api.post('/api/sandi-saya', {
                passwordLama: data.get('lama'),
                passwordBaru: data.get('baru'),
              });
              tutupDialog();
              sukses('Kata sandi berhasil diganti.');
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

// ------------------------------------------------------------- Pemasangan
function pasangPeristiwa() {
  el('form-masuk').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = new FormData(form);
    const tombol = el('tombol-masuk');
    await jalankan(tombol, async () => {
      try {
        const r = await api.post('/api/auth/login', {
          username: data.get('username'),
          password: data.get('password'),
        });
        // Respons login WAJIB berisi objek user. Bila tidak (mis. respons
        // terpotong/terbungkus proxy atau versi berkas lama), tampilkan pesan
        // jelas alih-alih crash saat membaca r.user.nama.
        if (!r || !r.user) {
          throw new Error('Respons masuk tidak valid dari server. Coba muat ulang halaman; bila berlanjut, periksa konfigurasi server.');
        }
        state.pengguna = r.user;
        form.reset();
        await muatPengaturan();
        await muatJenis(true);
        tampilkanAplikasi();
        sukses(`Selamat bertugas, ${r.user.nama}.`);
      } catch (err) {
        tampilkanMasuk(err.message);
      }
    });
  });

  document.querySelectorAll('[data-isi]').forEach((b) =>
    b.addEventListener('click', () => {
      const [u, p] = b.dataset.isi.split('|');
      const form = el('form-masuk');
      form.querySelector('input[name="username"]').value = u;
      form.querySelector('input[name="password"]').value = p;
    }),
  );

  el('tombol-keluar').addEventListener('click', async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* tetap tampilkan layar masuk */
    }
    tampilkanMasuk('Anda telah keluar.');
  });

  el('tombol-ganti-sandi').addEventListener('click', dialogGantiSandi);
  el('tombol-menu').addEventListener('click', () => el('sidebar').classList.toggle('terbuka'));

  window.addEventListener('hashchange', () => pergi());
  window.addEventListener('sesi-habis', () => tampilkanMasuk('Sesi berakhir. Silakan masuk kembali.'));
}

pasangPeristiwa();
mulai();
