// Listes de courses d'un foyer : « A prevoir » (permanente, creee a la demande) et
// listes datees (une par date). Articles, suggestions des membres, cloture avec report,
// articles recurrents.
const { db, tx } = require('./db');
const { httpError, isoDate, today, cents } = require('./util');
const pricing = require('./pricing');
const { fmtAmount } = require('./units');
// Recalcul des ingredients des repas (charge a la demande : meals.js utilise db seulement).
const syncMeals = (hid) => require('./meals').syncMealItems(hid);

const now = () => Date.now();
const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const qtyOf = (v, def = 1) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n < 1000 ? Math.round(n * 100) / 100 : def;
};

function backlogId(hid) {
  const row = db.prepare("SELECT id FROM lists WHERE household_id = ? AND type = 'backlog'").get(hid);
  if (row) return row.id;
  return Number(db.prepare("INSERT INTO lists (household_id, type, created_at) VALUES (?, 'backlog', ?)").run(hid, now()).lastInsertRowid);
}

function ownList(hid, lid) {
  const l = db.prepare('SELECT id, household_id, type, date, status FROM lists WHERE id = ? AND household_id = ?').get(lid, hid);
  if (!l) throw httpError(404, 'Liste introuvable.');
  return l;
}
const openList = (hid, lid) => {
  const l = ownList(hid, lid);
  if (l.status === 'closed') throw httpError(409, 'Liste clôturée : lecture seule.');
  return l;
};

function ownItem(hid, iid) {
  const it = db.prepare(`SELECT i.*, l.household_id, l.status AS list_status, l.type AS list_type FROM list_items i
    JOIN lists l ON l.id = i.list_id WHERE i.id = ? AND l.household_id = ?`).get(iid, hid);
  if (!it) throw httpError(404, 'Article introuvable.');
  return it;
}

const ownProduct = (hid, pid) => {
  if (!db.prepare('SELECT 1 FROM products WHERE id = ? AND household_id = ? AND deleted_at IS NULL').get(pid, hid)) throw httpError(404, 'Produit introuvable.');
};

