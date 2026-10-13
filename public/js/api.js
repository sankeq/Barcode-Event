/** Klien API: pembungkus fetch dengan penanganan galat & sesi. */

async function bacaGalat(res) {
  let pesan = `Permintaan gagal (${res.status}).`;
  try {
    const tipe = res.headers.get('content-type') || '';
    if (tipe.includes('application/json')) {
      const j = await res.json();
      if (j && j.error) pesan = j.error;
    } else {
      const t = await res.text();
      if (t) pesan = t.slice(0, 300);
    }
  } catch {
    /* biarkan pesan bawaan */
  }
  return pesan;
}

export async function minta(path, opsi = {}) {
  const { method = 'GET', body, mentah, headers = {} } = opsi;
  const init = { method, headers: { ...headers }, credentials: 'same-origin' };

  if (body !== undefined) {
    if (mentah) {
      init.body = body; // File / Blob / BufferSource dikirim apa adanya
      init.headers['Content-Type'] = 'application/octet-stream';
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }

  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error('Tidak dapat menghubungi server. Periksa koneksi Anda.');
  }

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('sesi-habis'));
    throw new Error(await bacaGalat(res));
  }
  if (!res.ok) throw new Error(await bacaGalat(res));
  if (res.status === 204) return null;

  const tipe = res.headers.get('content-type') || '';
  return tipe.includes('application/json') ? res.json() : res.text();
}

export const api = {
  get: (p) => minta(p),
  post: (p, body) => minta(p, { method: 'POST', body }),
  put: (p, body) => minta(p, { method: 'PUT', body }),
  del: (p) => minta(p, { method: 'DELETE' }),
  unggah: (p, file) => minta(p, { method: 'POST', body: file, mentah: true }),
};

/** Bangun query string dari objek (nilai kosong diabaikan). */
export function qs(obj) {
  const p = new URLSearchParams();
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  });
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Unduh berkas dari endpoint yang butuh sesi (memakai cookie). */
export async function unduhBerkas(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(await bacaGalat(res));
  const blob = await res.blob();
  const disp = res.headers.get('content-disposition') || '';
  const m = /filename="?([^";]+)"?/.exec(disp);
  const nama = m ? m[1] : 'unduhan';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nama;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
