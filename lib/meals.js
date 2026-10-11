// Plats (recettes facultatives), repas planifies (menu) et ingredients des repas dans
// les listes.
//
// Rattachement d'un repas a une liste : la liste choisie (list_id) si elle est datee,
// sinon la liste datee dont la periode contient la date du repas (de sa date a la veille
// de la liste suivante ; la derniere couvre `rythme` jours). Seules les listes non
// cloturees sont recalculees.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, tx, normalize, DATA_DIR } = require('./db');
const { httpError, str, isoDate } = require('./util');
const U = require('./units');

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

// Tous les ingredients du plat (option_id NULL = commun a toutes les variantes).
function allIngredients(did) {
  // unit = emballage du produit ; iunit = unite de la quantite (NULL = emballages) ;
  // conv = la quantite se convertit en emballages.
  return db.prepare(`SELECT di.id, di.product_id, di.qty, di.unit AS iunit, di.note, di.option_id, p.name, p.unit, p.contenance, p.piece_qty, p.is_base, p.category_id
    FROM dish_ingredients di JOIN products p ON p.id = di.product_id WHERE di.dish_id = ? AND p.deleted_at IS NULL ORDER BY di.position, di.id`).all(did)
    .map(({ contenance, piece_qty, ...i }) => ({ ...i, is_base: !!i.is_base, conv: !i.iunit || U.packages(1, i.iunit, { unit: i.unit, contenance, piece_qty }) != null, _p: { unit: i.unit, contenance, piece_qty } }));
}
const optionsOf = (did) => db.prepare('SELECT id, grp, name FROM dish_options WHERE dish_id = ? ORDER BY position, id').all(did);

// Variantes retenues : par groupe, l'option choisie si elle existe encore, sinon la premiere.
function chosenOptions(did, chosen) {
  const want = new Set((chosen || []).map(Number)), byGrp = new Map();
  for (const o of optionsOf(did)) {
    if (!byGrp.has(o.grp)) byGrp.set(o.grp, []);
    byGrp.get(o.grp).push(o);
  }
  return [...byGrp.values()].map((os) => os.find((o) => want.has(o.id)) || os[0]);
}

// Ingredients d'un plat pour un choix de variantes (communs + options retenues).
function ingredientsOf(did, chosen) {
  const keep = new Set(chosenOptions(did, chosen).map((o) => o.id));
  return allIngredients(did).filter((i) => i.option_id == null || keep.has(i.option_id));
}

// Groupes du plat : [{ name, options: [{ id, name, ingredients }] }].
function groupsOf(did, ings) {
  const groups = [];
  for (const o of optionsOf(did)) {
    let g = groups.find((x) => x.name === o.grp);
    if (!g) groups.push(g = { name: o.grp, options: [] });
    g.options.push({ id: o.id, name: o.name, ingredients: ings.filter((i) => i.option_id === o.id) });
  }
  return groups;
}

// Repas du plat, y compris ceux ou il sert de composant d'un plat compose (sauf s'il y
// etait ecarte) ; via = nom du plat compose.
const MEALS_OF = `SELECT m.id, m.date, m.slot, m.persons, m.dish_id, CASE WHEN m.dish_id = :d THEN NULL ELSE d.name END AS via
  FROM planned_meals m JOIN dishes d ON d.id = m.dish_id WHERE m.suggestion IS NULL AND (m.dish_id = :d OR (m.dish_id IN (SELECT dish_id FROM dish_parts WHERE part_id = :d)
    AND NOT EXISTS (SELECT 1 FROM planned_meal_part_skips s WHERE s.meal_id = m.id AND s.part_id = :d)))`;
function mealsOfDish(did) {
  return db.prepare(`${MEALS_OF} ORDER BY m.date DESC, m.slot`).all({ d: did });
}

// ---------- Plats composes ----------
// Composants (plats non supprimes) d'un plat compose, dans l'ordre ; portions = portions
// du composant pour les portions du plat compose.
const partsOf = (did) => db.prepare(`SELECT dp.part_id AS dish_id, dp.portions, d.name, d.portions AS dish_portions
  FROM dish_parts dp JOIN dishes d ON d.id = dp.part_id WHERE dp.dish_id = ? AND d.deleted_at IS NULL ORDER BY dp.position, dp.id`).all(did);
const partSkipsOf = (mid) => db.prepare('SELECT part_id FROM planned_meal_part_skips WHERE meal_id = ?').all(mid).map((r) => r.part_id);
const usedIn = (did) => db.prepare(`SELECT d.id, d.name FROM dish_parts dp JOIN dishes d ON d.id = dp.dish_id
  WHERE dp.part_id = ? AND d.deleted_at IS NULL ORDER BY d.name_norm`).all(did);
const hasRecipe = (d) => !!(d.url || d.steps || d.notes);