// Ajoute un article (non suggestion) : si le produit est deja dans la liste, les
// quantites s'additionnent. Renvoie l'id de l'article.
function addOrMerge(lid, pid, qty, { origin = 'manual', note = null, status = 'todo' } = {}) {
  const ex = db.prepare('SELECT id, qty FROM list_items WHERE list_id = ? AND product_id = ? AND suggestion IS NULL').get(lid, pid);
  if (ex) {
    db.prepare("UPDATE list_items SET qty = ?, status = CASE WHEN ? = 'todo' THEN 'todo' ELSE status END, updated_at = ? WHERE id = ?")
      .run(Math.round((ex.qty + qty) * 100) / 100, status, now(), ex.id);
    return ex.id;
  }
  return Number(db.prepare(`INSERT INTO list_items (list_id, product_id, qty, note, origin, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(lid, pid, qty, note, origin, status, now(), now()).lastInsertRowid);
}

// ---------- Lecture ----------
function summary(hid) {
  const bid = backlogId(hid);
  const rows = db.prepare(`SELECT l.id, l.type, l.date, l.status, l.closed_at,
      SUM(CASE WHEN i.id IS NOT NULL AND i.suggestion IS NULL THEN 1 ELSE 0 END) AS items,
      SUM(CASE WHEN i.suggestion = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN i.status = 'bought' AND i.suggestion IS NULL THEN 1 ELSE 0 END) AS bought
    FROM lists l LEFT JOIN list_items i ON i.list_id = l.id
    WHERE l.household_id = ? GROUP BY l.id ORDER BY l.date`).all(hid);
  // Estimation du panier (repartition actuelle) des listes en cours.
  const itemsOf = db.prepare(`SELECT i.product_id, i.qty + i.meal_qty AS qty, i.status, i.suggestion, i.store_id, i.bought_store_id, p.deleted_at IS NOT NULL AS deleted
    FROM list_items i JOIN products p ON p.id = i.product_id WHERE i.list_id = ?`);
  // Conseil de magasin (accueil) : magasins utilises, economie vs un seul magasin.
  for (const r of rows) {
    if (r.status === 'closed') continue;
    const pr = pricing.decorate(hid, { ...r, items: itemsOf.all(r.id) }).pricing;
    r.estimate = pr.split;
    r.unknown = pr.stores.reduce((n, x) => n + x.itemsUnknown, 0); // articles sans prix au magasin retenu
    r.advice = { stores: pr.stores.filter((x) => x.items).map((x) => ({ id: x.id, name: x.name, color: x.color, items: x.items })),
      saving: pr.saving, split: pr.recommendSplit, mono: pr.monoStoreId, threshold: pr.threshold };
  }
  // Tickets a saisir : listes en cours et listes cloturees depuis moins de 30 jours.
  const since = Date.now() - 30 * 24 * 3600 * 1000;
  const tickets = [];
  for (const r of rows) {
    if (r.type !== 'dated' || (r.status === 'closed' && !(r.closed_at > since)) || !r.bought) continue;
    const dec = pricing.decorate(hid, { ...r, items: itemsOf.all(r.id) });
    for (const t of ticketsDue(hid, r, dec.items)) tickets.push({ list_id: r.id, date: r.date, status: r.status, ...t });
  }
  return {
    backlog: rows.find((r) => r.id === bid),
    upcoming: rows.filter((r) => r.type === 'dated' && r.status !== 'closed'),
    closed: rows.filter((r) => r.status === 'closed').reverse(),
    tickets,
  };
}

// Tickets a saisir d'une liste : magasins ou des articles ont ete pris (magasin d'achat,
// sinon magasin retenu), passage termine (ou liste cloturee), sans ticket enregistre et
// non ecartes (« pas de ticket »). `items` : articles decores (at_store_id).
function ticketsDue(hid, l, items) {
  const counts = new Map();
  for (const it of items) {
    if (it.suggestion || it.status !== 'bought') continue;
    const sid = it.bought_store_id || it.at_store_id;
    if (sid) counts.set(sid, (counts.get(sid) || 0) + 1);
  }
  if (!counts.size) return [];
  const trips = new Map(db.prepare('SELECT store_id, finished_at, skipped FROM list_trips WHERE list_id = ?').all(l.id).map((t) => [t.store_id, t]));
  const done = new Set(db.prepare('SELECT DISTINCT store_id FROM receipts WHERE list_id = ?').all(l.id).map((r) => r.store_id));
  const names = new Map(db.prepare('SELECT id, name, color FROM stores WHERE household_id = ?').all(hid).map((s) => [s.id, s]));
  return [...counts].filter(([sid]) => {
    const t = trips.get(sid);
    return names.has(sid) && !done.has(sid) && !(t && t.skipped) && (l.status === 'closed' || (t && t.finished_at));
  }).map(([sid, n]) => ({ store_id: sid, name: names.get(sid).name, color: names.get(sid).color, items: n }));
}

// Fin du passage dans un magasin (le ticket pourra etre saisi plus tard).
function finishTrip(hid, lid, storeId) {
  openList(hid, lid);
  const sid = ownStoreId(hid, storeId);
  db.prepare(`INSERT INTO list_trips (list_id, store_id, finished_at, skipped) VALUES (?, ?, ?, 0)
    ON CONFLICT(list_id, store_id) DO UPDATE SET finished_at = excluded.finished_at, skipped = 0`).run(lid, sid, now());
}
// « Pas de ticket » : plus rien a saisir pour ce magasin.
function skipTicket(hid, lid, storeId) {
  ownList(hid, lid);
  const sid = ownStoreId(hid, storeId);
  db.prepare(`INSERT INTO list_trips (list_id, store_id, finished_at, skipped) VALUES (?, ?, ?, 1)
    ON CONFLICT(list_id, store_id) DO UPDATE SET skipped = 1`).run(lid, sid, now());
}
function ownStoreId(hid, storeId) {
  const sid = Number(storeId);
  if (!db.prepare('SELECT 1 FROM stores WHERE id = ? AND household_id = ?').get(sid, hid)) throw httpError(404, 'Magasin introuvable.');
  return sid;
}

const ITEM_COLS = `i.id, i.list_id, i.product_id, i.qty + i.meal_qty AS qty, i.qty AS manual_qty, i.meal_qty, i.note, i.origin, i.status, i.suggestion, i.carried_to,
  i.store_id, i.bought_store_id, i.meal_id, i.suggested_by, p.name, p.category_id, p.subcategory_id, p.unit, p.recurrence, p.deleted_at IS NOT NULL AS deleted, COALESCE(m.display_name, u.name) AS suggested_by_name`;

function getList(hid, lid) {
  const l = ownList(hid, lid);
  const items = db.prepare(`SELECT ${ITEM_COLS} FROM list_items i JOIN products p ON p.id = i.product_id
    LEFT JOIN users u ON u.id = i.suggested_by LEFT JOIN memberships m ON m.user_id = i.suggested_by AND m.household_id = ?
    WHERE i.list_id = ? ORDER BY p.name_norm`).all(hid, lid);
  // Destination des reports (listes cloturees) : libelle lisible.
  const labels = Object.fromEntries(db.prepare('SELECT id, type, date FROM lists WHERE household_id = ?').all(hid)
    .map((x) => [x.id, x.type === 'backlog' ? 'À prévoir' : x.date]));
  // Plats a l'origine de la part « repas » de chaque article.
  // need : quantite reelle demandee par les repas (« 600 g »), si une seule unite.
  const from = new Map(), need = new Map();
  for (const r of db.prepare(`SELECT lim.item_id, lim.amount, lim.amount_unit FROM list_item_meals lim JOIN list_items i ON i.id = lim.item_id WHERE i.list_id = ?`).all(lid)) {
    const n = need.get(r.item_id) || { units: new Set(), total: 0 };
    n.units.add(r.amount_unit || null);
    n.total += r.amount || 0;
    need.set(r.item_id, n);
  }
  for (const r of db.prepare(`SELECT lim.item_id, d.name FROM list_item_meals lim JOIN planned_meals m ON m.id = lim.meal_id JOIN dishes d ON d.id = m.dish_id
    JOIN list_items i ON i.id = lim.item_id WHERE i.list_id = ? ORDER BY m.date`).all(lid)) {
    if (!from.has(r.item_id)) from.set(r.item_id, []);
    if (!from.get(r.item_id).includes(r.name)) from.get(r.item_id).push(r.name);
  }
  const needText = (n) => (n && n.units.size === 1 && !n.units.has(null) ? fmtAmount(n.total, [...n.units][0]) : null);
  const M = l.type === 'dated' ? require('./meals').listMeals(hid, lid) : { meals: [], base: [] };
  const out = pricing.decorate(hid, {
    ...l, meals: M.meals, base: M.base,
    items: items.map((i) => ({ ...i, from: from.get(i.id) || [], need: needText(need.get(i.id)), carried_label: i.carried_to ? labels[i.carried_to] || null : null })),
    next: l.type === 'dated' ? nextList(hid, l) : null,
  });
  out.tickets = l.type === 'dated' ? ticketsDue(hid, l, out.items) : [];
  return out;
}

// Liste datee suivante non cloturee (destination par defaut des reports).
function nextList(hid, l) {
  const n = db.prepare("SELECT id, date FROM lists WHERE household_id = ? AND type = 'dated' AND status <> 'closed' AND date > ? ORDER BY date LIMIT 1").get(hid, l.date);
  return n || null;
}

// ---------- Creation d'une liste datee ----------
function proposedDate(hid) {
  const h = db.prepare('SELECT rhythm_days FROM households WHERE id = ?').get(hid);
  const last = db.prepare("SELECT MAX(date) AS d FROM lists WHERE household_id = ? AND type = 'dated'").get(hid).d;
  const d = last ? addDays(last, h.rhythm_days) : today();
  return d < today() ? today() : d;
}

// Produits recurrents dus pour une liste a la date `date` : « toutes les n listes » =
// absent des n - 1 listes datees precedentes (n = 1 : toujours).
function recurringDue(hid, date) {
  const prods = db.prepare('SELECT id, name, recurrence FROM products WHERE household_id = ? AND recurrence IS NOT NULL AND deleted_at IS NULL ORDER BY name_norm').all(hid);
  const before = db.prepare("SELECT id FROM lists WHERE household_id = ? AND type = 'dated' AND date < ? ORDER BY date DESC").all(hid, date).map((r) => r.id);
  const has = db.prepare('SELECT 1 FROM list_items WHERE list_id = ? AND product_id = ? AND suggestion IS NULL');
  return prods.filter((p) => before.slice(0, p.recurrence - 1).every((lid) => !has.get(lid, p.id)));
}

function preview(hid, date) {
  const d = isoDate(date) || proposedDate(hid);
  const bid = backlogId(hid);
  return {
    date: d,
    recurring: recurringDue(hid, d),
    backlog: db.prepare(`SELECT i.id, i.qty, i.note, p.name, p.unit FROM list_items i JOIN products p ON p.id = i.product_id
      WHERE i.list_id = ? AND i.suggestion IS NULL ORDER BY p.name_norm`).all(bid),
  };
}

const dateTaken = (hid, date, exceptId = 0) =>
  !!db.prepare("SELECT 1 FROM lists WHERE household_id = ? AND type = 'dated' AND date = ? AND id <> ?").get(hid, date, exceptId);

// b = { date, recurring: bool, backlogItemIds: [...] }
function createList(hid, userId, b) {
  const date = isoDate(b.date);
  if (!date) throw httpError(400, 'Date invalide.');
  if (dateTaken(hid, date)) throw httpError(409, 'Une liste existe déjà à cette date.');
  return tx(() => {
    const lid = Number(db.prepare("INSERT INTO lists (household_id, type, date, created_by, created_at) VALUES (?, 'dated', ?, ?, ?)").run(hid, date, userId, now()).lastInsertRowid);
    if (b.recurring !== false) for (const p of recurringDue(hid, date)) addOrMerge(lid, p.id, 1, { origin: 'recurring' });
    const bid = backlogId(hid);
    for (const iid of Array.isArray(b.backlogItemIds) ? b.backlogItemIds : []) {
      const it = db.prepare('SELECT id, product_id, qty, note FROM list_items WHERE id = ? AND list_id = ? AND suggestion IS NULL').get(Number(iid), bid);
      if (!it) continue;
      addOrMerge(lid, it.product_id, it.qty, { note: it.note });
      db.prepare('DELETE FROM list_items WHERE id = ?').run(it.id);
    }
    syncMeals(hid);
    return lid;
  });
}

function updateList(hid, lid, b) {
  const l = openList(hid, lid);
  if (l.type !== 'dated') throw httpError(400, 'La liste « À prévoir » n\'a pas de date.');
  if (b.date != null) {
    const date = isoDate(b.date);
    if (!date) throw httpError(400, 'Date invalide.');
    if (dateTaken(hid, date, lid)) throw httpError(409, 'Une liste existe déjà à cette date.');
    tx(() => { db.prepare('UPDATE lists SET date = ? WHERE id = ?').run(date, lid); syncMeals(hid); });
  }
  if (b.status != null) {
    if (!['prep', 'shopping'].includes(b.status)) throw httpError(400, 'Statut inconnu (clôturer : action dédiée).');
    db.prepare('UPDATE lists SET status = ? WHERE id = ?').run(b.status, lid);
  }
}

// Suppression : impossible si un article est coche ; les articles ajoutes a la main (ou
// reportes) repartent dans « A prevoir », les recurrents et suggestions sont abandonnes.
function deleteList(hid, lid) {
  // Liste en cours (meme avec des articles coches) ou cloturee : les articles ajoutes a la
  // main et non achetes d'une liste en cours repartent dans « À prévoir » ; les relevés de
  // prix restent.
  const l = ownList(hid, lid);
  if (l.type !== 'dated') throw httpError(400, 'La liste « À prévoir » ne se supprime pas.');
  tx(() => {
    const bid = backlogId(hid);
    if (l.status !== 'closed') {
      for (const it of db.prepare("SELECT product_id, qty, note FROM list_items WHERE list_id = ? AND suggestion IS NULL AND origin IN ('manual','carried') AND status <> 'bought' AND qty > 0").all(lid)) {
        addOrMerge(bid, it.product_id, it.qty, { note: it.note });
      }
    }
    db.prepare('UPDATE planned_meals SET list_id = NULL WHERE list_id = ?').run(lid);
    db.prepare('DELETE FROM lists WHERE id = ?').run(lid);
    syncMeals(hid);
  });
}

// ---------- Cloture ----------
// fates = { <id article>: 'next' | 'backlog' | 'drop' } pour les articles non achetes
// (defaut : liste suivante, ou « A prevoir » s'il n'y en a pas). Suggestions en attente
// abandonnees.
function closeList(hid, lid, fates = {}) {
  const l = openList(hid, lid);
  if (l.type !== 'dated') throw httpError(400, 'La liste « À prévoir » ne se clôture pas.');
  return tx(() => {
    const next = nextList(hid, l);
    const bid = backlogId(hid);
    db.prepare("DELETE FROM list_items WHERE list_id = ? AND suggestion = 'pending'").run(lid);
    const left = db.prepare("SELECT id, product_id, qty + meal_qty AS qty, note FROM list_items WHERE list_id = ? AND status <> 'bought' AND qty + meal_qty > 0").all(lid);
    for (const it of left) {
      let fate = fates[it.id] || 'next';
      if (fate === 'next' && !next) fate = 'backlog';
      const to = fate === 'next' ? next.id : fate === 'backlog' ? bid : null;
      if (to) addOrMerge(to, it.product_id, it.qty, { origin: 'carried', note: it.note });
      db.prepare('UPDATE list_items SET carried_to = ?, updated_at = ? WHERE id = ?').run(to, now(), it.id);
    }
    db.prepare("UPDATE lists SET status = 'closed', closed_at = ? WHERE id = ?").run(now(), lid);
    return { carried: left.length, next: next ? next.id : null };
  });
}

// Copie des articles achetes d'une liste cloturee dans « A prevoir ».
function copyToBacklog(hid, lid) {
  ownList(hid, lid);
  const bid = backlogId(hid);
  const items = db.prepare("SELECT product_id, qty + meal_qty AS qty FROM list_items WHERE list_id = ? AND status = 'bought' AND suggestion IS NULL AND qty + meal_qty > 0").all(lid);
  tx(() => items.forEach((it) => addOrMerge(bid, it.product_id, it.qty)));
  return items.length;
}

// ---------- Articles ----------
// Gestionnaire : ajout direct (quantites additionnees si deja present). Membre :
// suggestion en attente de validation.
function addItem(hid, lid, user, role, b) {
  openList(hid, lid);
  const pid = Number(b.product_id);
  ownProduct(hid, pid);
  const qty = qtyOf(b.qty);
  const note = b.note ? String(b.note).trim().slice(0, 120) : null;
  if (role === 'manager') return addOrMerge(lid, pid, qty, { note });
  return Number(db.prepare(`INSERT INTO list_items (list_id, product_id, qty, note, origin, suggestion, suggested_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'suggestion', 'pending', ?, ?, ?)`).run(lid, pid, qty, note, user.id, now(), now()).lastInsertRowid);
}

// Quantite, note, statut : tout membre (sauf sur une suggestion en attente, reservee a
// son auteur ou au gestionnaire).
function updateItem(hid, iid, user, role, b) {
  const it = ownItem(hid, iid);
  if (it.list_status === 'closed') throw httpError(409, 'Liste clôturée : lecture seule.');
  if (it.suggestion && role !== 'manager' && it.suggested_by !== user.id) throw httpError(403, 'Suggestion en attente de validation.');
  const qty = b.qty != null ? Math.max(0, Math.round((qtyOf(b.qty, it.qty + it.meal_qty) - it.meal_qty) * 100) / 100) : it.qty;
  const note = b.note !== undefined ? (String(b.note || '').trim().slice(0, 120) || null) : it.note;
  let status = it.status;
  if (b.status != null) {
    if (!['todo', 'bought', 'unavailable'].includes(b.status)) throw httpError(400, 'Statut inconnu.');
    if (it.suggestion) throw httpError(409, 'Suggestion en attente de validation.');
    if (it.list_type === 'backlog' && b.status !== 'todo') throw httpError(400, 'Les articles « À prévoir » ne se cochent pas.');
    status = b.status;
  }
  // Magasin : tout membre (choix libre en magasin) ; null = revenir au conseil.
  let store = it.store_id;
  if (b.store_id !== undefined) {
    store = b.store_id ? Number(b.store_id) : null;
    if (store && !db.prepare('SELECT 1 FROM stores WHERE id = ? AND household_id = ? AND active = 1').get(store, hid)) throw httpError(404, 'Magasin introuvable.');
  }
  // Magasin d'achat : celui ou l'article a ete pris (peut differer du conseil) ; efface si l'article n'est plus coche.
  let boughtAt = status === 'bought' ? it.bought_store_id : null;
  if (status === 'bought' && b.bought_store_id) {
    const bs = Number(b.bought_store_id);
    if (!db.prepare('SELECT 1 FROM stores WHERE id = ? AND household_id = ?').get(bs, hid)) throw httpError(404, 'Magasin introuvable.');
    boughtAt = bs;
  }
  db.prepare('UPDATE list_items SET qty = ?, note = ?, status = ?, store_id = ?, bought_store_id = ?, updated_at = ? WHERE id = ?').run(qty, note, status, store, boughtAt, now(), iid);
}

// Tous les articles d'une liste chez un magasin (store_id) ou retour au conseil (null).
function assignAll(hid, lid, storeId) {
  openList(hid, lid);
  const store = storeId ? Number(storeId) : null;
  if (store && !db.prepare('SELECT 1 FROM stores WHERE id = ? AND household_id = ? AND active = 1').get(store, hid)) throw httpError(404, 'Magasin introuvable.');
  db.prepare('UPDATE list_items SET store_id = ?, updated_at = ? WHERE list_id = ?').run(store, now(), lid);
}

// ---------- Promos ----------
// Une promo par produit et magasin : une nouvelle remplace l'ancienne.
// b = { product_id, store_id, price, list_id | valid_until, note }
function savePromo(hid, userId, b) {
  const pid = Number(b.product_id), sid = Number(b.store_id);
  ownProduct(hid, pid);
  if (!db.prepare('SELECT 1 FROM stores WHERE id = ? AND household_id = ?').get(sid, hid)) throw httpError(404, 'Magasin introuvable.');
  const price = b.price === '' || b.price == null ? null : cents(b.price);
  if (price === 0 || (b.price !== '' && b.price != null && price == null)) throw httpError(400, 'Prix invalide.');
  let listId = null, until = null;
  if (b.list_id) { listId = openList(hid, Number(b.list_id)).id; } else {
    until = isoDate(b.valid_until);
    if (!until) throw httpError(400, 'Choisir une liste ou une date de fin.');
  }
  const note = b.note ? String(b.note).trim().slice(0, 120) : null;
  return tx(() => {
    db.prepare('DELETE FROM promos WHERE household_id = ? AND product_id = ? AND store_id = ?').run(hid, pid, sid);
    return Number(db.prepare(`INSERT INTO promos (household_id, product_id, store_id, price_cents, list_id, valid_until, note, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(hid, pid, sid, price, listId, until, note, userId, now()).lastInsertRowid);
  });
}

