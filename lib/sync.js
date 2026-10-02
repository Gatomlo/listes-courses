// Rejeu des operations faites hors-ligne (et des actions du mode courses, qui passent
// toujours par ici). Chaque operation porte un op_id unique : rejouee deux fois, elle
// n'est appliquee qu'une fois (table applied_ops). Regles de conflit :
//  - « achete » l'emporte : decocher un article coche depuis par quelqu'un d'autre est ignore ;
//  - sinon la modification la plus recente gagne (horodatage `at` de l'appareil) ;
//  - article supprime entre-temps : operation ignoree (signalee).
// Operations : item.update { item_id, fields: { status, qty, note, store_id } }
//              item.add    { list_id, product_id, qty }
//              record.add  { product_id, store_id, price, promo }
//              receipt.save { store_id, list_id, date, raw_text, lines } (ticket scanne, voir receipts.js)
const { db } = require('./db');
const L = require('./lists');
const C = require('./catalog');
const R = require('./receipts');

const MAX_OPS = 200;

function applyOne(hid, user, role, op) {
  const at = Number(op.at) || Date.now();
  switch (op.type) {
    case 'item.update': {
      const it = db.prepare(`SELECT i.id, i.list_id, i.status, i.updated_at FROM list_items i JOIN lists l ON l.id = i.list_id
        WHERE i.id = ? AND l.household_id = ?`).get(Number(op.item_id), hid);
      if (!it) return { ok: false, ignored: true, reason: 'Article supprimé entre-temps.' };
      const fields = { ...(op.fields || {}) };
      const newer = it.updated_at > at;
      if (fields.status === 'todo' && it.status === 'bought' && newer) delete fields.status;
      if (newer) for (const k of ['qty', 'note', 'store_id']) delete fields[k];
      if (!Object.keys(fields).length) return { ok: true, ignored: true, listId: it.list_id };
      L.updateItem(hid, it.id, user, role, fields);
      return { ok: true, listId: it.list_id };
    }
    case 'item.add': {
      L.addItem(hid, Number(op.list_id), user, role, { product_id: op.product_id, qty: op.qty, note: op.note });
      return { ok: true, listId: Number(op.list_id) };
    }
    case 'record.add': {
      C.addRecord(hid, Number(op.product_id), user.id, { store_id: op.store_id, price: op.price, promo: op.promo, source: 'check', date: op.date });
      return { ok: true };
    }
    case 'receipt.save': {
      const r = R.saveReceipt(hid, user.id, op);
      return { ok: true, listId: r.listId, receipt: r };
    }
    default:
      return { ok: false, reason: 'Opération inconnue.' };
  }
}

function applyOps(hid, user, role, ops) {
  const list = Array.isArray(ops) ? ops.slice(0, MAX_OPS) : [];
  const results = [];
  for (const op of list) {
    const id = String(op && op.op_id || '').slice(0, 80);
    if (!id) { results.push({ ok: false, reason: 'op_id manquant.' }); continue; }
    const done = db.prepare('SELECT result FROM applied_ops WHERE op_id = ?').get(id);
    if (done) { results.push({ op_id: id, ...JSON.parse(done.result), replay: true }); continue; }
    let r;
    try {
      r = applyOne(hid, user, role, op);
    } catch (e) {
      // Refus metier (droits, liste cloturee...) : definitif, l'appareil ne reessaie pas.
      if (!e.status || e.status >= 500) throw e;
      r = { ok: false, reason: e.message };
    }
    db.prepare('INSERT INTO applied_ops (op_id, household_id, user_id, result, at) VALUES (?, ?, ?, ?, ?)').run(id, hid, user.id, JSON.stringify(r), Date.now());
    results.push({ op_id: id, ...r });
  }
  db.prepare('DELETE FROM applied_ops WHERE at < ?').run(Date.now() - 30 * 24 * 3600 * 1000);
  return results;
}

module.exports = { applyOps };
