// Plats (recettes facultatives), repas planifies (menu) et ingredients des repas dans
// les listes.
//
// Rattachement d'un repas a une liste : la liste choisie (list_id) si elle est datee,
// sinon la liste datee dont la periode contient la date du repas (de sa date a la veille
// de la liste suivante ; la derniere couvre `rythme` jours). Seules les listes non
// cloturees sont recalculees.
const crypto = require('crypto');
const { db, tx, normalize } = require('./db');
const { httpError, str, isoDate } = require('./util');

const SLOTS = ['pdj', 'midi', 'soir', 'coll'];
const now = () => Date.now();
const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);

// ---------- Plats ----------
function ownDish(hid, did) {
  const d = db.prepare('SELECT * FROM dishes WHERE id = ? AND household_id = ? AND deleted_at IS NULL').get(did, hid);
  if (!d) throw httpError(404, 'Plat introuvable.');
  return d;
}

function ingredientsOf(did) {
  return db.prepare(`SELECT di.id, di.product_id, di.qty, di.note, p.name, p.unit, p.is_base, p.category_id FROM dish_ingredients di
    JOIN products p ON p.id = di.product_id WHERE di.dish_id = ? AND p.deleted_at IS NULL ORDER BY di.position, di.id`).all(did)
    .map((i) => ({ ...i, is_base: !!i.is_base }));
}

function mealsOfDish(did) {
  return db.prepare(`SELECT id, date, slot, persons FROM planned_meals WHERE dish_id = ? AND suggestion IS NULL ORDER BY date DESC, slot`).all(did);
}

function dishes(hid) {
  const rows = db.prepare(`SELECT d.id, d.name, d.portions, d.time_text, d.url, d.steps, d.notes,
      (SELECT COUNT(*) FROM dish_ingredients di JOIN products p ON p.id = di.product_id WHERE di.dish_id = d.id AND p.deleted_at IS NULL) AS ingredients,
      (SELECT MIN(date) FROM planned_meals m WHERE m.dish_id = d.id AND m.suggestion IS NULL AND m.date >= ?) AS next_date,
      (SELECT MAX(date) FROM planned_meals m WHERE m.dish_id = d.id AND m.suggestion IS NULL AND m.date < ?) AS last_date,
      (SELECT COUNT(*) FROM planned_meals m WHERE m.dish_id = d.id AND m.suggestion IS NULL AND m.date < ?) AS times
    FROM dishes d WHERE d.household_id = ? AND d.deleted_at IS NULL ORDER BY d.name_norm`).all(today(), today(), today(), hid);
  // Noms des ingredients (recherche par ingredient).
  const ing = db.prepare(`SELECT di.dish_id, p.name FROM dish_ingredients di JOIN dishes d ON d.id = di.dish_id JOIN products p ON p.id = di.product_id
    WHERE d.household_id = ? AND p.deleted_at IS NULL`).all(hid);
  return rows.map((d) => ({
    ...d, has_recipe: !!(d.url || d.steps || d.notes), ingredient_names: ing.filter((i) => i.dish_id === d.id).map((i) => i.name),
  }));
}

function dish(hid, did) {
  const d = ownDish(hid, did);
  const meals = mealsOfDish(did);
  return {
    id: d.id, name: d.name, portions: d.portions, time_text: d.time_text, url: d.url, steps: d.steps, notes: d.notes,
    ingredients: ingredientsOf(did),
    upcoming: meals.filter((m) => m.date >= today()).reverse(),
    past: meals.filter((m) => m.date < today()).slice(0, 5),
    times: meals.filter((m) => m.date < today()).length,
    first_date: meals.length ? meals[meals.length - 1].date : null,
  };
}