function deletePromo(hid, id) {
  const r = db.prepare('DELETE FROM promos WHERE id = ? AND household_id = ?').run(id, hid);
  if (!r.changes) throw httpError(404, 'Promo introuvable.');
}

function moveItem(hid, iid, toLid) {
  const it = ownItem(hid, iid);
  if (it.list_status === 'closed') throw httpError(409, 'Liste clôturée : lecture seule.');
  if (it.suggestion) throw httpError(409, 'Valider la suggestion avant de la déplacer.');
  openList(hid, toLid);
  if (Number(toLid) === it.list_id) return;
  if (!(it.qty > 0)) throw httpError(409, 'Article venant des repas : déplacer le repas vers une autre liste.');
  tx(() => {
    addOrMerge(Number(toLid), it.product_id, it.qty, { note: it.note, origin: it.origin === 'recurring' ? 'recurring' : 'manual' });
    if (it.meal_qty > 0) db.prepare('UPDATE list_items SET qty = 0 WHERE id = ?').run(iid);
    else db.prepare('DELETE FROM list_items WHERE id = ?').run(iid);
  });
}

// Retrait : gestionnaire, ou membre retirant sa propre suggestion.
function deleteItem(hid, iid, user, role) {
  const it = ownItem(hid, iid);
  if (it.list_status === 'closed') throw httpError(409, 'Liste clôturée : lecture seule.');
  if (role !== 'manager' && !(it.suggestion && it.suggested_by === user.id)) throw httpError(403, 'Réservé aux gestionnaires du foyer.');
  tx(() => {
    // Part venant des repas : retiree des repas concernes (« en reserve »), sinon elle reviendrait.
    for (const r of db.prepare('SELECT meal_id FROM list_item_meals WHERE item_id = ?').all(iid)) {
      db.prepare('INSERT OR IGNORE INTO planned_meal_skips (meal_id, product_id) VALUES (?, ?)').run(r.meal_id, it.product_id);
    }
    db.prepare('DELETE FROM list_items WHERE id = ?').run(iid);
  });
}

