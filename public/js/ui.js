/** Utilitas antarmuka: format, notifikasi, dialog, dan potongan HTML. */

export function esc(nilai) {
  if (nilai === null || nilai === undefined) return '';
  return String(nilai)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FMT_WAKTU = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const FMT_JAM = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const FMT_TANGGAL = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });

export const fmtWaktu = (iso) => (iso ? FMT_WAKTU.format(new Date(iso)) : '-');
export const fmtJam = (iso) => (iso ? FMT_JAM.format(new Date(iso)) : '-');
export const fmtTanggal = (iso) => (iso ? FMT_TANGGAL.format(new Date(iso)) : '-');
export const angka = (n) => new Intl.NumberFormat('id-ID').format(Number(n) || 0);

export function tanggalHariIni() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function tanggalKe(deltaHari) {
  const d = new Date();
  d.setDate(d.getDate() + deltaHari);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// --------------------------------------------------------------- Notifikasi
export function notifikasi(pesan, jenis = '') {
  const wadah = document.getElementById('wadah-notifikasi');
  const el = document.createElement('div');
  el.className = `notifikasi ${jenis}`;
  el.textContent = pesan;
  wadah.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, jenis === 'galat' ? 5200 : 3200);
}

export const sukses = (p) => notifikasi(p, 'sukses');
export const galat = (p) => notifikasi(p, 'galat');
export const peringatan = (p) => notifikasi(p, 'peringatan');

// ------------------------------------------------------------------ Dialog
const dialog = () => document.getElementById('dialog');

export function bukaDialog(html, { besar = false, onMount } = {}) {
  const d = dialog();
  const isi = document.getElementById('dialog-isi');
  isi.innerHTML = html;
  d.classList.toggle('dialog-besar', besar);
  if (typeof d.showModal === 'function') d.showModal();
  else d.setAttribute('open', '');
  d.querySelectorAll('[data-tutup]').forEach((b) => b.addEventListener('click', tutupDialog));
  if (onMount) onMount(isi);
  return isi;
}

export function tutupDialog() {
  const d = dialog();
  if (typeof d.close === 'function') d.close();
  else d.removeAttribute('open');
  document.getElementById('dialog-isi').innerHTML = '';
}

export function konfirmasi({ judul, pesan, tombol = 'Lanjutkan', jenis = 'bahaya' }) {
  return new Promise((resolve) => {
    bukaDialog(
      `<header><h3>${esc(judul)}</h3></header>
       <p>${esc(pesan)}</p>
       <footer>
         <button class="tombol" data-tutup>Batal</button>
         <button class="tombol ${jenis}" id="konfirmasi-ya">${esc(tombol)}</button>
       </footer>`,
      {
        onMount(isi) {
          isi.querySelector('#konfirmasi-ya').addEventListener('click', () => {
            tutupDialog();
            resolve(true);
          });
        },
      },
    );
    dialog().addEventListener('close', () => resolve(false), { once: true });
  });
}

// ---------------------------------------------------------------- Potongan
export function lencanaStatus(status) {
  const map = {
    berhasil: ['ok', 'Berhasil'],
    ditolak: ['merah', 'Ditolak'],
    ganda: ['kuning', 'Ganda'],
  };
  const [kelas, teks] = map[status] || ['abu', status];
  return `<span class="lencana ${kelas}">${esc(teks)}</span>`;
}

export function bilahPersen(persen) {
  const p = Math.max(0, Math.min(100, Number(persen) || 0));
  return `<div class="bar"><i class="${p >= 100 ? 'penuh' : ''}" style="width:${p}%"></i></div>`;
}

export function kosongkan(pesan = 'Belum ada data.') {
  return `<div class="kosong">${esc(pesan)}</div>`;
}

export function potonganHalaman({ page, totalHalaman, total }, onGanti) {
  const wadah = document.createElement('div');
  wadah.className = 'halaman-nav';
  wadah.innerHTML = `
    <span class="muted kecil">Menampilkan halaman ${page} dari ${totalHalaman} &middot; ${angka(total)} baris</span>
    <button class="tombol kecil" data-p="-1" ${page <= 1 ? 'disabled' : ''}>‹ Sebelumnya</button>
    <button class="tombol kecil" data-p="1" ${page >= totalHalaman ? 'disabled' : ''}>Berikutnya ›</button>`;
  wadah.querySelectorAll('button[data-p]').forEach((b) =>
    b.addEventListener('click', () => onGanti(page + Number(b.dataset.p))),
  );
  return wadah;
}

/** Bungkus aksi tombol: nonaktifkan selama proses. */
export async function jalankan(tombol, fn) {
  const teks = tombol ? tombol.textContent : '';
  if (tombol) {
    tombol.disabled = true;
    tombol.textContent = 'Memproses…';
  }
  try {
    return await fn();
  } finally {
    if (tombol) {
      tombol.disabled = false;
      tombol.textContent = teks;
    }
  }
}

/** Bunyi pendek sebagai umpan balik saat memindai (tanpa berkas audio). */
export function bunyi(ok = true) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (bunyi.ctx = bunyi.ctx || new AC());
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = ok ? 1120 : 320;
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (ok) {
      // Dua nada naik = transaksi diterima.
      osc.frequency.setValueAtTime(1120, now);
      osc.frequency.setValueAtTime(1560, now + 0.09);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.22);
    } else {
      // Satu nada rendah lebih panjang = ditolak.
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.07, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
      osc.start(now);
      osc.stop(now + 0.4);
    }
  } catch {
    /* audio bersifat opsional */
  }
}
