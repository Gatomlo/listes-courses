// Catalogue d'un foyer : magasins, rayons (categories) et leur ordre par magasin,
// produits, releves de prix et prix moyens.
const { db, tx, normalize } = require('./db');
const { httpError, str, cents, isoDate, today } = require('./util');
const { parseSize } = require('./units');

const UNITS = ['bouteille', 'brique', 'paquet', 'boîte', 'sachet', 'barquette', 'pot', 'flacon', 'pack', 'pièce', 'kg', 'tête', 'botte'];
const CONT_UNITS = ['g', 'kg', 'ml', 'cl', 'L', 'pièces'];
const COLOR = /^#[0-9a-f]{6}$/i;

// ---------- Magasins ----------
function stores(hid) {
  const rows = db.prepare('SELECT id, name, color, active, auto_route, position FROM stores WHERE household_id = ? ORDER BY position, id').all(hid);
  const order = db.prepare(`SELECT o.store_id, o.category_id FROM store_category_order o JOIN stores s ON s.id = o.store_id
    WHERE s.household_id = ? ORDER BY o.position`).all(hid);
  const sub = db.prepare(`SELECT o.store_id, o.subcategory_id FROM store_subcategory_order o JOIN stores s ON s.id = o.store_id
    WHERE s.household_id = ? ORDER BY o.position`).all(hid);
  return rows.map((s) => ({ ...s, active: !!s.active, auto_route: !!s.auto_route, categoryOrder: order.filter((o) => o.store_id === s.id).map((o) => o.category_id),
    subOrder: sub.filter((o) => o.store_id === s.id).map((o) => o.subcategory_id) }));
}

const ownStore = (hid, sid) => {
  const s = db.prepare('SELECT id, active FROM stores WHERE id = ? AND household_id = ?').get(sid, hid);
  if (!s) throw httpError(404, 'Magasin introuvable.');
  return s;
};

function createStore(hid, b) {
  const name = str(b.name, 60);
  if (!name) throw httpError(400, 'Nom du magasin requis.');
  const color = COLOR.test(b.color || '') ? b.color : '#5b4bb7';
  return tx(() => {
    const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM stores WHERE household_id = ?').get(hid).p;
    const sid = Number(db.prepare('INSERT INTO stores (household_id, name, color, position) VALUES (?, ?, ?, ?)').run(hid, name, color, pos).lastInsertRowid);
    // Rayons de depart : ceux d'un magasin choisi (copy_from), aucun (copy_from = 'none',
    // ex. pharmacie : rayons a creer), sinon ceux du premier magasin, sinon tous les rayons.
    let cats;
    if (b.copy_from === 'none') cats = [];
    else {
      const from = b.copy_from ? ownStore(hid, Number(b.copy_from)).id
        : (db.prepare('SELECT id FROM stores WHERE household_id = ? AND id <> ? ORDER BY position, id LIMIT 1').get(hid, sid) || {}).id;
      cats = from ? db.prepare('SELECT category_id FROM store_category_order WHERE store_id = ? ORDER BY position').all(from).map((r) => r.category_id)
        : db.prepare('SELECT id AS category_id FROM categories WHERE household_id = ? ORDER BY id').all(hid).map((r) => r.category_id);
    }
    cats.forEach((cid, i) => db.prepare('INSERT INTO store_category_order (store_id, category_id, position) VALUES (?, ?, ?)').run(sid, cid, i));
    return sid;
  });
}

function updateStore(hid, sid, b) {
  const s = ownStore(hid, sid);
  if (b.name != null) {
    const name = str(b.name, 60);
    if (!name) throw httpError(400, 'Nom du magasin requis.');
    db.prepare('UPDATE stores SET name = ? WHERE id = ?').run(name, sid);
  }
  if (b.color != null && COLOR.test(b.color)) db.prepare('UPDATE stores SET color = ? WHERE id = ?').run(b.color, sid);
  if (b.auto_route != null) db.prepare('UPDATE stores SET auto_route = ? WHERE id = ?').run(b.auto_route ? 1 : 0, sid);
  if (b.active != null) {
    const active = b.active ? 1 : 0;
    if (!active && s.active) {
      const others = db.prepare('SELECT COUNT(*) AS n FROM stores WHERE household_id = ? AND active = 1 AND id <> ?').get(hid, sid).n;
      if (!others) throw httpError(409, 'Il faut au moins un magasin actif.');
    }
    db.prepare('UPDATE stores SET active = ? WHERE id = ?').run(active, sid);
  }
}