// ---------- Suggestions ----------
function pendingSuggestions(hid) {
  return db.prepare(`SELECT i.id, i.list_id, i.qty, i.note, p.name, p.unit, l.type AS list_type, l.date AS list_date,
      COALESCE(m.display_name, u.name) AS suggested_by_name
    FROM list_items i JOIN lists l ON l.id = i.list_id JOIN products p ON p.id = i.product_id
    LEFT JOIN users u ON u.id = i.suggested_by LEFT JOIN memberships m ON m.user_id = i.suggested_by AND m.household_id = l.household_id
    WHERE l.household_id = ? AND i.suggestion = 'pending' AND l.status <> 'closed' ORDER BY i.created_at`).all(hid);
}
const pendingCount = (hid) => db.prepare(`SELECT COUNT(*) AS n FROM list_items i JOIN lists l ON l.id = i.list_id
  WHERE l.household_id = ? AND i.suggestion = 'pending' AND l.status <> 'closed'`).get(hid).n;

// Acceptee : rejoint la liste (quantite ajoutee a l'article existant s'il y en a un).
function acceptSuggestion(hid, iid) {
  const it = ownItem(hid, iid);
  if (it.suggestion !== 'pending') throw httpError(409, 'Pas de suggestion en attente.');
  if (it.list_status === 'closed') throw httpError(409, 'Liste clôturée : lecture seule.');
  tx(() => {
    const ex = db.prepare('SELECT id, qty FROM list_items WHERE list_id = ? AND product_id = ? AND suggestion IS NULL').get(it.list_id, it.product_id);
    if (ex) {
      db.prepare('UPDATE list_items SET qty = ?, updated_at = ? WHERE id = ?').run(Math.round((ex.qty + it.qty) * 100) / 100, now(), ex.id);
      db.prepare('DELETE FROM list_items WHERE id = ?').run(iid);
    } else {
      db.prepare('UPDATE list_items SET suggestion = NULL, updated_at = ? WHERE id = ?').run(now(), iid);
    }
  });
}

