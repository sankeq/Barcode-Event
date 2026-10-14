/** Skrip halaman cetak barcode massal. */

import { api, qs } from '/js/api.js';
import { esc } from '/js/ui.js';

const params = new URLSearchParams(location.search);
const daftar = document.getElementById('daftar');
const info = document.getElementById('info');

async function muat() {
  daftar.innerHTML = '<div class="kosong">Memuat data peserta…</div>';
  try {
    const ids = params.get('ids');
    let peserta = [];
    let namaEvent = 'Event';

    try {
      const peng = await api.get('/api/pengaturan');
      namaEvent = peng.pengaturan.nama_event || 'Event';
    } catch {
      /* halaman cetak bisa dibuka tanpa hak admin */
    }

    if (ids) {
      const idList = ids.split(',').map((x) => Number(x.trim())).filter(Boolean);
      const hasil = await Promise.all(
        idList.map((id) =>
          api
            .get(`/api/peserta/${id}`)
            .then((r) => r.peserta)
            .catch(() => null),
        ),
      );
      peserta = hasil.filter(Boolean);
    } else {
      const r = await api.get(`/api/peserta/barcode/daftar${qs({ q: params.get('q'), kategori: params.get('kategori') })}`);
      peserta = r.data;
    }

    if (!peserta.length) {
      daftar.innerHTML = '<div class="kosong">Tidak ada peserta untuk dicetak.</div>';
      info.textContent = 'Tidak ada data.';
      return;
    }

    info.textContent = `${peserta.length} barcode · ${namaEvent}`;
    daftar.innerHTML = peserta
      .map(
        (p) => `<div class="label-peserta">
          <div class="event">${esc(namaEvent)}</div>
          <div class="nama">${esc(p.nama)}</div>
          <div class="nomor">${esc(p.nomor_peserta)}${p.kategori ? ` · ${esc(p.kategori)}` : ''}</div>
          <img src="/api/peserta/${p.id}/barcode.svg?scale=4" alt="Barcode ${esc(p.nomor_peserta)}" />
          <div class="kode">${esc(p.kode_barcode)}</div>
        </div>`,
      )
      .join('');

    if (params.get('otomatis') === '1') {
      // Beri waktu gambar SVG termuat sebelum dialog cetak dibuka.
      await Promise.all(
        [...daftar.querySelectorAll('img')].map(
          (img) =>
            new Promise((resolve) => {
              if (img.complete) return resolve();
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
            }),
        ),
      );
      setTimeout(() => window.print(), 350);
    }
  } catch (err) {
    daftar.innerHTML = `<div class="kosong">Gagal memuat: ${esc(err.message)}</div>`;
    info.textContent = 'Gagal memuat.';
  }
}

document.getElementById('cetak').addEventListener('click', () => window.print());

document.getElementById('kolom').addEventListener('change', (e) => {
  const n = Number(e.target.value);
  document.querySelector('.grid-label').style.gridTemplateColumns = `repeat(${n}, 1fr)`;
});

document.getElementById('tanpa-isi').addEventListener('change', (e) => {
  const sembunyi = e.target.checked;
  document.querySelectorAll('.label-peserta .nama, .label-peserta .nomor').forEach((el) => {
    el.style.display = sembunyi ? 'none' : '';
  });
});

muat();