// Recettes a preparer pour un repas : le plat lui-meme (variantes du repas), puis chaque
// composant non ecarte (variantes par defaut), avec le facteur des quantites.
function mealUnits(m, options, partSkip) {
  const f = m.persons / db.prepare('SELECT portions FROM dishes WHERE id = ?').get(m.dish_id).portions;
  const skip = new Set(partSkip || []);
  return [{ dish_id: m.dish_id, f, options },
    ...partsOf(m.dish_id).filter((p) => !skip.has(p.dish_id)).map((p) => ({ dish_id: p.dish_id, f: (f * p.portions) / p.dish_portions, options: [] }))];
}

// Composants envoyes : plats du foyer, ni le plat lui-meme, ni un plat compose ; un plat
// deja composant d'un autre ne peut pas etre compose (un seul niveau).
function setParts(hid, did, parts) {
  const list = (Array.isArray(parts) ? parts : []).slice(0, 20);
  if (list.length && usedIn(did).length) throw httpError(400, 'Ce plat sert déjà de recette dans un plat composé : il ne peut pas en contenir.');
  db.prepare('DELETE FROM dish_parts WHERE dish_id = ?').run(did);
  const seen = new Set();
  list.forEach((p, k) => {
    const pid = Number(p && p.dish_id);
    if (seen.has(pid)) return;
    seen.add(pid);
    if (pid === did) throw httpError(400, 'Un plat ne peut pas se contenir lui-même.');
    const d = ownDish(hid, pid);
    if (db.prepare('SELECT 1 FROM dish_parts WHERE dish_id = ?').get(pid)) throw httpError(400, `« ${d.name} » est lui-même un plat composé.`);
    const n = Number(String(p.portions ?? '').replace(',', '.'));
    db.prepare('INSERT INTO dish_parts (dish_id, part_id, portions, position) VALUES (?, ?, ?, ?)')
      .run(did, pid, n > 0 ? Math.min(200, n) : d.portions, k);
  });
}

// ---------- Photos des plats ----------
// Fichier <donnees>/photos/<plat>-<alea>.<ext> ; adresse relative a /api, changee a chaque photo.
const PHOTOS = path.join(DATA_DIR, 'photos');
const photoUrl = (hid, d) => (d.photo ? `h/${hid}/dishes/${d.id}/photo?v=${d.photo.split('-')[1].split('.')[0]}` : null);
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
// Photo envoyee par l'appareil : data:image/...;base64,... (3 Mo au plus).
function photoFromData(data) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ''));
  if (!m) throw httpError(400, 'Photo illisible (jpeg, png ou webp).');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 3 * 1024 * 1024) throw httpError(413, 'Photo trop lourde (3 Mo au plus).');
  return { buf, type: m[1] };
}
function setPhoto(hid, did, img) {
  const d = ownDish(hid, did);
  fs.mkdirSync(PHOTOS, { recursive: true });
  const name = `${did}-${crypto.randomBytes(6).toString('hex')}.${EXT[img.type]}`;
  fs.writeFileSync(path.join(PHOTOS, name), img.buf);
  db.prepare('UPDATE dishes SET photo = ? WHERE id = ?').run(name, did);
  if (d.photo) fs.rm(path.join(PHOTOS, d.photo), { force: true }, () => {});
}
function removePhoto(hid, did) {
  const d = ownDish(hid, did);
  if (!d.photo) return;
  db.prepare('UPDATE dishes SET photo = NULL WHERE id = ?').run(did);
  fs.rm(path.join(PHOTOS, d.photo), { force: true }, () => {});
}
function photoFile(hid, did) {
  const d = db.prepare('SELECT photo FROM dishes WHERE id = ? AND household_id = ?').get(did, hid);
  if (!d || !d.photo) throw httpError(404, 'Pas de photo.');
  return path.join(PHOTOS, d.photo);
}