function refuseSuggestion(hid, iid) {
  const it = ownItem(hid, iid);
  if (it.suggestion !== 'pending') throw httpError(409, 'Pas de suggestion en attente.');
  db.prepare('DELETE FROM list_items WHERE id = ?').run(iid);
}

// Fusion de produits (catalogue) : les articles du doublon passent au produit garde ;
// deux articles du meme produit dans une liste sont reunis.
function mergeProductItems(from, into) {
  for (const it of db.prepare('SELECT id, list_id, qty FROM list_items WHERE product_id = ? AND suggestion IS NULL').all(from)) {
    const ex = db.prepare('SELECT id, qty FROM list_items WHERE list_id = ? AND product_id = ? AND suggestion IS NULL').get(it.list_id, into);
    if (ex) {
      db.prepare('UPDATE list_items SET qty = ? WHERE id = ?').run(Math.round((ex.qty + it.qty) * 100) / 100, ex.id);
      db.prepare('DELETE FROM list_items WHERE id = ?').run(it.id);
    }
  }
  db.prepare('UPDATE list_items SET product_id = ? WHERE product_id = ?').run(into, from);
}

// Liste d'un article (pour renvoyer la liste a jour apres une action).
const itemList = (hid, iid) => ownItem(hid, iid).list_id;

