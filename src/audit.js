'use strict';

/** Catatan aktivitas: siapa mengubah apa dan kapan. */

const { insert, getDb } = require('./db');

function logAudit({ user, aksi, entitas = null, entitasId = null, detail = null }) {
  insert('audit_log', {
    waktu: new Date().toISOString(),
    user_id: user ? user.id : null,
    user_nama: user ? `${user.nama} (${user.username})` : null,
    aksi,
    entitas,
    entitas_id: entitasId == null ? null : String(entitasId),
    detail: detail == null ? null : typeof detail === 'string' ? detail : JSON.stringify(detail),
  });
}

function listAudit(limit = 100) {
  return getDb()
    .prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?')
    .all(Math.min(Math.max(Number(limit) || 100, 1), 500));
}

module.exports = { logAudit, listAudit };