// ---------- Tags ----------
function tagsOfDishes(hid) {
  const map = new Map();
  for (const r of db.prepare(`SELECT dt.dish_id, t.name FROM dish_tags dt JOIN tags t ON t.id = dt.tag_id
    WHERE t.household_id = ? ORDER BY t.name_norm`).all(hid)) {
    if (!map.has(r.dish_id)) map.set(r.dish_id, []);
    map.get(r.dish_id).push(r.name);
  }
  return map;
}
function tags(hid) {
  return db.prepare(`SELECT t.id, t.name, (SELECT COUNT(*) FROM dish_tags dt JOIN dishes d ON d.id = dt.dish_id WHERE dt.tag_id = t.id AND d.deleted_at IS NULL) AS dishes
    FROM tags t WHERE t.household_id = ? ORDER BY t.name_norm`).all(hid);
}
function ownTag(hid, tid) {
  const t = db.prepare('SELECT id, name FROM tags WHERE id = ? AND household_id = ?').get(tid, hid);
  if (!t) throw httpError(404, 'Tag introuvable.');
  return t;
}
// Fusion : les plats de « from » recoivent « into », puis « from » disparait.
function mergeTag(hid, from, into) {
  ownTag(hid, from); ownTag(hid, into);
  if (from === into) throw httpError(400, 'Choisissez un autre tag.');
  tx(() => {
    db.prepare('INSERT OR IGNORE INTO dish_tags (dish_id, tag_id) SELECT dish_id, ? FROM dish_tags WHERE tag_id = ?').run(into, from);
    db.prepare('DELETE FROM tags WHERE id = ?').run(from);
  });
}
// Renommer vers le nom d'un autre tag = fusionner avec lui.
function renameTag(hid, tid, name) {
  ownTag(hid, tid);
  const n = str(name, 30);
  if (!n) throw httpError(400, 'Nom du tag requis.');
  const other = db.prepare('SELECT id FROM tags WHERE household_id = ? AND name_norm = ? AND id <> ?').get(hid, normalize(n), tid);
  if (other) return mergeTag(hid, tid, other.id);
  db.prepare('UPDATE tags SET name = ?, name_norm = ? WHERE id = ?').run(n, normalize(n), tid);
}
function deleteTag(hid, tid) {
  ownTag(hid, tid);
  db.prepare('DELETE FROM tags WHERE id = ?').run(tid);
}
function setDishTags(hid, did, names) {
  db.prepare('DELETE FROM dish_tags WHERE dish_id = ?').run(did);
  const seen = new Set();
  for (const raw of (Array.isArray(names) ? names : []).slice(0, 12)) {
    const n = str(raw, 30), k = normalize(n);
    if (!n || seen.has(k)) continue;
    seen.add(k);
    let t = db.prepare('SELECT id FROM tags WHERE household_id = ? AND name_norm = ?').get(hid, k);
    if (!t) t = { id: Number(db.prepare('INSERT INTO tags (household_id, name, name_norm) VALUES (?, ?, ?)').run(hid, n, k).lastInsertRowid) };
    db.prepare('INSERT INTO dish_tags (dish_id, tag_id) VALUES (?, ?)').run(did, t.id);
  }
}

function dishes(hid) {
  const rows = db.prepare(`SELECT d.id, d.name, d.portions, d.time_text, d.url, d.steps, d.notes, d.draft, d.draft_by, d.photo,
      (SELECT COUNT(*) FROM dish_ingredients di JOIN products p ON p.id = di.product_id WHERE di.dish_id = d.id AND p.deleted_at IS NULL) AS ingredients,
      (SELECT COUNT(*) FROM dish_parts dp JOIN dishes x ON x.id = dp.part_id WHERE dp.dish_id = d.id AND x.deleted_at IS NULL) AS parts,
      (SELECT COUNT(*) FROM dish_parts dp JOIN dishes x ON x.id = dp.dish_id WHERE dp.part_id = d.id AND x.deleted_at IS NULL) AS used_in
    FROM dishes d WHERE d.household_id = ? AND d.deleted_at IS NULL ORDER BY d.name_norm`).all(hid);
  // Dates : repas du plat ou d'un plat compose qui le contient (composant non ecarte).
  const t = today(), when = new Map();
  for (const r of db.prepare(`SELECT m.id, m.date, m.dish_id AS did FROM planned_meals m WHERE m.household_id = ? AND m.suggestion IS NULL
    UNION ALL SELECT m.id, m.date, dp.part_id FROM planned_meals m JOIN dish_parts dp ON dp.dish_id = m.dish_id
    WHERE m.household_id = ? AND m.suggestion IS NULL AND NOT EXISTS (SELECT 1 FROM planned_meal_part_skips s WHERE s.meal_id = m.id AND s.part_id = dp.part_id)`).all(hid, hid)) {
    if (!when.has(r.did)) when.set(r.did, { next_date: null, last_date: null, times: 0 });
    const w = when.get(r.did);
    if (r.date >= t) { if (!w.next_date || r.date < w.next_date) w.next_date = r.date; } else { w.times++; if (!w.last_date || r.date > w.last_date) w.last_date = r.date; }
  }
  const partNames = new Map();
  for (const r of db.prepare(`SELECT dp.dish_id, x.name FROM dish_parts dp JOIN dishes x ON x.id = dp.part_id JOIN dishes d ON d.id = dp.dish_id
    WHERE d.household_id = ? AND x.deleted_at IS NULL ORDER BY dp.position`).all(hid)) {
    if (!partNames.has(r.dish_id)) partNames.set(r.dish_id, []);
    partNames.get(r.dish_id).push(r.name);
  }
  // Noms des ingredients (recherche par ingredient).
  const ing = db.prepare(`SELECT di.dish_id, p.name FROM dish_ingredients di JOIN dishes d ON d.id = di.dish_id JOIN products p ON p.id = di.product_id
    WHERE d.household_id = ? AND p.deleted_at IS NULL`).all(hid);
  const tg = tagsOfDishes(hid);
  return rows.map((d) => ({
    ...d, photo: photoUrl(hid, d), ...(when.get(d.id) || { next_date: null, last_date: null, times: 0 }), tags: tg.get(d.id) || [], has_recipe: hasRecipe(d),
    ingredient_names: ing.filter((i) => i.dish_id === d.id).map((i) => i.name), part_names: partNames.get(d.id) || [],
  }));
}

