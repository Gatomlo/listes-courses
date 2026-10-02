// Catalogue d'un foyer : magasins, rayons (categories) et leur ordre par magasin,
// produits, releves de prix et prix moyens.
const { db, tx, normalize } = require('./db');
const { httpError, str, cents, isoDate, today } = require('./util');

const UNITS = ['bouteille', 'brique', 'paquet', 'boîte', 'sachet', 'barquette', 'pot', 'flacon', 'pack', 'pièce', 'kg', 'tête', 'botte'];
const COLOR = /^#[0-9a-f]{6}$/i;

// ---------- Magasins ----------
function stores(hid) {
  const rows = db.prepare('SELECT id, name, color, active, position FROM stores WHERE household_id = ? ORDER BY position, id').all(hid);
  const order = db.prepare(`SELECT o.store_id, o.category_id FROM store_category_order o JOIN stores s ON s.id = o.store_id
    WHERE s.household_id = ? ORDER BY o.position`).all(hid);
  return rows.map((s) => ({ ...s, active: !!s.active, categoryOrder: order.filter((o) => o.store_id === s.id).map((o) => o.category_id) }));
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
    // Ordre des rayons par defaut : celui du premier magasin, sinon l'ordre de creation.
    const ref = db.prepare(`SELECT o.category_id FROM store_category_order o JOIN stores s ON s.id = o.store_id
      WHERE s.household_id = ? AND s.id <> ? ORDER BY s.position, o.position`).all(hid, sid);
    const cats = ref.length ? [...new Set(ref.map((r) => r.category_id))] : db.prepare('SELECT id AS category_id FROM categories WHERE household_id = ? ORDER BY id').all(hid).map((r) => r.category_id);
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
  if (b.active != null) {
    const active = b.active ? 1 : 0;
    if (!active && s.active) {
      const others = db.prepare('SELECT COUNT(*) AS n FROM stores WHERE household_id = ? AND active = 1 AND id <> ?').get(hid, sid).n;
      if (!others) throw httpError(409, 'Il faut au moins un magasin actif.');
    }
    db.prepare('UPDATE stores SET active = ? WHERE id = ?').run(active, sid);
  }
}

// Nouvel ordre des rayons d'un magasin (liste complete des identifiants de rayons).
function setCategoryOrder(hid, sid, ids) {
  ownStore(hid, sid);
  const all = db.prepare('SELECT id FROM categories WHERE household_id = ?').all(hid).map((r) => r.id);
  const list = (Array.isArray(ids) ? ids : []).map(Number);
  if (list.length !== all.length || !all.every((id) => list.includes(id))) throw httpError(400, 'Ordre des rayons incomplet.');
  tx(() => list.forEach((cid, i) => db.prepare(`INSERT INTO store_category_order (store_id, category_id, position) VALUES (?, ?, ?)
    ON CONFLICT(store_id, category_id) DO UPDATE SET position = excluded.position`).run(sid, cid, i)));
}

// ---------- Rayons ----------
function categories(hid) {
  return db.prepare(`SELECT c.id, c.name, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS products
    FROM categories c WHERE c.household_id = ? ORDER BY c.id`).all(hid);
}

const ownCategory = (hid, cid) => {
  const c = db.prepare('SELECT id FROM categories WHERE id = ? AND household_id = ?').get(cid, hid);
  if (!c) throw httpError(404, 'Rayon introuvable.');
};

// Nouveau rayon : en fin de parcours de tous les magasins.
function createCategory(hid, b) {
  const name = str(b.name, 60);
  if (!name) throw httpError(400, 'Nom du rayon requis.');
  return tx(() => {
    const cid = Number(db.prepare('INSERT INTO categories (household_id, name) VALUES (?, ?)').run(hid, name).lastInsertRowid);
    for (const s of db.prepare('SELECT id FROM stores WHERE household_id = ?').all(hid)) {
      const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM store_category_order WHERE store_id = ?').get(s.id).p;
      db.prepare('INSERT INTO store_category_order (store_id, category_id, position) VALUES (?, ?, ?)').run(s.id, cid, pos);
    }
    return cid;
  });
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
    return { ...p, is_base: !!p.is_base, prices, best_store_id: bestStore(p, prices, activeIds) };
  });
}

// ---------- Produits ----------
const PRODUCT_COLS = 'id, name, category_id, unit, contenance, recurrence, is_base, forced_store_id';

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
  const name = b.name != null ? str(b.name, 80) : cur.name;
  if (!name) throw httpError(400, 'Nom du produit requis.');
  const category_id = b.category_id != null ? Number(b.category_id) : cur.category_id;
  ownCategory(hid, category_id);
  const unit = b.unit != null ? (UNITS.includes(b.unit) ? b.unit : 'paquet') : (cur.unit || 'paquet');
  const contenance = b.contenance !== undefined ? (str(b.contenance, 30) || null) : (cur.contenance ?? null);
  let recurrence = b.recurrence !== undefined ? parseInt(b.recurrence, 10) : cur.recurrence;
  if (!(recurrence >= 1 && recurrence <= 3)) recurrence = null;
  const is_base = b.is_base !== undefined ? (b.is_base ? 1 : 0) : (cur.is_base ? 1 : 0);
  let forced = b.forced_store_id !== undefined ? (b.forced_store_id ? Number(b.forced_store_id) : null) : (cur.forced_store_id ?? null);
  if (forced) ownStore(hid, forced);
  const dup = db.prepare('SELECT id FROM products WHERE household_id = ? AND name_norm = ? AND id <> ? AND deleted_at IS NULL').get(hid, normalize(name), cur.id || 0);
  if (dup) throw httpError(409, 'Un produit porte déjà ce nom.');
  return { name, name_norm: normalize(name), category_id, unit, contenance, recurrence, is_base, forced_store_id: forced };
}

function createProduct(hid, b) {
  const f = productFields(hid, b);
  const id = Number(db.prepare(`INSERT INTO products (household_id, name, name_norm, category_id, unit, contenance, recurrence, is_base, forced_store_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(hid, f.name, f.name_norm, f.category_id, f.unit, f.contenance, f.recurrence, f.is_base, f.forced_store_id, Date.now()).lastInsertRowid);
  return product(hid, id);
}

function updateProduct(hid, pid, b) {
  const cur = db.prepare(`SELECT ${PRODUCT_COLS} FROM products WHERE id = ? AND household_id = ? AND deleted_at IS NULL`).get(pid, hid);
  if (!cur) throw httpError(404, 'Produit introuvable.');
  const f = productFields(hid, b, cur);
  db.prepare(`UPDATE products SET name = ?, name_norm = ?, category_id = ?, unit = ?, contenance = ?, recurrence = ?, is_base = ?, forced_store_id = ?
    WHERE id = ?`).run(f.name, f.name_norm, f.category_id, f.unit, f.contenance, f.recurrence, f.is_base, f.forced_store_id, pid);
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
    if (db.prepare('SELECT 1 FROM list_items WHERE product_id = ?').get(pid)) {
      db.prepare('UPDATE products SET deleted_at = ?, recurrence = NULL WHERE id = ?').run(Date.now(), pid);
    } else {
      db.prepare('DELETE FROM products WHERE id = ?').run(pid);
    }
  });
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
    db.prepare('DELETE FROM products WHERE id = ?').run(from);
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
  UNITS, stores, createStore, updateStore, setCategoryOrder, categories, createCategory, renameCategory, deleteCategory,
  products, product, createProduct, updateProduct, deleteProduct, mergeProduct, addRecord, deleteRecord, averages,
};