// « Peut-etre a racheter » : produits achetes a intervalle regulier (au moins 3 achats sur 12 mois,
// dates de listes distinctes) dont le delai habituel (mediane des intervalles) est atteint et qui ne
// sont ni dans une liste ouverte ni dans « A prevoir ».
function habits(hid) {
  const since = addDays(today(), -365);
  const rows = db.prepare(`SELECT i.product_id, p.name, l.date FROM list_items i JOIN lists l ON l.id = i.list_id JOIN products p ON p.id = i.product_id
    WHERE l.household_id = ? AND l.type = 'dated' AND i.status = 'bought' AND i.suggestion IS NULL AND p.deleted_at IS NULL AND p.is_base = 0 AND l.date >= ?
    GROUP BY i.product_id, l.date ORDER BY i.product_id, l.date`).all(hid, since);
  const open = new Set(db.prepare(`SELECT DISTINCT i.product_id FROM list_items i JOIN lists l ON l.id = i.list_id
    WHERE l.household_id = ? AND l.status != 'closed' AND i.status != 'bought' AND i.suggestion IS NULL`).all(hid).map((r) => r.product_id));
  const by = new Map();
  for (const r of rows) { if (!by.has(r.product_id)) by.set(r.product_id, { name: r.name, dates: [] }); by.get(r.product_id).dates.push(r.date); }
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const out = [];
  for (const [pid, { name, dates }] of by) {
    if (dates.length < 3 || open.has(pid)) continue;
    const gaps = dates.slice(1).map((d, k) => days(dates[k], d)).sort((a, b) => a - b);
    const every = gaps[Math.floor(gaps.length / 2)];
    const since_last = days(dates[dates.length - 1], today());
    if (every < 3 || every > 60 || since_last < every * 0.9 || since_last > every * 3) continue;
    out.push({ product_id: pid, name, every_days: every, last_date: dates[dates.length - 1], ratio: since_last / every });
  }
  return out.sort((a, b) => b.ratio - a.ratio).slice(0, 8).map(({ ratio, ...x }) => x);
}