// Parcours d'un magasin : ses rayons, dans l'ordre (chaque magasin a les siens ; un rayon
// absent de la liste est retire de ce magasin seulement).
function setCategoryOrder(hid, sid, ids) {
  ownStore(hid, sid);
  const all = new Set(db.prepare('SELECT id FROM categories WHERE household_id = ?').all(hid).map((r) => r.id));
  const list = (Array.isArray(ids) ? ids : []).map(Number);
  if (!list.every((id) => all.has(id)) || new Set(list).size !== list.length) throw httpError(400, 'Rayons invalides.');
  tx(() => {
    db.prepare(`DELETE FROM store_category_order WHERE store_id = ? AND category_id NOT IN (${list.map(() => '?').join(',') || 'NULL'})`).run(sid, ...list);
    list.forEach((cid, i) => db.prepare(`INSERT INTO store_category_order (store_id, category_id, position) VALUES (?, ?, ?)
      ON CONFLICT(store_id, category_id) DO UPDATE SET position = excluded.position`).run(sid, cid, i));
  });
}

// ---------- Rayons ----------
function categories(hid) {
  const subs = db.prepare(`SELECT s.id, s.category_id, s.name, (SELECT COUNT(*) FROM products p WHERE p.subcategory_id = s.id AND p.deleted_at IS NULL) AS products
    FROM subcategories s WHERE s.household_id = ? ORDER BY s.id`).all(hid);
  return db.prepare(`SELECT c.id, c.name, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS products
    FROM categories c WHERE c.household_id = ? ORDER BY c.id`).all(hid).map((c) => ({ ...c, subs: subs.filter((x) => x.category_id === c.id) }));
}

// ---------- Sous-rayons ----------
const ownSub = (hid, id) => {
  const r = db.prepare('SELECT id, category_id FROM subcategories WHERE id = ? AND household_id = ?').get(id, hid);
  if (!r) throw httpError(404, 'Sous-rayon introuvable.');
  return r;
};
function createSub(hid, b) {
  const name = str(b.name, 60);
  if (!name) throw httpError(400, 'Nom du sous-rayon requis.');
  ownCategory(hid, Number(b.category_id));
  if (db.prepare('SELECT 1 FROM subcategories WHERE category_id = ? AND name = ? COLLATE NOCASE').get(Number(b.category_id), name)) throw httpError(409, 'Ce sous-rayon existe déjà dans ce rayon.');
  const id = Number(db.prepare('INSERT INTO subcategories (household_id, category_id, name) VALUES (?, ?, ?)').run(hid, Number(b.category_id), name).lastInsertRowid);
  return id;
}
function renameSub(hid, id, b) {
  ownSub(hid, id);
  const name = str(b.name, 60);
  if (!name) throw httpError(400, 'Nom du sous-rayon requis.');
  db.prepare('UPDATE subcategories SET name = ? WHERE id = ?').run(name, id);
}
// Les produits du sous-rayon restent dans le rayon, sans sous-rayon.
function deleteSub(hid, id) {
  ownSub(hid, id);
  db.prepare('DELETE FROM subcategories WHERE id = ?').run(id);
}
// Ordre des sous-rayons d'un rayon dans un magasin (ids d'un meme rayon).
function setSubOrder(hid, sid, cid, ids) {
  ownStore(hid, sid); ownCategory(hid, cid);
  const list = (Array.isArray(ids) ? ids : []).map(Number);
  const ok = new Set(db.prepare('SELECT id FROM subcategories WHERE category_id = ?').all(cid).map((r) => r.id));
  if (!list.every((id) => ok.has(id)) || new Set(list).size !== list.length) throw httpError(400, 'Sous-rayons invalides.');
  tx(() => {
    db.prepare('DELETE FROM store_subcategory_order WHERE store_id = ? AND subcategory_id IN (SELECT id FROM subcategories WHERE category_id = ?)').run(sid, cid);
    // Positions globales du magasin : a la suite de celles des autres rayons.
    let pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM store_subcategory_order WHERE store_id = ?').get(sid).p;
    for (const id of list) db.prepare('INSERT INTO store_subcategory_order (store_id, subcategory_id, position) VALUES (?, ?, ?)').run(sid, id, pos++);
  });
}

