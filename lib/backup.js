'use strict';
// Sauvegarde d'un foyer : toutes ses donnees (produits, prix, listes, plats, menus…) en JSON.
// Les tables sont decouvertes automatiquement : celles qui ont `household_id`, puis leurs
// enfants (cles etrangeres). Jamais exportes : comptes, sessions, jetons, abonnements push.
// Les photos des plats (fichiers) ne sont pas incluses : sauvegarder aussi le dossier `photos`.
const { db } = require('./db');

const SKIP = new Set(['users', 'sessions', 'login_tokens', 'memberships', 'invitations', 'reset_tokens', 'push_keys', 'push_subs', 'push_prefs', 'applied_ops']);

function exportHousehold(hid) {
  const id = Number(hid);
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name).filter((n) => !SKIP.has(n));
  const where = new Map(); // table -> condition SQL
  for (const t of names) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    if (t === 'households') where.set(t, `id = ${id}`);
    else if (cols.includes('household_id')) where.set(t, `household_id = ${id}`);
  }
  // Tables enfants : une cle etrangere vers une table deja retenue.
  for (let progress = true; progress;) {
    progress = false;
    for (const t of names) {
      if (where.has(t)) continue;
      const fk = db.prepare(`PRAGMA foreign_key_list(${t})`).all().find((f) => where.has(f.table) && f.to);
      if (fk) { where.set(t, `${fk.from} IN (SELECT ${fk.to} FROM ${fk.table} WHERE ${where.get(fk.table)})`); progress = true; }
    }
  }
  const tables = {};
  for (const [t, w] of where) tables[t] = db.prepare(`SELECT * FROM ${t} WHERE ${w}`).all();
  const version = db.prepare('PRAGMA user_version').get().user_version;
  return { app: 'cabas', schema: version, exported_at: new Date().toISOString(), household_id: id, tables };
}

module.exports = { exportHousehold };
