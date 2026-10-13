/** Status bersama antar halaman (pengguna, pengaturan, daftar jenis transaksi). */

import { api } from './api.js';

export const state = {
  pengguna: null,
  pengaturan: { nama_event: 'Event', jeda_duplikat_detik: 5 },
  jenis: [],
  /** Jenis transaksi yang sedang dipilih di halaman pemindaian. */
  jenisTerpilih: null,
};

export const isAdmin = () => state.pengguna?.role === 'admin';

export async function muatPengaturan() {
  if (!isAdmin()) return state.pengaturan;
  try {
    const r = await api.get('/api/pengaturan');
    state.pengaturan = r.pengaturan;
  } catch {
    /* pakai nilai bawaan */
  }
  return state.pengaturan;
}

export async function muatJenis(force = false) {
  if (!force && state.jenis.length) return state.jenis;
  try {
    const r = await api.get('/api/jenis');
    state.jenis = r.jenis || [];
    if (state.jenisTerpilih && !state.jenis.some((j) => j.id === state.jenisTerpilih)) {
      state.jenisTerpilih = null;
    }
  } catch {
    state.jenis = state.jenis || [];
  }
  return state.jenis;
}

export const jenisAktif = () => state.jenis.filter((j) => j.aktif);
