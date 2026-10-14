'use strict';

/** Catatan aktivitas: siapa mengubah apa dan kapan. */

const { insert, query } = require('./db');

async function logAudit({ user, aksi, entitas = null, entitasId = null, detail = null }) {
  await insert('audit_log', {
    waktu: new Date().toISOString(),
    user_id: user ? user.id : null,
    user_nama: user ? `${user.nama} (${user.username})` : null,
    aksi,
    entitas,
    entitas_id: entitasId == null ? null : String(entitasId),
    detail: detail == null ? null : typeof detail === 'string' ? detail : JSON.stringify(detail),
  });
}

async function listAudit(limit = 100) {
  return query('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', [
    Math.min(Math.max(Number(limit) || 100, 1), 500),
  ]);
}

module.exports = { logAudit, listAudit };
