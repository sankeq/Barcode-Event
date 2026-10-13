'use strict';

/**
 * Pembuatan barcode peserta (Code 128) memakai bwip-js.
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

const DEFAULTS = {
  bcid: 'code128',
  scale: 3,
  height: 12,
  includetext: true,
  textxalign: 'center',
  textsize: 9,
  paddingwidth: 4,
  paddingheight: 2,
  backgroundcolor: 'FFFFFF',
};

function normalizeOptions(opts = {}) {
  const scale = Math.min(Math.max(Number(opts.scale) || DEFAULTS.scale, 1), 8);
  const height = Math.min(Math.max(Number(opts.height) || DEFAULTS.height, 6), 40);
  return { ...DEFAULTS, scale, height };
}

function barcodeSvg(text, opts) {
  return bwipjs.toSVG({ ...normalizeOptions(opts), text: String(text) });
}

function barcodePng(text, opts) {
  return bwipjs.toBuffer({ ...normalizeOptions(opts), text: String(text) });
}

module.exports = { generateKodeBarcode, slugNomor, barcodeSvg, barcodePng };
