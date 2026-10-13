/** Halaman pengguna: kelola akun Admin & Petugas, serta catatan aktivitas. */

import { api } from '../api.js';
import { state } from '../state.js';
import {
  esc, sukses, galat, konfirmasi, bukaDialog, tutupDialog, jalankan,
  kosongkan, angka, fmtWaktu,
} from '../ui.js';

export default {
  judul: 'Pengguna',
  peran: ['admin'],

  render(konten) {
    konten.innerHTML = `
      <div class="kartu">
        <header>
          <h3>Akun panitia</h3>
          <div class="spacer"></div>
          <button class="tombol utama kecil" id="u-tambah">+ Pengguna</button>
        </header>
        <p class="muted kecil">Admin mengelola peserta, batas transaksi, laporan, dan pengguna.
          Petugas hanya memindai barcode dan melihat informasi yang diperlukan saat transaksi.</p>
        <div id="u-daftar"><div class="pemuat">Memuat…</div></div>
      </div>

      <div class="kartu">
        <header><h3>Catatan aktivitas</h3>
          <div class="spacer"></div>
          <button class="tombol kecil" id="u-audit">Muat ulang</button>
        </header>
        <div id="u-audit-daftar"><div class="pemuat">Memuat…</div></div>
      </div>`;

    const daftar = konten.querySelector('#u-daftar');
    const auditDaftar = konten.querySelector('#u-audit-daftar');

    async function muat() {
      daftar.innerHTML = '<div class="pemuat">Memuat…</div>';
      try {
        const r = await api.get('/api/pengguna');
        daftar.innerHTML = `
          <div class="bungkus-tabel"><table class="data" style="min-width:720px">
            <thead><tr><th>Nama pengguna</th><th>Nama lengkap</th><th>Peran</th>
              <th>Status</th><th class="angka">Transaksi</th><th>Dibuat</th><th>Aksi</th></tr></thead>
            <tbody>
              ${r.data
                .map(
                  (u) => `<tr>
                    <td class="mono">${esc(u.username)}${u.id === state.pengguna.id ? ' <span class="lencana biru">Anda</span>' : ''}</td>
                    <td><strong>${esc(u.nama)}</strong></td>
                    <td><span class="lencana ${u.role === 'admin' ? 'ok' : 'biru'}">${u.role === 'admin' ? 'Admin' : 'Petugas'}</span></td>
                    <td>${u.aktif ? '<span class="lencana ok">Aktif</span>' : '<span class="lencana abu">Nonaktif</span>'}</td>
                    <td class="angka">${angka(u.total_transaksi)}</td>
                    <td class="muted kecil">${esc(fmtWaktu(u.created_at))}</td>
                    <td><div class="aksi-baris">
                      <button class="tombol kecil" data-ubah="${u.id}">Ubah</button>
                      <button class="tombol kecil" data-sandi="${u.id}">Kata sandi</button>
                      <button class="tombol kecil bahaya" data-hapus="${u.id}">Hapus</button>
                    </div></td>
                  </tr>`,
                )
                .join('')}
            </tbody>
          </table></div>`;

        daftar.querySelectorAll('[data-ubah]').forEach((b) =>
          b.addEventListener('click', () =>
            dialogPengguna(r.data.find((u) => u.id === Number(b.dataset.ubah)), muat),
          ),
        );
        daftar.querySelectorAll('[data-sandi]').forEach((b) =>
          b.addEventListener('click', () => {
            const u = r.data.find((x) => x.id === Number(b.dataset.sandi));
            dialogSandi(u, muat);
          }),
        );
        daftar.querySelectorAll('[data-hapus]').forEach((b) =>
          b.addEventListener('click', async () => {
            const u = r.data.find((x) => x.id === Number(b.dataset.hapus));
            const ok = await konfirmasi({
              judul: `Hapus pengguna ${u.nama}?`,
              pesan: 'Pengguna yang sudah punya riwayat transaksi hanya akan dinonaktifkan.',
              tombol: 'Hapus',
            });
            if (!ok) return;
            try {
              const res = await api.del(`/api/pengguna/${u.id}`);
              sukses(res.pesan || 'Pengguna dihapus.');
              muat();
            } catch (err) {
              galat(err.message);
            }
          }),
        );
      } catch (err) {
        daftar.innerHTML = kosongkan(err.message);
      }
    }

    async function muatAudit() {
      auditDaftar.innerHTML = '<div class="pemuat">Memuat…</div>';
      try {
        const r = await api.get('/api/audit?limit=120');
        if (!r.data.length) {
          auditDaftar.innerHTML = kosongkan('Belum ada catatan aktivitas.');
          return;
        }
        auditDaftar.innerHTML = `
          <div class="bungkus-tabel"><table class="data" style="min-width:640px">
            <thead><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Objek</th><th>Detail</th></tr></thead>
            <tbody>
              ${r.data
                .map(
                  (a) => `<tr>
                    <td class="muted kecil">${esc(fmtWaktu(a.waktu))}</td>
                    <td>${esc(a.user_nama || 'sistem')}</td>
                    <td><span class="lencana abu">${esc(a.aksi)}</span></td>
                    <td class="muted kecil">${esc(a.entitas || '-')} ${a.entitas_id ? `#${esc(a.entitas_id)}` : ''}</td>
                    <td class="muted kecil" style="max-width:340px;overflow:hidden;text-overflow:ellipsis">${esc(a.detail || '')}</td>
                  </tr>`,
                )
                .join('')}
            </tbody>
          </table></div>`;
      } catch (err) {
        auditDaftar.innerHTML = kosongkan(err.message);
      }
    }

    konten.querySelector('#u-tambah').addEventListener('click', () => dialogPengguna(null, muat));
    konten.querySelector('#u-audit').addEventListener('click', (e) => jalankan(e.currentTarget, muatAudit));

    muat();
    muatAudit();
  },
};