function dish(hid, did) {
  const d = ownDish(hid, did);
  const meals = mealsOfDish(did);
  const ings = allIngredients(did).map(({ _p, ...i }) => i);
  return {
    id: d.id, name: d.name, portions: d.portions, time_text: d.time_text, url: d.url, steps: d.steps, notes: d.notes, draft: d.draft, draft_by: d.draft_by, photo: photoUrl(hid, d),
    tags: db.prepare('SELECT t.name FROM dish_tags dt JOIN tags t ON t.id = dt.tag_id WHERE dt.dish_id = ? ORDER BY t.name_norm').all(did).map((t) => t.name),
    ingredients: ings.filter((i) => i.option_id == null), groups: groupsOf(did, ings),
    // Recettes du plat compose : fiche du composant, ingredients des variantes par defaut.
    parts: partsOf(did).map((p) => {
      const x = db.prepare('SELECT time_text, url, steps, notes FROM dishes WHERE id = ?').get(p.dish_id);
      return { ...p, ...x, has_recipe: hasRecipe(x), variant: chosenOptions(p.dish_id).map((o) => o.name).join(', '),
        ingredients: ingredientsOf(p.dish_id).map(({ _p, ...i }) => i) };
    }),
    used_in: usedIn(did),
    upcoming: meals.filter((m) => m.date >= today()).reverse(),
    past: meals.filter((m) => m.date < today()).slice(0, 5),
    times: meals.filter((m) => m.date < today()).length,
    first_date: meals.length ? meals[meals.length - 1].date : null,
  };
}

