// Types de plats (poisson, pates, porc…) : plusieurs par plat, geres depuis le foyer
// (creer, renommer, fusionner, supprimer). Modeles de semaine : regles de generation du
// menu, « exactement N » ou « au plus N » repas d'un type par semaine, repas vise facultatif.
const { db, tx, normalize } = require('./db');
const { httpError, str } = require('./util');

const SLOTS = ['pdj', 'midi', 'soir', 'coll'];

// ---------- Types ----------
function types(hid) {
  return db.prepare(`SELECT t.id, t.name, (SELECT COUNT(*) FROM dish_type_links l JOIN dishes d ON d.id = l.dish_id WHERE l.type_id = t.id AND d.deleted_at IS NULL) AS dishes
    FROM dish_types t WHERE t.household_id = ? ORDER BY t.name_norm`).all(hid);
}
function ownType(hid, tid) {
  const t = db.prepare('SELECT id, name FROM dish_types WHERE id = ? AND household_id = ?').get(tid, hid);
  if (!t) throw httpError(404, 'Type introuvable.');
  return t;
}
const typeName = (name) => {
  const n = str(name, 30);
  if (!n) throw httpError(400, 'Nom du type requis.');
  return n;
};
function createType(hid, name) {
  const n = typeName(name);
  if (db.prepare('SELECT 1 FROM dish_types WHERE household_id = ? AND name_norm = ?').get(hid, normalize(n))) throw httpError(409, 'Ce type existe déjà.');
  return Number(db.prepare('INSERT INTO dish_types (household_id, name, name_norm) VALUES (?, ?, ?)').run(hid, n, normalize(n)).lastInsertRowid);
}
// Fusion : les plats et les regles de « from » passent a « into », puis « from » disparait.
function mergeType(hid, from, into) {
  ownType(hid, from); ownType(hid, into);
  if (from === into) throw httpError(400, 'Choisissez un autre type.');
  tx(() => {
    db.prepare('INSERT OR IGNORE INTO dish_type_links (dish_id, type_id) SELECT dish_id, ? FROM dish_type_links WHERE type_id = ?').run(into, from);
    db.prepare('UPDATE menu_model_rules SET type_id = ? WHERE type_id = ?').run(into, from);
    db.prepare('DELETE FROM dish_types WHERE id = ?').run(from);
  });
}
// Renommer vers le nom d'un autre type = fusionner avec lui.
function renameType(hid, tid, name) {
  ownType(hid, tid);
  const n = typeName(name);
  const other = db.prepare('SELECT id FROM dish_types WHERE household_id = ? AND name_norm = ? AND id <> ?').get(hid, normalize(n), tid);
  if (other) return mergeType(hid, tid, other.id);
  db.prepare('UPDATE dish_types SET name = ?, name_norm = ? WHERE id = ?').run(n, normalize(n), tid);
}
// Suppression : retire le type des plats et des modeles.
function deleteType(hid, tid) {
  ownType(hid, tid);
  db.prepare('DELETE FROM dish_types WHERE id = ?').run(tid);
}
// Types d'un plat par leurs noms (crees a la volee), dans une transaction ouverte.
function setDishTypes(hid, did, names) {
  db.prepare('DELETE FROM dish_type_links WHERE dish_id = ?').run(did);
  const seen = new Set();
  for (const raw of (Array.isArray(names) ? names : []).slice(0, 12)) {
    const n = str(raw, 30), k = normalize(n);
    if (!n || seen.has(k)) continue;
    seen.add(k);
    let t = db.prepare('SELECT id FROM dish_types WHERE household_id = ? AND name_norm = ?').get(hid, k);
    if (!t) t = { id: Number(db.prepare('INSERT INTO dish_types (household_id, name, name_norm) VALUES (?, ?, ?)').run(hid, n, k).lastInsertRowid) };
    db.prepare('INSERT INTO dish_type_links (dish_id, type_id) VALUES (?, ?)').run(did, t.id);
  }
}
// Map plat -> [{ id, name }] pour le foyer.
function typesOfDishes(hid) {
  const map = new Map();
  for (const r of db.prepare(`SELECT l.dish_id, t.id, t.name FROM dish_type_links l JOIN dish_types t ON t.id = l.type_id
    WHERE t.household_id = ? ORDER BY t.name_norm`).all(hid)) {
    if (!map.has(r.dish_id)) map.set(r.dish_id, []);
    map.get(r.dish_id).push({ id: r.id, name: r.name });
  }
  return map;
}

// ---------- Modeles de semaine ----------
// Regles nettoyees : [{ type_id, n (0..28), mode: 'exact' | 'max', slot: null | creneau }].
function cleanRules(hid, rules) {
  const known = new Set(types(hid).map((t) => t.id));
  return (Array.isArray(rules) ? rules : []).slice(0, 30).map((r) => ({
    type_id: Number(r && r.type_id), n: Math.min(28, Math.max(0, parseInt(r && r.n, 10) || 0)),
    mode: r && r.mode === 'max' ? 'max' : 'exact', slot: SLOTS.includes(r && r.slot) ? r.slot : null,
  })).filter((r) => known.has(r.type_id));
}
function models(hid) {
  const ms = db.prepare('SELECT id, name FROM menu_models WHERE household_id = ? ORDER BY name COLLATE NOCASE').all(hid);
  const rules = db.prepare(`SELECT r.type_id, t.name AS type, r.n, r.mode, r.slot FROM menu_model_rules r JOIN dish_types t ON t.id = r.type_id
    WHERE r.model_id = ? ORDER BY r.position, r.id`);
  return ms.map((m) => ({ ...m, rules: rules.all(m.id) }));
}
// Cree (id absent) ou remplace un modele : b = { name, rules }.
function saveModel(hid, id, b) {
  const name = str(b.name, 60);
  if (!name) throw httpError(400, 'Nom du modèle requis.');
  if (id && !db.prepare('SELECT 1 FROM menu_models WHERE id = ? AND household_id = ?').get(id, hid)) throw httpError(404, 'Modèle introuvable.');
  const rules = cleanRules(hid, b.rules);
  return tx(() => {
    if (id) {
      db.prepare('UPDATE menu_models SET name = ? WHERE id = ?').run(name, id);
      db.prepare('DELETE FROM menu_model_rules WHERE model_id = ?').run(id);
    } else id = Number(db.prepare('INSERT INTO menu_models (household_id, name, created_at) VALUES (?, ?, ?)').run(hid, name, Date.now()).lastInsertRowid);
    rules.forEach((r, k) => db.prepare('INSERT INTO menu_model_rules (model_id, type_id, n, mode, slot, position) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, r.type_id, r.n, r.mode, r.slot, k));
    return id;
  });
}
function deleteModel(hid, id) {
  if (!db.prepare('DELETE FROM menu_models WHERE id = ? AND household_id = ?').run(id, hid).changes) throw httpError(404, 'Modèle introuvable.');
}

module.exports = { types, createType, renameType, mergeType, deleteType, setDishTypes, typesOfDishes, cleanRules, models, saveModel, deleteModel };