// Parcours appris : ordre des rayons d'apres l'ordre de cochage d'un passage dans un magasin.
// Les rayons vus reprennent, entre eux, les places qu'ils occupent deja dans le parcours du magasin.
// Rien a proposer si moins de 6 articles ou 3 rayons, ou si l'ordre est deja le bon.
function routeProposal(hid, sid, lid) {
  ownList(hid, lid);
  if (!db.prepare('SELECT 1 FROM stores WHERE id = ? AND household_id = ?').get(sid, hid)) throw httpError(404, 'Magasin introuvable.');
  const rows = db.prepare(`SELECT p.category_id AS cat FROM list_items i JOIN products p ON p.id = i.product_id
    WHERE i.list_id = ? AND i.status = 'bought' AND i.suggestion IS NULL AND COALESCE(i.bought_store_id, i.store_id) = ? ORDER BY i.updated_at, i.id`).all(lid, sid);
  const current = db.prepare('SELECT category_id FROM store_category_order WHERE store_id = ? ORDER BY position').all(sid).map((r) => r.category_id);
  const seen = new Map();
  rows.forEach((r, k) => { if (current.includes(r.cat)) { const a = seen.get(r.cat) || { n: 0, sum: 0 }; a.n++; a.sum += k; seen.set(r.cat, a); } });
  if (rows.length < 6 || seen.size < 3) return { items: rows.length, changed: false, order: current };
  const sorted = [...seen.keys()].sort((a, b) => seen.get(a).sum / seen.get(a).n - seen.get(b).sum / seen.get(b).n);
  let k = 0;
  const order = current.map((c) => (seen.has(c) ? sorted[k++] : c));
  return { items: rows.length, changed: order.some((c, i) => c !== current[i]), order, current };
}

// Magasin en parcours automatique : applique la proposition a la fin du passage.
function autoRoute(hid, lid, sid) {
  if (!db.prepare('SELECT 1 FROM stores WHERE id = ? AND household_id = ? AND auto_route = 1').get(sid, hid)) return;
  const r = routeProposal(hid, sid, lid);
  if (r.changed) require('./catalog').setCategoryOrder(hid, sid, r.order);
}

module.exports = {
  autoRoute, routeProposal, habits, itemList, assignAll, savePromo, deletePromo, finishTrip, skipTicket,
  backlogId, summary, getList, preview, createList, updateList, deleteList, closeList, copyToBacklog,
  addItem, updateItem, moveItem, deleteItem, pendingSuggestions, pendingCount, acceptSuggestion, refuseSuggestion,
  mergeProductItems, recurringDue,
};