// b = { name, portions, time_text, url, steps, notes, ingredients: [{ product_id, qty, note }],
//       groups: [{ name, options: [{ id?, name, ingredients: [...] }] }] }
// Les options gardent leur id (choix des repas) ; une option retiree l'est aussi des repas.
function saveDish(hid, did, b) {
  const name = str(b.name, 80);
  if (!name) throw httpError(400, 'Nom du plat requis.');
  const dup = db.prepare('SELECT id FROM dishes WHERE household_id = ? AND name_norm = ? AND id <> ? AND deleted_at IS NULL').get(hid, normalize(name), did || 0);
  if (dup) throw httpError(409, 'Un plat porte déjà ce nom.');
  const portions = Math.min(50, Math.max(1, parseInt(b.portions, 10) || 4));
  let url = str(b.url, 500) || null;
  if (url && !/^https?:\/\//i.test(url)) throw httpError(400, 'Lien invalide (http ou https).');
  const ings = Array.isArray(b.ingredients) ? b.ingredients.slice(0, 80) : [];
  const groups = (Array.isArray(b.groups) ? b.groups.slice(0, 10) : []).map((g, k) => ({
    name: str(g && g.name, 40) || `Choix ${k + 1}`,
    options: (Array.isArray(g && g.options) ? g.options.slice(0, 20) : []).map((o) => ({
      id: Number(o && o.id) || null, name: str(o && o.name, 60), ingredients: Array.isArray(o && o.ingredients) ? o.ingredients.slice(0, 40) : [],
    })).filter((o) => o.name),
  })).filter((g) => g.options.length);
  if (new Set(groups.map((g) => normalize(g.name))).size < groups.length) throw httpError(400, 'Deux groupes de variantes portent le même nom.');
  for (const i of [...ings, ...groups.flatMap((g) => g.options.flatMap((o) => o.ingredients))]) {
    if (!db.prepare('SELECT 1 FROM products WHERE id = ? AND household_id = ? AND deleted_at IS NULL').get(Number(i.product_id), hid)) throw httpError(404, 'Ingrédient introuvable dans les produits.');
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
    let pos = 0;
    const addIng = (i, optionId) => {
      const q = i.qty === '' || i.qty == null ? null : Number(String(i.qty).replace(',', '.'));
      const unit = U.ING_UNITS.includes(i.unit) ? i.unit : null;
      db.prepare('INSERT INTO dish_ingredients (dish_id, product_id, qty, unit, note, position, option_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, Number(i.product_id), q > 0 ? q : null, unit, str(i.note, 60) || null, pos++, optionId);
    };
    ings.forEach((i) => addIng(i, null));
    const kept = [];
    groups.forEach((g, gk) => g.options.forEach((o, ok) => {
      const position = gk * 100 + ok;
      let oid = o.id && db.prepare('SELECT id FROM dish_options WHERE id = ? AND dish_id = ?').get(o.id, id) ? o.id : null;
      if (oid) db.prepare('UPDATE dish_options SET grp = ?, name = ?, position = ? WHERE id = ?').run(g.name, o.name, position, oid);
      else oid = Number(db.prepare('INSERT INTO dish_options (dish_id, grp, name, position) VALUES (?, ?, ?, ?)').run(id, g.name, o.name, position).lastInsertRowid);
      kept.push(oid);
      o.ingredients.forEach((i) => addIng(i, oid));
    }));
    if (b.tags !== undefined) setDishTags(hid, id, b.tags);
    if (b.parts !== undefined) setParts(hid, id, b.parts);
    db.prepare(`DELETE FROM dish_options WHERE dish_id = ? AND id NOT IN (${kept.map(() => '?').join(',') || 'NULL'})`).run(id, ...kept);
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
    // Retire des plats composes ; un plat compose supprime garde ses composants.
    db.prepare('DELETE FROM dish_parts WHERE part_id = ?').run(did);
    db.prepare('DELETE FROM dish_wishes WHERE dish_id = ?').run(did);
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
    .map((m) => {
      const options = mealOptionsOf(m.id), variant = chosenOptions(m.dish_id, options).map((o) => o.name).join(', ');
      const part_skip = partSkipsOf(m.id), parts = partsOf(m.dish_id).map((p) => ({ dish_id: p.dish_id, name: p.name, skipped: part_skip.includes(p.dish_id) }));
      const partRecipe = parts.some((p) => hasRecipe(db.prepare('SELECT url, steps, notes FROM dishes WHERE id = ?').get(p.dish_id)));
      // dish : nom affiche (avec les variantes) ; dish_name : nom du plat seul.
      return { ...m, dish_name: m.dish, dish: variant ? `${m.dish} · ${variant}` : m.dish, variant, options,
        has_recipe: !!m.has_recipe || partRecipe, dish_deleted: !!m.dish_deleted, skip: skipsOf(m.id), parts, part_skip };
    });
}
const mealOptionsOf = (mid) => db.prepare('SELECT option_id FROM planned_meal_options WHERE meal_id = ?').all(mid).map((r) => r.option_id);
const skipsOf = (mid) => db.prepare('SELECT product_id FROM planned_meal_skips WHERE meal_id = ?').all(mid).map((r) => r.product_id);

// ---------- Menus (periodes) ----------
// Menu enregistre qui contient la date, sinon periode proposee : tranches de `menu_days`
// jours a partir du lendemain du menu precedent (sinon en remontant depuis le menu suivant,
// sinon depuis le dernier `menu_start_dow` <= aujourd'hui), coupee avant le menu suivant.
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
function menuPeriod(hid, date) {
  const saved = db.prepare('SELECT id, start, end FROM menus WHERE household_id = ? AND start <= ? AND end >= ?').get(hid, date, date);
  if (saved) return { ...saved, saved: true };
  const h = db.prepare('SELECT menu_days, menu_start_dow FROM households WHERE id = ?').get(hid);
  const prev = db.prepare('SELECT end FROM menus WHERE household_id = ? AND end < ? ORDER BY end DESC LIMIT 1').get(hid, date);
  const next = db.prepare('SELECT start FROM menus WHERE household_id = ? AND start > ? ORDER BY start LIMIT 1').get(hid, date);
  let anchor;
  if (prev) anchor = addDays(prev.end, 1);
  else if (next) anchor = next.start;
  else {
    const t = today();
    anchor = addDays(t, -((new Date(t + 'T12:00:00Z').getUTCDay() - h.menu_start_dow + 7) % 7));
  }
  const start = addDays(anchor, Math.floor(dayDiff(anchor, date) / h.menu_days) * h.menu_days);
  let end = addDays(start, h.menu_days - 1);
  if (next && end >= next.start) end = addDays(next.start, -1);
  return { id: null, start, end, saved: false };
}

// Cree (id absent) ou modifie un menu ; pas de chevauchement avec un autre menu.
function saveMenu(hid, id, b) {
  const start = isoDate(b.start), end = isoDate(b.end);
  if (!start || !end || end < start) throw httpError(400, 'Dates du menu invalides.');
  if (dayDiff(start, end) >= 62) throw httpError(400, 'Un menu dure au plus 62 jours.');
  if (id && !db.prepare('SELECT 1 FROM menus WHERE id = ? AND household_id = ?').get(id, hid)) throw httpError(404, 'Menu introuvable.');
  const clash = db.prepare('SELECT start, end FROM menus WHERE household_id = ? AND id <> ? AND start <= ? AND end >= ?').get(hid, id || 0, end, start);
  if (clash) throw httpError(409, `Chevauche le menu du ${clash.start.split('-').reverse().join('/')} au ${clash.end.split('-').reverse().join('/')}.`);
  if (id) db.prepare('UPDATE menus SET start = ?, end = ? WHERE id = ?').run(start, end, id);
  else id = Number(db.prepare('INSERT INTO menus (household_id, start, end, created_at) VALUES (?, ?, ?, ?)').run(hid, start, end, now()).lastInsertRowid);
  return menuPeriod(hid, start);
}

function deleteMenu(hid, id) {
  if (!db.prepare('DELETE FROM menus WHERE id = ? AND household_id = ?').run(id, hid).changes) throw httpError(404, 'Menu introuvable.');
}

// Repas d'une periode : `at` (date) = le menu qui la contient ; sinon `from` + `days`.
function menu(hid, from, days, at) {
  let f, to, period;
  if (at !== undefined) {
    period = menuPeriod(hid, isoDate(at) || today());
    f = period.start; to = period.end;
  } else {
    f = isoDate(from) || today();
    to = addDays(f, Math.min(62, Math.max(1, parseInt(days, 10) || 14)) - 1);
  }
  return {
    from: f, to, period, meals: mealRows(hid, f, to), note: menuNote(hid, f),
    lists: db.prepare("SELECT id, date, status FROM lists WHERE household_id = ? AND type = 'dated' AND date >= ? AND date <= ? ORDER BY date").all(hid, addDays(f, -60), addDays(to, 60)),
  };
}

// b = { date, slot, dish_id, persons, skip: [product_id], options: [option_id], part_skip: [dish_id], list_id, replace }
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
    setOptions(mid, d.id, b.options);
    setPartSkips(mid, d.id, b.part_skip);
    if (role === 'manager') wishDone(hid, d.id);
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

// Variantes choisies pour un repas (options du plat uniquement).
function setOptions(mid, did, options) {
  if (!Array.isArray(options)) return;
  db.prepare('DELETE FROM planned_meal_options WHERE meal_id = ?').run(mid);
  for (const oid of options) {
    if (db.prepare('SELECT 1 FROM dish_options WHERE id = ? AND dish_id = ?').get(Number(oid), did)) {
      db.prepare('INSERT OR IGNORE INTO planned_meal_options (meal_id, option_id) VALUES (?, ?)').run(mid, Number(oid));
    }
  }
}

// Composants ecartes d'un repas (composants du plat uniquement).
function setPartSkips(mid, did, ids) {
  if (!Array.isArray(ids)) return;
  db.prepare('DELETE FROM planned_meal_part_skips WHERE meal_id = ?').run(mid);
  for (const pid of ids) {
    if (db.prepare('SELECT 1 FROM dish_parts WHERE dish_id = ? AND part_id = ?').get(did, Number(pid))) {
      db.prepare('INSERT OR IGNORE INTO planned_meal_part_skips (meal_id, part_id) VALUES (?, ?)').run(mid, Number(pid));
    }
  }
}

// b = { persons, skip, options, part_skip, list_id ('' = automatique), dish_id, date, slot }
function updateMeal(hid, mid, user, role, b) {
  const m = ownMeal(hid, mid);
  if (role !== 'manager' && !(m.suggestion && m.suggested_by === user.id)) throw httpError(403, 'Réservé aux gestionnaires du foyer.');
  tx(() => {
    if (b.persons != null) db.prepare('UPDATE planned_meals SET persons = ? WHERE id = ?').run(Math.min(50, Math.max(1, parseInt(b.persons, 10) || m.persons)), mid);
    if (b.list_id !== undefined) db.prepare('UPDATE planned_meals SET list_id = ? WHERE id = ?').run(listOrNull(hid, b.list_id), mid);
    let did = m.dish_id;
    if (b.dish_id != null) {
      did = ownDish(hid, Number(b.dish_id)).id;
      db.prepare('UPDATE planned_meals SET dish_id = ? WHERE id = ?').run(did, mid);
      if (did !== m.dish_id) {
        db.prepare('DELETE FROM planned_meal_options WHERE meal_id = ?').run(mid);
        db.prepare('DELETE FROM planned_meal_part_skips WHERE meal_id = ?').run(mid);
      }
    }
    if (b.date != null || b.slot != null) {
      const date = b.date != null ? isoDate(b.date) : m.date, slot = b.slot != null ? b.slot : m.slot;
      if (!date || !SLOTS.includes(slot)) throw httpError(400, 'Date ou créneau invalide.');
      // Creneau occupe par un repas valide : les deux repas echangent leur place.
      if (!m.suggestion) {
        db.prepare(`UPDATE planned_meals SET date = ?, slot = ? WHERE household_id = ? AND date = ? AND slot = ?
          AND suggestion IS NULL AND id <> ?`).run(m.date, m.slot, hid, date, slot, mid);
      }
      db.prepare('UPDATE planned_meals SET date = ?, slot = ? WHERE id = ?').run(date, slot, mid);
    }
    setSkips(hid, mid, b.skip);
    setOptions(mid, did, b.options);
    setPartSkips(mid, did, b.part_skip);
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
    wishDone(hid, m.dish_id);
    syncMealItems(hid);
  });
}

// ---------- Envies de plats (sans date) ----------
// Membre : en attente ; gestionnaire : validee. Un nom libre devient un plat quand un
// gestionnaire cree sa fiche (linkWish). Retiree quand le plat est mis au menu.
function wishDone(hid, did) {
  db.prepare('DELETE FROM dish_wishes WHERE household_id = ? AND dish_id = ?').run(hid, did);
  validateDraft(did);
}
const validateDraft = (did) => db.prepare('UPDATE dishes SET draft = 0, draft_by = NULL WHERE id = ?').run(did);
// Brouillon : modifiable par son auteur tant qu'il n'est pas valide ; enregistre par un
// gestionnaire = valide (l'envie aussi).
function canEditDish(hid, did, user, role) {
  const d = ownDish(hid, did);
  if (role === 'manager') return d;
  if (d.draft && d.draft_by === user.id) return d;
  throw httpError(403, 'Réservé aux gestionnaires du foyer.');
}
function afterDishSave(hid, did, role) {
  if (role !== 'manager') return;
  if (db.prepare('SELECT draft FROM dishes WHERE id = ?').get(did).draft) {
    validateDraft(did);
    db.prepare("UPDATE dish_wishes SET status = 'ok' WHERE household_id = ? AND dish_id = ?").run(hid, did);
  }
}
// Refus d'un brouillon : la fiche disparait (avec ses suggestions de repas).
function dropDraft(hid, did) {
  const d = db.prepare('SELECT draft FROM dishes WHERE id = ? AND household_id = ?').get(did, hid);
  if (!d || !d.draft) return;
  db.prepare('DELETE FROM planned_meals WHERE dish_id = ?').run(did);
  db.prepare('DELETE FROM dishes WHERE id = ?').run(did);
  syncMealItems(hid);
}
function wishes(hid) {
  return db.prepare(`SELECT w.id, w.dish_id, d.name, d.draft, d.draft_by, w.status, w.created_by, u.name AS created_by_name, w.created_at
    FROM dish_wishes w JOIN dishes d ON d.id = w.dish_id LEFT JOIN users u ON u.id = w.created_by
    WHERE w.household_id = ? ORDER BY w.status DESC, w.created_at`).all(hid);
}
const pendingWishes = (hid) => wishes(hid).filter((w) => w.status === 'pending');
function ownWish(hid, wid) {
  const w = db.prepare('SELECT * FROM dish_wishes WHERE id = ? AND household_id = ?').get(wid, hid);
  if (!w) throw httpError(404, 'Envie introuvable.');
  return w;
}
function addWish(hid, user, role, b) {
  return tx(() => {
    let did;
    if (b.dish_id) did = ownDish(hid, Number(b.dish_id)).id;
    else {
      const name = str(b.name, 80);
      if (!name) throw httpError(400, 'Nom du plat requis.');
      const same = db.prepare('SELECT id FROM dishes WHERE household_id = ? AND name_norm = ? AND deleted_at IS NULL').get(hid, normalize(name));
      did = same ? same.id : Number(db.prepare('INSERT INTO dishes (household_id, name, name_norm, created_at, draft, draft_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(hid, name, normalize(name), now(), role === 'manager' ? 0 : 1, role === 'manager' ? null : user.id).lastInsertRowid);
    }
    if (db.prepare('SELECT 1 FROM dish_wishes WHERE household_id = ? AND dish_id = ?').get(hid, did)) throw httpError(409, 'Ce plat est déjà dans les envies.');
    const draft = db.prepare('SELECT draft FROM dishes WHERE id = ?').get(did).draft;
    return Number(db.prepare('INSERT INTO dish_wishes (household_id, dish_id, status, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(hid, did, role === 'manager' && !draft ? 'ok' : 'pending', user.id, now()).lastInsertRowid);
  });
}
// Validation (plat existant) ou rattachement a la fiche creee (dish_id).
function acceptWish(hid, wid) {
  const w = ownWish(hid, wid);
  tx(() => {
    db.prepare("UPDATE dish_wishes SET status = 'ok' WHERE id = ?").run(w.id);
    validateDraft(w.dish_id);
  });
}
function deleteWish(hid, wid, user, role) {
  const w = ownWish(hid, wid);
  if (role !== 'manager' && !(w.status === 'pending' && w.created_by === user.id)) throw httpError(403, 'Réservé aux gestionnaires du foyer.');
  tx(() => {
    db.prepare('DELETE FROM dish_wishes WHERE id = ?').run(w.id);
    dropDraft(hid, w.dish_id);
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
  for (const m of meals) {
    if (!m.list || !need.has(m.list.id)) continue;
    const skip = new Set(skipsOf(m.id)), per = need.get(m.list.id);
    // Plat compose : les recettes du repas s'additionnent (une part par produit et par repas).
    for (const u of mealUnits(m, mealOptionsOf(m.id), partSkipsOf(m.id))) {
      for (const ing of ingredientsOf(u.dish_id, u.options)) {
        if (ing.is_base || skip.has(ing.product_id)) continue;
        // Quantite convertie en emballages (fractionnaires) avant la somme ; sans conversion
        // possible (ou sans quantite), 1 emballage pour la recette.
        const f = u.f;
        // Quantite reelle ramenee a g / ml / pc pour pouvoir sommer entre recettes.
        const b = ing.qty && ing.iunit ? U.toBase(ing.qty * f, ing.iunit) : null, amount = b ? b.qty : null;
        const pk = ing.qty ? U.packages(ing.qty, ing.iunit, ing._p) : null;
        if (!per.has(ing.product_id)) per.set(ing.product_id, []);
        const parts = per.get(ing.product_id), same = parts.find((p) => p.meal_id === m.id);
        const part = { meal_id: m.id, qty: (pk ?? 1) * f, amount, amount_unit: b ? b.unit : null };
        if (!same) parts.push(part);
        else {
          same.qty += part.qty;
          // Quantite reelle gardee seulement si les deux recettes l'expriment dans la meme unite.
          if (same.amount != null && part.amount != null && same.amount_unit === part.amount_unit) same.amount += part.amount;
          else { same.amount = null; same.amount_unit = null; }
        }
      }
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
      for (const p of parts) {
        db.prepare('INSERT INTO list_item_meals (item_id, meal_id, qty, amount, amount_unit) VALUES (?, ?, ?, ?, ?)').run(it.id, p.meal_id, p.qty, p.amount, p.amount_unit);
      }
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
    for (const u of mealUnits(m, m.options, m.part_skip)) {
      for (const ing of ingredientsOf(u.dish_id, u.options)) {
        if (!ing.is_base || m.skip.includes(ing.product_id)) continue;
        if (!base.has(ing.product_id)) base.set(ing.product_id, { product_id: ing.product_id, name: ing.name, dishes: [] });
        const ds = base.get(ing.product_id).dishes;
        if (!ds.includes(m.dish)) ds.push(m.dish);
      }
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
const menuNote = (hid, start) => (db.prepare('SELECT note FROM menu_notes WHERE household_id = ? AND start = ?').get(hid, start) || {}).note || '';
function saveMenuNote(hid, start, note) {
  const d = isoDate(start);
  if (!d) throw httpError(400, 'Date invalide.');
  const t = str(note, 2000);
  if (t) db.prepare('INSERT INTO menu_notes (household_id, start, note) VALUES (?, ?, ?) ON CONFLICT (household_id, start) DO UPDATE SET note = excluded.note').run(hid, d, t);
  else db.prepare('DELETE FROM menu_notes WHERE household_id = ? AND start = ?').run(hid, d);
  return { note: t };
}
function shareToken(hid, action) {
  const token = action === 'revoke' ? null : crypto.randomBytes(18).toString('base64url');
  db.prepare('UPDATE households SET menu_token = ? WHERE id = ?').run(token, hid);
  return token;
}
function publicMenu(token, from, days) {
  const h = token && db.prepare('SELECT id, name FROM households WHERE menu_token = ?').get(String(token));
  if (!h) throw httpError(404, 'Lien d’affichage inconnu ou révoqué.');
  const m = from ? menu(h.id, from, days) : menu(h.id, null, null, today());
  return {
    household: h.name, from: m.from, to: m.to, note: m.note, shoppingDays: m.lists.map((l) => l.date),
    meals: m.meals.filter((x) => !x.suggestion).map((x) => ({ date: x.date, slot: x.slot, dish: x.dish, persons: x.persons })),
  };
}

module.exports = {
  photoFromData, setPhoto, removePhoto, photoFile,
  tags, renameTag, deleteTag, mergeTag,
  SLOTS, dishes, dish, saveDish, deleteDish, menu, menuPeriod, saveMenu, deleteMenu, createMeal, updateMeal, deleteMeal, acceptMeal, pendingMeals,
  wishes, pendingWishes, addWish, acceptWish, deleteWish, canEditDish, afterDishSave,
  syncMealItems, listMeals, itemInStock, shareToken, saveMenuNote, publicMenu, ingredientsOf,
};