const ownCategory = (hid, cid) => {
  const c = db.prepare('SELECT id FROM categories WHERE id = ? AND household_id = ?').get(cid, hid);
  if (!c) throw httpError(404, 'Rayon introuvable.');
};

// Nouveau rayon : en fin de parcours des magasins choisis (store_ids), sinon de tous.
function createCategory(hid, b) {
  const name = str(b.name, 60);
  if (!name) throw httpError(400, 'Nom du rayon requis.');
  const ids = Array.isArray(b.store_ids) ? b.store_ids.map((x) => ownStore(hid, Number(x)).id) : null;
  return tx(() => insertCategory(hid, name, ids));
}

// Sans transaction (a appeler dans une) : nouveau rayon en fin de parcours des magasins
// donnes (par defaut tous).
function insertCategory(hid, name, storeIds = null) {
  const cid = Number(db.prepare('INSERT INTO categories (household_id, name) VALUES (?, ?)').run(hid, name).lastInsertRowid);
  for (const s of db.prepare('SELECT id FROM stores WHERE household_id = ?').all(hid).filter((x) => !storeIds || storeIds.includes(x.id))) {
    const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM store_category_order WHERE store_id = ?').get(s.id).p;
    db.prepare('INSERT INTO store_category_order (store_id, category_id, position) VALUES (?, ?, ?)').run(s.id, cid, pos);
  }
  return cid;
}

function renameCategory(hid, cid, b) {
  ownCategory(hid, cid);
  const name = str(b.name, 60);
  if (!name) throw httpError(400, 'Nom du rayon requis.');
  db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, cid);
}

// Suppression : les produits du rayon passent dans `moveTo` (obligatoire s'il y en a).
function deleteCategory(hid, cid, moveTo) {
  ownCategory(hid, cid);
  const n = db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id = ? AND deleted_at IS NULL').get(cid).n;
  tx(() => {
    let to = Number(moveTo);
    if (n) {
      if (!to || to === cid) throw httpError(400, 'Choisir le rayon qui reçoit les produits.');
      ownCategory(hid, to);
    } else if (!to || to === cid) {
      // Seulement des produits supprimes (gardes pour l'historique) : n'importe quel autre rayon.
      to = (db.prepare('SELECT id FROM categories WHERE household_id = ? AND id <> ? LIMIT 1').get(hid, cid) || {}).id;
    }
    if (to) db.prepare('UPDATE products SET category_id = ? WHERE category_id = ?').run(to, cid);
    db.prepare('DELETE FROM categories WHERE id = ?').run(cid);
  });
}

// ---------- Prix moyens ----------
// Moyenne des N derniers releves hors promo de moins de 6 mois, par produit et magasin.
function averages(hid, productId = null) {
  const h = db.prepare('SELECT avg_records FROM households WHERE id = ?').get(hid);
  const since = new Date(Date.now() - 183 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const rows = db.prepare(`SELECT product_id, store_id, ROUND(AVG(price_cents)) AS avg, COUNT(*) AS n, MAX(date) AS last FROM (
      SELECT r.product_id, r.store_id, r.price_cents, r.date,
        ROW_NUMBER() OVER (PARTITION BY r.product_id, r.store_id ORDER BY r.date DESC, r.id DESC) AS rn
      FROM price_records r JOIN products p ON p.id = r.product_id
      WHERE p.household_id = ? AND r.promo = 0 AND r.date >= ? AND (? IS NULL OR p.id = ?)
    ) WHERE rn <= ? GROUP BY product_id, store_id`).all(hid, since, productId, productId, h.avg_records);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.product_id)) map.set(r.product_id, {});
    map.get(r.product_id)[r.store_id] = { avg: r.avg, n: r.n, last: r.last };
  }
  return map;
}

