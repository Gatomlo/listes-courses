// Cout estime des plats et du menu, pour se faire une idee du budget.
//  - prix d'un emballage = moyenne la plus basse parmi les magasins actifs (prix moyen
//    hors promo, voir catalog.averages) ;
//  - la quantite d'une recette est convertie en emballages FRACTIONNAIRES (on ne compte pas
//    l'emballage entame en entier : c'est une moyenne par personne) ; sans conversion
//    possible, 1 emballage, comme pour la liste de courses ;
//  - les produits « de base » (placard) ne comptent pas, comme dans la liste ;
//  - un produit sans prix n'entre pas dans le cout : le plat est alors « partiel ».
// Plat compose : ses ingredients propres + ceux de chaque composant, au prorata des portions.
const { db } = require('./db');
const U = require('./units');

const meals = () => require('./meals').internals;

// { pid -> cents par emballage }
function priceTable(hid) {
  const { averages } = require('./catalog');
  const active = new Set(db.prepare('SELECT id FROM stores WHERE household_id = ? AND active = 1').all(hid).map((s) => s.id));
  const out = new Map();
  for (const [pid, byStore] of averages(hid)) {
    let best = null;
    for (const [sid, v] of Object.entries(byStore)) if (active.has(Number(sid)) && (best == null || v.avg < best)) best = v.avg;
    if (best != null) out.set(pid, best);
  }
  return out;
}

// Cout (centimes, non arrondi) des ingredients pour un facteur f ; `skip` = produits deja en reserve.
// Renvoie aussi, par ingredient, son cout (pour la fiche du plat).
function costOf(ings, f, prices, skip) {
  let cents = 0, missing = 0, n = 0;
  const each = new Map();
  for (const ing of ings) {
    if (ing.is_base || (skip && skip.has(ing.product_id))) continue;
    n++;
    const pk = (ing.qty ? U.packages(ing.qty, ing.iunit, ing._p) : null) ?? 1;
    const price = prices.get(ing.product_id);
    if (price == null) { missing++; each.set(ing.id, null); continue; }
    const c = pk * price * f;
    cents += c;
    each.set(ing.id, c);
  }
  return { cents, missing, n, each };
}

// Cout d'un plat pour ses propres portions (variantes par defaut).
function dishTotal(did, prices) {
  const M = meals();
  let r = costOf(M.ingredientsOf(did, []), 1, prices);
  for (const p of M.partsOf(did)) {
    const s = costOf(M.ingredientsOf(p.dish_id, []), p.portions / p.dish_portions, prices);
    r = { cents: r.cents + s.cents, missing: r.missing + s.missing, n: r.n + s.n, each: r.each };
  }
  return r;
}

// Resume pour l'affichage : cout par personne (centimes entiers, NULL si rien de chiffrable).
function summary(r, portions) {
  const known = r.n - r.missing;
  return { pp: known > 0 && portions > 0 ? Math.round(r.cents / portions) : null, partial: r.missing > 0, missing: r.missing };
}

// Tous les plats du foyer : Map did -> { pp, partial, missing }.
function allDishCosts(hid, prices = priceTable(hid)) {
  const out = new Map();
  for (const d of db.prepare('SELECT id, portions FROM dishes WHERE household_id = ? AND deleted_at IS NULL').all(hid)) out.set(d.id, summary(dishTotal(d.id, prices), d.portions));
  return out;
}

// Plats « economiques » : cout complet par personne sous le palier du foyer (reglage).
function ecoThreshold(hid) {
  return (db.prepare('SELECT eco_cents FROM households WHERE id = ?').get(hid) || {}).eco_cents ?? null;
}
const isEco = (c, threshold) => threshold != null && !!c && c.pp != null && !c.partial && c.pp < threshold;
function ecoIds(hid, costs = allDishCosts(hid)) {
  const t = ecoThreshold(hid), out = new Set();
  if (t != null) for (const [id, c] of costs) if (isEco(c, t)) out.add(id);
  return out;
}

// Cout d'un repas (personnes, variantes choisies, composants ecartes, produits en reserve).
function mealCost(m, options, partSkip, skip, prices) {
  const M = meals();
  let cents = 0, missing = 0, n = 0;
  for (const u of M.mealUnits(m, options, partSkip)) {
    const r = costOf(M.ingredientsOf(u.dish_id, u.options), u.f, prices, skip);
    cents += r.cents; missing += r.missing; n += r.n;
  }
  const known = n - missing;
  return { cost: known > 0 ? Math.round(cents) : null, partial: missing > 0 };
}

module.exports = { priceTable, costOf, dishTotal, summary, allDishCosts, ecoThreshold, isEco, ecoIds, mealCost };
