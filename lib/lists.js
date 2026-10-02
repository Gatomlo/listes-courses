// Listes de courses d'un foyer : « A prevoir » (permanente, creee a la demande) et
// listes datees (une par date). Articles, suggestions des membres, cloture avec report,
// articles recurrents.
const { db, tx } = require('./db');
const { httpError, isoDate, today } = require('./util');

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
  if (!db.prepare('SELECT 1 FROM products WHERE id = ? AND household_id = ?').get(pid, hid)) throw httpError(404, 'Produit introuvable.');
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
  return {
    backlog: rows.find((r) => r.id === bid),
    upcoming: rows.filter((r) => r.type === 'dated' && r.status !== 'closed'),
    closed: rows.filter((r) => r.status === 'closed').reverse(),
  };
}

const ITEM_COLS = `i.id, i.list_id, i.product_id, i.qty, i.note, i.origin, i.status, i.suggestion, i.carried_to,
  i.store_id, i.meal_id, i.suggested_by, p.name, p.category_id, p.unit, p.recurrence, COALESCE(m.display_name, u.name) AS suggested_by_name`;

function getList(hid, lid) {
  const l = ownList(hid, lid);
  const items = db.prepare(`SELECT ${ITEM_COLS} FROM list_items i JOIN products p ON p.id = i.product_id
    LEFT JOIN users u ON u.id = i.suggested_by LEFT JOIN memberships m ON m.user_id = i.suggested_by AND m.household_id = ?
    WHERE i.list_id = ? ORDER BY p.name_norm`).all(hid, lid);
  // Destination des reports (listes cloturees) : libelle lisible.
  const labels = Object.fromEntries(db.prepare('SELECT id, type, date FROM lists WHERE household_id = ?').all(hid)
    .map((x) => [x.id, x.type === 'backlog' ? 'À prévoir' : x.date]));
  return {
    ...l,
    items: items.map((i) => ({ ...i, carried_label: i.carried_to ? labels[i.carried_to] || null : null })),
    next: l.type === 'dated' ? nextList(hid, l) : null,
  };
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
  const prods = db.prepare('SELECT id, name, recurrence FROM products WHERE household_id = ? AND recurrence IS NOT NULL ORDER BY name_norm').all(hid);
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
    db.prepare('UPDATE lists SET date = ? WHERE id = ?').run(date, lid);
  }
  if (b.status != null) {
    if (!['prep', 'shopping'].includes(b.status)) throw httpError(400, 'Statut inconnu (clôturer : action dédiée).');
    db.prepare('UPDATE lists SET status = ? WHERE id = ?').run(b.status, lid);
  }
}

// Suppression : impossible si un article est coche ; les articles ajoutes a la main (ou
// reportes) repartent dans « A prevoir », les recurrents et suggestions sont abandonnes.
function deleteList(hid, lid) {
  const l = openList(hid, lid);
  if (l.type !== 'dated') throw httpError(400, 'La liste « À prévoir » ne se supprime pas.');
  if (db.prepare("SELECT 1 FROM list_items WHERE list_id = ? AND status = 'bought'").get(lid)) throw httpError(409, 'Des articles sont déjà cochés : clôturer la liste plutôt.');
  tx(() => {
    const bid = backlogId(hid);
    for (const it of db.prepare("SELECT product_id, qty, note FROM list_items WHERE list_id = ? AND suggestion IS NULL AND origin IN ('manual','carried')").all(lid)) {
      addOrMerge(bid, it.product_id, it.qty, { note: it.note });
    }
    db.prepare('DELETE FROM lists WHERE id = ?').run(lid);
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
    const left = db.prepare("SELECT id, product_id, qty, note FROM list_items WHERE list_id = ? AND status <> 'bought'").all(lid);
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
  const items = db.prepare("SELECT product_id, qty FROM list_items WHERE list_id = ? AND status = 'bought' AND suggestion IS NULL").all(lid);
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
  const qty = b.qty != null ? qtyOf(b.qty, it.qty) : it.qty;
  const note = b.note !== undefined ? (String(b.note || '').trim().slice(0, 120) || null) : it.note;
  let status = it.status;
  if (b.status != null) {
    if (!['todo', 'bought', 'unavailable'].includes(b.status)) throw httpError(400, 'Statut inconnu.');
    if (it.suggestion) throw httpError(409, 'Suggestion en attente de validation.');
    if (it.list_type === 'backlog' && b.status !== 'todo') throw httpError(400, 'Les articles « À prévoir » ne se cochent pas.');
    status = b.status;
  }
  db.prepare('UPDATE list_items SET qty = ?, note = ?, status = ?, updated_at = ? WHERE id = ?').run(qty, note, status, now(), iid);
}

function moveItem(hid, iid, toLid) {
  const it = ownItem(hid, iid);
  if (it.list_status === 'closed') throw httpError(409, 'Liste clôturée : lecture seule.');
  if (it.suggestion) throw httpError(409, 'Valider la suggestion avant de la déplacer.');
  openList(hid, toLid);
  if (Number(toLid) === it.list_id) return;
  tx(() => {
    addOrMerge(Number(toLid), it.product_id, it.qty, { note: it.note, origin: it.origin === 'recurring' ? 'recurring' : 'manual' });
    db.prepare('DELETE FROM list_items WHERE id = ?').run(iid);
  });
}

// Retrait : gestionnaire, ou membre retirant sa propre suggestion.
function deleteItem(hid, iid, user, role) {
  const it = ownItem(hid, iid);
  if (it.list_status === 'closed') throw httpError(409, 'Liste clôturée : lecture seule.');
  if (role !== 'manager' && !(it.suggestion && it.suggested_by === user.id)) throw httpError(403, 'Réservé aux gestionnaires du foyer.');
  db.prepare('DELETE FROM list_items WHERE id = ?').run(iid);
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

module.exports = {
  itemList,
  backlogId, summary, getList, preview, createList, updateList, deleteList, closeList, copyToBacklog,
  addItem, updateItem, moveItem, deleteItem, pendingSuggestions, pendingCount, acceptSuggestion, refuseSuggestion,
  mergeProductItems, recurringDue,
};