// Magasin conseille : impose (s'il est actif), sinon le moins cher parmi les actifs.
function bestStore(product, prices, activeIds) {
  if (product.forced_store_id && activeIds.includes(product.forced_store_id)) return product.forced_store_id;
  let best = null;
  for (const sid of activeIds) {
    const p = prices[sid];
    if (p && (best == null || p.avg < prices[best].avg)) best = sid;
  }
  return best;
}

function decorate(hid, rows, productId = null) {
  const avg = averages(hid, productId);
  const activeIds = db.prepare('SELECT id FROM stores WHERE household_id = ? AND active = 1 ORDER BY position').all(hid).map((s) => s.id);
  return rows.map((p) => {
    const prices = avg.get(p.id) || {};
    return { ...p, is_base: !!p.is_base, size: parseSize(p.contenance, p.unit), prices, best_store_id: bestStore(p, prices, activeIds) };
  });
}

// ---------- Produits ----------
const PRODUCT_COLS = 'id, name, category_id, subcategory_id, unit, contenance, piece_qty, recurrence, is_base, forced_store_id';

function products(hid) {
  return decorate(hid, db.prepare(`SELECT ${PRODUCT_COLS} FROM products WHERE household_id = ? AND deleted_at IS NULL ORDER BY name_norm`).all(hid));
}

function product(hid, pid) {
  const row = db.prepare(`SELECT ${PRODUCT_COLS} FROM products WHERE id = ? AND household_id = ? AND deleted_at IS NULL`).get(pid, hid);
  if (!row) throw httpError(404, 'Produit introuvable.');
  const [p] = decorate(hid, [row], pid);
  p.records = db.prepare(`SELECT r.id, r.store_id, r.price_cents, r.date, r.source, r.promo, u.name AS user
    FROM price_records r LEFT JOIN users u ON u.id = r.user_id WHERE r.product_id = ? ORDER BY r.date DESC, r.id DESC LIMIT 30`).all(pid)
    .map((r) => ({ ...r, promo: !!r.promo }));
  p.promos = require('./pricing').listPromos(hid).filter((x) => x.product_id === pid);
  return p;
}

// Champs d'un produit (creation ou modification) ; `cur` = valeurs actuelles.
function productFields(hid, b, cur = {}) {
  // « rayon » : liste unique des formulaires, « <rayon> » ou « <rayon>:<sous-rayon> ».
  if (b.rayon !== undefined && b.rayon !== '') { const [c, sc] = String(b.rayon).split(':'); b = { ...b, category_id: Number(c), subcategory_id: sc ? Number(sc) : null }; }
  const name = b.name != null ? str(b.name, 80) : cur.name;
  if (!name) throw httpError(400, 'Nom du produit requis.');
  const category_id = b.category_id != null ? Number(b.category_id) : cur.category_id;
  ownCategory(hid, category_id);
  // Sous-rayon : doit appartenir au rayon choisi ; changer de rayon l'efface (sauf s'il est redonne).
  let subcategory_id = b.subcategory_id !== undefined ? (b.subcategory_id ? Number(b.subcategory_id) : null) : (cur.category_id === category_id ? (cur.subcategory_id ?? null) : null);
  if (subcategory_id && ownSub(hid, subcategory_id).category_id !== category_id) throw httpError(400, 'Ce sous-rayon n’appartient pas à ce rayon.');
  const unit = b.unit != null ? (UNITS.includes(b.unit) ? b.unit : 'paquet') : (cur.unit || 'paquet');
  // Contenance : nombre + unite (formulaire : cont_n, cont_u) ou texte libre (import CSV,
  // ancienne valeur gardee tant qu'elle n'est pas ressaisie).
  let contenance = b.contenance !== undefined ? (str(b.contenance, 30) || null) : (cur.contenance ?? null);
  if (b.cont_n !== undefined) {
    const n = Number(String(b.cont_n ?? '').replace(',', '.'));
    if (n > 0 && n < 1e6 && CONT_UNITS.includes(b.cont_u)) contenance = `${String(Math.round(n * 1000) / 1000).replace('.', ',')} ${b.cont_u}`;
    else contenance = b.contenance !== undefined ? (str(b.contenance, 30) || null) : null;
  }
  let piece_qty = b.piece_qty !== undefined ? Number(String(b.piece_qty ?? '').replace(',', '.')) : cur.piece_qty;
  if (!(piece_qty > 0 && piece_qty < 100000)) piece_qty = null;
  let recurrence = b.recurrence !== undefined ? parseInt(b.recurrence, 10) : cur.recurrence;
  if (!(recurrence >= 1 && recurrence <= 3)) recurrence = null;
  const is_base = b.is_base !== undefined ? (b.is_base ? 1 : 0) : (cur.is_base ? 1 : 0);
  let forced = b.forced_store_id !== undefined ? (b.forced_store_id ? Number(b.forced_store_id) : null) : (cur.forced_store_id ?? null);
  if (forced) ownStore(hid, forced);
  const dup = db.prepare('SELECT id FROM products WHERE household_id = ? AND name_norm = ? AND id <> ? AND deleted_at IS NULL').get(hid, normalize(name), cur.id || 0);
  if (dup) throw httpError(409, 'Un produit porte déjà ce nom.');
  return { name, name_norm: normalize(name), category_id, subcategory_id, unit, contenance, piece_qty, recurrence, is_base, forced_store_id: forced };
}