function dialogPengguna(u, setelah) {
  const baru = !u;
  bukaDialog(
    `<header><h3>${baru ? 'Tambah pengguna' : `Ubah ${esc(u.nama)}`}</h3></header>
     <form id="form-pengguna">
       <div class="baris-bidang">
         <label class="bidang"><span>Nama pengguna (untuk login)</span>
           <input name="username" required value="${esc(u?.username || '')}" autocapitalize="none" /></label>
         <label class="bidang"><span>Nama lengkap</span>
           <input name="nama" required value="${esc(u?.nama || '')}" /></label>
       </div>
       <div class="baris-bidang">
         <label class="bidang"><span>Peran</span>
           <select name="role">
             <option value="petugas">Petugas (hanya memindai)</option>
             <option value="admin">Admin (akses penuh)</option>
           </select></label>
         ${baru ? '<label class="bidang"><span>Kata sandi awal (min. 6 karakter)</span><input type="password" name="password" required /></label>' : ''}
       </div>
       ${baru ? '' : '<label class="kecil"><input type="checkbox" name="aktif" /> Aktif (bisa masuk)</label>'}
       <div class="pesan-galat" id="pg-error" hidden></div>
       <footer>
         <button type="button" class="tombol" data-tutup>Batal</button>
         <button type="submit" class="tombol utama" id="pg-simpan">Simpan</button>
       </footer>
     </form>`,
    {
      onMount(isi) {
        const form = isi.querySelector('#form-pengguna');
        const kotak = isi.querySelector('#pg-error');
        form.role.value = u?.role || 'petugas';
        if (!baru) form.aktif.checked = !!u.aktif;

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          kotak.hidden = true;
          const data = {
            username: form.username.value.trim(),
            nama: form.nama.value.trim(),
            role: form.role.value,
          };
          if (baru) data.password = form.password.value;
          else data.aktif = form.aktif.checked;
          await jalankan(isi.querySelector('#pg-simpan'), async () => {
            try {
              if (baru) await api.post('/api/pengguna', data);
              else await api.put(`/api/pengguna/${u.id}`, data);
              sukses('Data pengguna disimpan.');
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

function dialogSandi(u, setelah) {
  bukaDialog(
    `<header><h3>Ganti kata sandi ${esc(u.nama)}</h3></header>
     <form id="form-sandi-user">
       <label class="bidang"><span>Kata sandi baru (minimal 6 karakter)</span>
         <input type="password" name="password" required /></label>
       <p class="muted kecil">Semua sesi pengguna ini akan diputus setelah kata sandi diganti.</p>
       <div class="pesan-galat" id="pg2-error" hidden></div>
       <footer>
         <button type="button" class="tombol" data-tutup>Batal</button>
         <button type="submit" class="tombol utama" id="pg2-simpan">Simpan</button>
       </footer>
     </form>`,
    {
      onMount(isi) {
        const form = isi.querySelector('#form-sandi-user');
        const kotak = isi.querySelector('#pg2-error');
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          await jalankan(isi.querySelector('#pg2-simpan'), async () => {
            try {
              await api.post(`/api/pengguna/${u.id}/sandi`, { password: form.password.value });
              sukses('Kata sandi diperbarui.');
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
