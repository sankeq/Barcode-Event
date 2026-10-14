'use strict';

/**
 * Pembuatan barcode peserta (QR Code — barcode kotak/2D) memakai bwip-js.
 * SVG bersifat vektor sehingga hasil cetak tetap tajam di ukuran kecil.
 */

const crypto = require('node:crypto');
const bwipjs = require('bwip-js');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa 0/O, 1/I agar mudah dibaca

function randomSuffix(len = 4) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Bagian nomor peserta yang aman untuk dicetak di bawah barcode. */
function slugNomor(nomor) {
  const s = String(nomor).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (s || 'PST').slice(0, 12);
}

/**
 * Buat kode barcode unik. `isTaken` dipakai untuk memastikan kode belum dipakai
 * peserta lain (dicek langsung ke database).
 */
function generateKodeBarcode(nomorPeserta, isTaken) {
  for (let i = 0; i < 25; i += 1) {
    const kode = `EVT-${slugNomor(nomorPeserta)}-${randomSuffix(4)}`;
    if (!isTaken(kode)) return kode;
  }
  // Jaring pengaman: UUID singkat bila semua percobaan bentrok.
  return `EVT-${slugNomor(nomorPeserta)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

// QR Code = barcode kotak (2D). Berbeda dari Code 128, QR bersifat simetris:
// tidak ada tinggi batang maupun teks di bawahnya, jadi opsi height/includetext
// tidak dipakai. `eclevel: 'M'` memberi koreksi kesalahan sedang agar tetap
// terbaca walau tercetak kecil atau sedikit kotor.
const DEFAULTS = {
  bcid: 'qrcode',
  scale: 4,
  eclevel: 'M',
  paddingwidth: 1,
  paddingheight: 1,
  backgroundcolor: 'FFFFFF',
};

function normalizeOptions(opts = {}) {
  // Parameter `height`/`tinggi` lama tidak berlaku untuk QR; abaikan dengan aman.
  const scale = Math.min(Math.max(Number(opts.scale) || DEFAULTS.scale, 1), 10);
  return { ...DEFAULTS, scale };
}

function barcodeSvg(text, opts) {
  return bwipjs.toSVG({ ...normalizeOptions(opts), text: String(text) });
}

function barcodePng(text, opts) {
  return bwipjs.toBuffer({ ...normalizeOptions(opts), text: String(text) });
}

module.exports = { generateKodeBarcode, slugNomor, barcodeSvg, barcodePng };