function createProduct(hid, b) {
  const f = productFields(hid, b);
  const id = Number(db.prepare(`INSERT INTO products (household_id, name, name_norm, category_id, subcategory_id, unit, contenance, piece_qty, recurrence, is_base, forced_store_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(hid, f.name, f.name_norm, f.category_id, f.subcategory_id, f.unit, f.contenance, f.piece_qty, f.recurrence, f.is_base, f.forced_store_id, Date.now()).lastInsertRowid);
  return product(hid, id);
}

function updateProduct(hid, pid, b) {
  const cur = db.prepare(`SELECT ${PRODUCT_COLS} FROM products WHERE id = ? AND household_id = ? AND deleted_at IS NULL`).get(pid, hid);
  if (!cur) throw httpError(404, 'Produit introuvable.');
  const f = productFields(hid, b, cur);
  db.prepare(`UPDATE products SET name = ?, name_norm = ?, category_id = ?, subcategory_id = ?, unit = ?, contenance = ?, piece_qty = ?, recurrence = ?, is_base = ?, forced_store_id = ?
    WHERE id = ?`).run(f.name, f.name_norm, f.category_id, f.subcategory_id, f.unit, f.contenance, f.piece_qty, f.recurrence, f.is_base, f.forced_store_id, pid);
  if (['is_base', 'unit', 'contenance', 'piece_qty'].some((k) => (k === 'is_base' ? !!cur[k] !== !!f[k] : cur[k] !== f[k]))) require('./meals').syncMealItems(hid);
  return product(hid, pid);
}

// Suppression : retire le produit des listes en cours et supprime ses releves. S'il
// figure dans une liste cloturee, il est seulement marque supprime (l'historique garde
// son nom, affiche barre) ; sinon il est efface.
function deleteProduct(hid, pid) {
  if (!db.prepare('SELECT 1 FROM products WHERE id = ? AND household_id = ? AND deleted_at IS NULL').get(pid, hid)) throw httpError(404, 'Produit introuvable.');
  tx(() => {
    db.prepare("DELETE FROM list_items WHERE product_id = ? AND list_id IN (SELECT id FROM lists WHERE status <> 'closed')").run(pid);
    db.prepare('DELETE FROM price_records WHERE product_id = ?').run(pid);
    db.prepare('DELETE FROM dish_ingredients WHERE product_id = ?').run(pid);
    db.prepare('DELETE FROM planned_meal_skips WHERE product_id = ?').run(pid);
    if (db.prepare('SELECT 1 FROM list_items WHERE product_id = ?').get(pid)) {
      db.prepare('UPDATE products SET deleted_at = ?, recurrence = NULL WHERE id = ?').run(Date.now(), pid);
    } else {
      db.prepare('DELETE FROM products WHERE id = ?').run(pid);
    }
    require('./meals').syncMealItems(hid);
  });
}

// Modification ou suppression en masse : `set` = champs communs (rayon, de base, magasin
// impose, recurrence) appliques a chaque produit, ou `delete`.
function bulkProducts(hid, b) {
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number))].slice(0, 500);
  if (!ids.length) throw httpError(400, 'Aucun produit choisi.');
  if (b.delete) { ids.forEach((id) => deleteProduct(hid, id)); return { deleted: ids.length }; }
  const set = {};
  for (const k of ['rayon', 'category_id', 'subcategory_id', 'is_base', 'forced_store_id', 'recurrence']) if (b.set && b.set[k] !== undefined) set[k] = b.set[k];
  if (!Object.keys(set).length) throw httpError(400, 'Rien à modifier.');
  ids.forEach((id) => updateProduct(hid, id, set));
  return { updated: ids.length };
}

// Fusion d'un doublon : ses releves passent au produit garde, puis il est supprime.
// Les articles de listes suivent (plats et promos : etapes suivantes).
function mergeProduct(hid, from, into) {
  if (Number(from) === Number(into)) throw httpError(400, 'Choisir un autre produit.');
  for (const id of [from, into]) {
    if (!db.prepare('SELECT 1 FROM products WHERE id = ? AND household_id = ? AND deleted_at IS NULL').get(id, hid)) throw httpError(404, 'Produit introuvable.');
  }
  tx(() => {
    db.prepare('UPDATE price_records SET product_id = ? WHERE product_id = ?').run(into, from);
    require('./lists').mergeProductItems(Number(from), Number(into));
    db.prepare('UPDATE promos SET product_id = ? WHERE product_id = ?').run(into, from);
    db.prepare('UPDATE dish_ingredients SET product_id = ? WHERE product_id = ?').run(into, from);
    db.prepare('INSERT OR IGNORE INTO planned_meal_skips (meal_id, product_id) SELECT meal_id, ? FROM planned_meal_skips WHERE product_id = ?').run(into, from);
    db.prepare('DELETE FROM planned_meal_skips WHERE product_id = ?').run(from);
    db.prepare('DELETE FROM products WHERE id = ?').run(from);
    require('./meals').syncMealItems(hid);
  });
  return product(hid, into);
}

function addRecord(hid, pid, userId, b) {
  if (!db.prepare('SELECT 1 FROM products WHERE id = ? AND household_id = ? AND deleted_at IS NULL').get(pid, hid)) throw httpError(404, 'Produit introuvable.');
  ownStore(hid, Number(b.store_id));
  const price = cents(b.price);
  if (price == null || price === 0) throw httpError(400, 'Prix invalide.');
  const date = isoDate(b.date) || today();
  const source = ['check', 'manual', 'ocr'].includes(b.source) ? b.source : 'manual';
  db.prepare(`INSERT INTO price_records (product_id, store_id, price_cents, date, source, promo, user_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(pid, Number(b.store_id), price, date, source, b.promo ? 1 : 0, userId, Date.now());
  return product(hid, pid);
}

function deleteRecord(hid, pid, rid) {
  const r = db.prepare(`DELETE FROM price_records WHERE id = ? AND product_id = ?
    AND product_id IN (SELECT id FROM products WHERE household_id = ?)`).run(rid, pid, hid);
  if (!r.changes) throw httpError(404, 'Relevé introuvable.');
  return product(hid, pid);
}

module.exports = {
  UNITS, bulkProducts, stores, createStore, updateStore, setCategoryOrder, categories, createSub, renameSub, deleteSub, setSubOrder, createCategory, insertCategory, renameCategory, deleteCategory,
  products, product, createProduct, updateProduct, deleteProduct, mergeProduct, addRecord, deleteRecord, averages,
};