// b = { name, portions, time_text, url, steps, notes, ingredients: [{ product_id, qty, note }] }
function saveDish(hid, did, b) {
  const name = str(b.name, 80);
  if (!name) throw httpError(400, 'Nom du plat requis.');
  const dup = db.prepare('SELECT id FROM dishes WHERE household_id = ? AND name_norm = ? AND id <> ? AND deleted_at IS NULL').get(hid, normalize(name), did || 0);
  if (dup) throw httpError(409, 'Un plat porte déjà ce nom.');
  const portions = Math.min(50, Math.max(1, parseInt(b.portions, 10) || 4));
  let url = str(b.url, 500) || null;
  if (url && !/^https?:\/\//i.test(url)) throw httpError(400, 'Lien invalide (http ou https).');
  const ings = Array.isArray(b.ingredients) ? b.ingredients.slice(0, 80) : [];
  for (const i of ings) {
    if (!db.prepare('SELECT 1 FROM products WHERE id = ? AND household_id = ? AND deleted_at IS NULL').get(Number(i.product_id), hid)) throw httpError(404, 'Ingrédient introuvable dans le catalogue.');
  }
  return tx(() => {
    const vals = [name, normalize(name), portions, str(b.time_text, 40) || null, url, str(b.steps, 8000) || null, str(b.notes, 2000) || null];
    let id = did;
    if (did) {
      ownDish(hid, did);
      db.prepare('UPDATE dishes SET name = ?, name_norm = ?, portions = ?, time_text = ?, url = ?, steps = ?, notes = ? WHERE id = ?').run(...vals, did);
      db.prepare('DELETE FROM dish_ingredients WHERE dish_id = ?').run(did);
    } else {
      id = Number(db.prepare('INSERT INTO dishes (household_id, name, name_norm, portions, time_text, url, steps, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(hid, ...vals, now()).lastInsertRowid);
    }
    ings.forEach((i, pos) => {
      const q = i.qty === '' || i.qty == null ? null : Number(String(i.qty).replace(',', '.'));
      db.prepare('INSERT INTO dish_ingredients (dish_id, product_id, qty, note, position) VALUES (?, ?, ?, ?, ?)')
        .run(id, Number(i.product_id), q > 0 ? q : null, str(i.note, 60) || null, pos);
    });
    syncMealItems(hid);
    return id;
  });
}

// Suppression : les repas a venir sont retires du menu ; le plat reste (masque) pour
// l'historique des menus passes.
function deleteDish(hid, did) {
  ownDish(hid, did);
  tx(() => {
    db.prepare('DELETE FROM planned_meals WHERE dish_id = ? AND date >= ?').run(did, today());
    db.prepare('UPDATE dishes SET deleted_at = ? WHERE id = ?').run(now(), did);
    syncMealItems(hid);
  });
}

// ---------- Repas ----------
function ownMeal(hid, mid) {
  const m = db.prepare('SELECT * FROM planned_meals WHERE id = ? AND household_id = ?').get(mid, hid);
  if (!m) throw httpError(404, 'Repas introuvable.');
  return m;
}

function mealRows(hid, from, to) {
  return db.prepare(`SELECT m.id, m.date, m.slot, m.persons, m.list_id, m.suggestion, m.suggested_by, m.dish_id,
      d.name AS dish, d.deleted_at IS NOT NULL AS dish_deleted, (d.url IS NOT NULL OR d.steps IS NOT NULL OR d.notes IS NOT NULL) AS has_recipe,
      (SELECT COUNT(*) FROM dish_ingredients di WHERE di.dish_id = d.id) AS ingredients,
      COALESCE(ms.display_name, u.name) AS suggested_by_name
    FROM planned_meals m JOIN dishes d ON d.id = m.dish_id
    LEFT JOIN users u ON u.id = m.suggested_by LEFT JOIN memberships ms ON ms.user_id = m.suggested_by AND ms.household_id = m.household_id
    WHERE m.household_id = ? AND m.date >= ? AND m.date <= ? ORDER BY m.date, CASE m.slot WHEN 'pdj' THEN 0 WHEN 'midi' THEN 1 WHEN 'soir' THEN 2 ELSE 3 END`).all(hid, from, to)
    .map((m) => ({ ...m, has_recipe: !!m.has_recipe, dish_deleted: !!m.dish_deleted, skip: skipsOf(m.id) }));
}
const skipsOf = (mid) => db.prepare('SELECT product_id FROM planned_meal_skips WHERE meal_id = ?').all(mid).map((r) => r.product_id);

function menu(hid, from, days) {
  const f = isoDate(from) || today();
  const n = Math.min(62, Math.max(1, parseInt(days, 10) || 14));
  const to = addDays(f, n - 1);
  return {
    from: f, to, meals: mealRows(hid, f, to),
    lists: db.prepare("SELECT id, date, status FROM lists WHERE household_id = ? AND type = 'dated' AND date >= ? AND date <= ? ORDER BY date").all(hid, addDays(f, -60), addDays(to, 60)),
  };
}

// b = { date, slot, dish_id, persons, skip: [product_id], list_id, replace }
// Gestionnaire : ajoute (remplace le repas du creneau) ; membre : suggestion.
function createMeal(hid, user, role, b) {
  const date = isoDate(b.date);
  if (!date) throw httpError(400, 'Date invalide.');
  if (!SLOTS.includes(b.slot)) throw httpError(400, 'Créneau inconnu.');
  const d = ownDish(hid, Number(b.dish_id));
  const persons = Math.min(50, Math.max(1, parseInt(b.persons, 10) || 4));
  return tx(() => {
    if (role === 'manager') db.prepare('DELETE FROM planned_meals WHERE household_id = ? AND date = ? AND slot = ? AND suggestion IS NULL').run(hid, date, b.slot);
    const mid = Number(db.prepare(`INSERT INTO planned_meals (household_id, date, slot, dish_id, persons, list_id, suggestion, suggested_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(hid, date, b.slot, d.id, persons, listOrNull(hid, b.list_id),
      role === 'manager' ? null : 'pending', role === 'manager' ? null : user.id, now()).lastInsertRowid);
    setSkips(hid, mid, b.skip);
    syncMealItems(hid);
    return mid;
  });
}

function listOrNull(hid, lid) {
  if (!lid) return null;
  const l = db.prepare("SELECT id FROM lists WHERE id = ? AND household_id = ? AND type = 'dated' AND status <> 'closed'").get(Number(lid), hid);
  if (!l) throw httpError(404, 'Liste introuvable.');
  return l.id;
}

function setSkips(hid, mid, skip) {
  if (!Array.isArray(skip)) return;
  db.prepare('DELETE FROM planned_meal_skips WHERE meal_id = ?').run(mid);
  for (const pid of skip) {
    if (db.prepare('SELECT 1 FROM products WHERE id = ? AND household_id = ?').get(Number(pid), hid)) {
      db.prepare('INSERT OR IGNORE INTO planned_meal_skips (meal_id, product_id) VALUES (?, ?)').run(mid, Number(pid));
    }
  }
}

// b = { persons, skip, list_id ('' = automatique), dish_id, date, slot }
function updateMeal(hid, mid, user, role, b) {
  const m = ownMeal(hid, mid);
  if (role !== 'manager' && !(m.suggestion && m.suggested_by === user.id)) throw httpError(403, 'Réservé aux gestionnaires du foyer.');
  tx(() => {
    if (b.persons != null) db.prepare('UPDATE planned_meals SET persons = ? WHERE id = ?').run(Math.min(50, Math.max(1, parseInt(b.persons, 10) || m.persons)), mid);
    if (b.list_id !== undefined) db.prepare('UPDATE planned_meals SET list_id = ? WHERE id = ?').run(listOrNull(hid, b.list_id), mid);
    if (b.dish_id != null) db.prepare('UPDATE planned_meals SET dish_id = ? WHERE id = ?').run(ownDish(hid, Number(b.dish_id)).id, mid);
    if (b.date != null || b.slot != null) {
      const date = b.date != null ? isoDate(b.date) : m.date, slot = b.slot != null ? b.slot : m.slot;
      if (!date || !SLOTS.includes(slot)) throw httpError(400, 'Date ou créneau invalide.');
      db.prepare('UPDATE planned_meals SET date = ?, slot = ? WHERE id = ?').run(date, slot, mid);
    }
    setSkips(hid, mid, b.skip);
    syncMealItems(hid);
  });
}

function deleteMeal(hid, mid, user, role) {
  const m = ownMeal(hid, mid);
  if (role !== 'manager' && !(m.suggestion && m.suggested_by === user.id)) throw httpError(403, 'Réservé aux gestionnaires du foyer.');
  tx(() => { db.prepare('DELETE FROM planned_meals WHERE id = ?').run(mid); syncMealItems(hid); });
}

function acceptMeal(hid, mid) {
  const m = ownMeal(hid, mid);
  if (m.suggestion !== 'pending') throw httpError(409, 'Pas de suggestion en attente.');
  tx(() => {
    db.prepare('DELETE FROM planned_meals WHERE household_id = ? AND date = ? AND slot = ? AND suggestion IS NULL').run(hid, m.date, m.slot);
    db.prepare('UPDATE planned_meals SET suggestion = NULL WHERE id = ?').run(mid);
    syncMealItems(hid);
  });
}

const pendingMeals = (hid) => mealRows(hid, '0000-01-01', '9999-12-31').filter((m) => m.suggestion === 'pending' && m.date >= addDays(today(), -1));

// ---------- Ingredients des repas dans les listes ----------
// Liste datee de chaque repas (null : aucune).
function mealTargets(hid) {
  const h = db.prepare('SELECT rhythm_days FROM households WHERE id = ?').get(hid);
  const lists = db.prepare("SELECT id, date, status FROM lists WHERE household_id = ? AND type = 'dated' ORDER BY date").all(hid);
  const byId = new Map(lists.map((l) => [l.id, l]));
  const listFor = (date) => {
    let found = null;
    for (let i = 0; i < lists.length; i++) {
      const end = lists[i + 1] ? addDays(lists[i + 1].date, -1) : addDays(lists[i].date, h.rhythm_days - 1);
      if (date >= lists[i].date && date <= end) found = lists[i];
    }
    return found;
  };
  const meals = db.prepare('SELECT id, date, list_id, dish_id, persons FROM planned_meals WHERE household_id = ? AND suggestion IS NULL').all(hid);
  return { lists, meals: meals.map((m) => ({ ...m, list: (m.list_id && byId.get(m.list_id)) || listFor(m.date) })) };
}

// Recalcule la part « repas » des articles de toutes les listes ouvertes du foyer.
// A appeler (dans une transaction) apres tout changement de repas, de plat, de liste
// datee ou de produit utilise comme ingredient.
function syncMealItems(hid) {
  const { lists, meals } = mealTargets(hid);
  const open = lists.filter((l) => l.status !== 'closed');
  const need = new Map(open.map((l) => [l.id, new Map()])); // listId -> pid -> [{ meal_id, qty }]
  const portions = new Map();
  for (const m of meals) {
    if (!m.list || !need.has(m.list.id)) continue;
    if (!portions.has(m.dish_id)) portions.set(m.dish_id, db.prepare('SELECT portions FROM dishes WHERE id = ?').get(m.dish_id).portions);
    const skip = new Set(skipsOf(m.id));
    for (const ing of ingredientsOf(m.dish_id)) {
      if (ing.is_base || skip.has(ing.product_id)) continue;
      const q = (ing.qty || 1) * m.persons / portions.get(m.dish_id);
      const per = need.get(m.list.id);
      if (!per.has(ing.product_id)) per.set(ing.product_id, []);
      per.get(ing.product_id).push({ meal_id: m.id, qty: q });
    }
  }
  for (const l of open) {
    db.prepare('DELETE FROM list_item_meals WHERE item_id IN (SELECT id FROM list_items WHERE list_id = ?)').run(l.id);
    db.prepare('UPDATE list_items SET meal_qty = 0 WHERE list_id = ? AND meal_qty <> 0').run(l.id);
    for (const [pid, parts] of need.get(l.id)) {
      // Emballages entiers : la somme est arrondie a l'unite superieure.
      const total = Math.ceil(parts.reduce((n, p) => n + p.qty, 0) - 1e-9);
      let it = db.prepare('SELECT id FROM list_items WHERE list_id = ? AND product_id = ? AND suggestion IS NULL').get(l.id, pid);
      if (!it) {
        it = { id: Number(db.prepare(`INSERT INTO list_items (list_id, product_id, qty, origin, status, created_at, updated_at)
          VALUES (?, ?, 0, 'meal', 'todo', ?, ?)`).run(l.id, pid, now(), now()).lastInsertRowid) };
      }
      db.prepare('UPDATE list_items SET meal_qty = ? WHERE id = ?').run(total, it.id);
      for (const p of parts) db.prepare('INSERT INTO list_item_meals (item_id, meal_id, qty) VALUES (?, ?, ?)').run(it.id, p.meal_id, p.qty);
    }
    // Articles qui ne venaient que des repas et ne sont plus demandes.
    db.prepare("DELETE FROM list_items WHERE list_id = ? AND qty = 0 AND meal_qty = 0 AND suggestion IS NULL AND status = 'todo'").run(l.id);
  }
}

// Repas d'une liste (periode ou rattachement), ingredients de base a verifier.
function listMeals(hid, lid) {
  const { meals } = mealTargets(hid);
  const ids = meals.filter((m) => m.list && m.list.id === lid).map((m) => m.id);
  if (!ids.length) return { meals: [], base: [] };
  const rows = mealRows(hid, '0000-01-01', '9999-12-31').filter((m) => ids.includes(m.id));
  const base = new Map();
  for (const m of rows) {
    for (const ing of ingredientsOf(m.dish_id)) {
      if (!ing.is_base || m.skip.includes(ing.product_id)) continue;
      if (!base.has(ing.product_id)) base.set(ing.product_id, { product_id: ing.product_id, name: ing.name, dishes: [] });
      base.get(ing.product_id).dishes.push(m.dish);
    }
  }
  return { meals: rows, base: [...base.values()] };
}

// « Deja en reserve » depuis un article : retire ce produit des repas de la liste.
function itemInStock(hid, iid) {
  const it = db.prepare(`SELECT i.id, i.product_id, i.list_id FROM list_items i JOIN lists l ON l.id = i.list_id
    WHERE i.id = ? AND l.household_id = ? AND l.status <> 'closed'`).get(iid, hid);
  if (!it) throw httpError(404, 'Article introuvable.');
  tx(() => {
    for (const r of db.prepare('SELECT meal_id FROM list_item_meals WHERE item_id = ?').all(iid)) {
      db.prepare('INSERT OR IGNORE INTO planned_meal_skips (meal_id, product_id) VALUES (?, ?)').run(r.meal_id, it.product_id);
    }
    syncMealItems(hid);
  });
  return it.list_id;
}

// ---------- Lien d'affichage du menu (lecture seule, sans connexion) ----------
function shareToken(hid, action) {
  const token = action === 'revoke' ? null : crypto.randomBytes(18).toString('base64url');
  db.prepare('UPDATE households SET menu_token = ? WHERE id = ?').run(token, hid);
  return token;
}
function publicMenu(token, from, days) {
  const h = token && db.prepare('SELECT id, name FROM households WHERE menu_token = ?').get(String(token));
  if (!h) throw httpError(404, 'Lien d’affichage inconnu ou révoqué.');
  const m = menu(h.id, from, days);
  return {
    household: h.name, from: m.from, to: m.to, shoppingDays: m.lists.map((l) => l.date),
    meals: m.meals.filter((x) => !x.suggestion).map((x) => ({ date: x.date, slot: x.slot, dish: x.dish, persons: x.persons })),
  };
}

module.exports = {
  SLOTS, dishes, dish, saveDish, deleteDish, menu, createMeal, updateMeal, deleteMeal, acceptMeal, pendingMeals,
  syncMealItems, listMeals, itemInStock, shareToken, publicMenu, ingredientsOf,
};
