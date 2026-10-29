// Prix d'une liste : prix effectif de chaque produit par magasin (promo valable, sinon
// prix moyen), magasin conseille, magasin retenu par article, scenarios « tout chez X »
// et repartition, economie estimee.
const { db } = require('./db');
const { today } = require('./util');
const { parseSize } = require('./units');

// Promos valables pour une liste : celles de cette sortie, ou datees jusqu'a une date
// >= date de la liste (aujourd'hui pour « A prevoir »). La plus recente l'emporte.
function activePromos(hid, list) {
  const ref = (list && list.date) || today();
  const rows = db.prepare(`SELECT id, product_id, store_id, price_cents, list_id, valid_until, note FROM promos
    WHERE household_id = ? AND (list_id = ? OR (valid_until IS NOT NULL AND valid_until >= ?)) ORDER BY created_at`).all(hid, list ? list.id : 0, ref);
  const map = new Map();
  for (const p of rows) map.set(`${p.product_id}:${p.store_id}`, p);
  return map;
}

// Prix effectifs : { [productId]: { [storeId]: { price, avg, promo } } } pour les magasins actifs.
function effectivePrices(hid, productIds, list, stores) {
  const { averages } = require('./catalog');
  const avg = averages(hid);
  const promos = activePromos(hid, list);
  const out = {};
  for (const pid of productIds) {
    const a = avg.get(pid) || {};
    out[pid] = {};
    for (const s of stores) {
      const promo = promos.get(`${pid}:${s.id}`) || null;
      const base = a[s.id] ? a[s.id].avg : null;
      out[pid][s.id] = { price: promo && promo.price_cents != null ? promo.price_cents : base, avg: base, promo, pack: a[s.id] && a[s.id].pack ? { ...a[s.id].pack, price: a[s.id].pack_price } : null };
    }
  }
  return out;
}

// `costs` : cout de la ligne par magasin (null = inconnu).
function bestStore(costs, forcedId, stores) {
  if (forcedId && stores.some((s) => s.id === forcedId)) return forcedId;
  let best = null;
  for (const s of stores) {
    const c = costs[s.id];
    if (c != null && (best == null || c < costs[best])) best = s.id;
  }
  return best;
}

// Complete une liste (getList) : prix et magasin de chaque article, scenarios.
function decorate(hid, list) {
  const stores = db.prepare('SELECT id, name, color FROM stores WHERE household_id = ? AND active = 1 ORDER BY position, id').all(hid);
  const h = db.prepare('SELECT threshold_cents FROM households WHERE id = ?').get(hid);
  const forced = new Map(db.prepare('SELECT id, forced_store_id FROM products WHERE household_id = ?').all(hid).map((p) => [p.id, p.forced_store_id]));
  const refSize = new Map(db.prepare('SELECT id, contenance, unit FROM products WHERE household_id = ?').all(hid).map((p) => [p.id, parseSize(p.contenance, p.unit)]));
  const ids = [...new Set(list.items.map((i) => i.product_id))];
  const prices = effectivePrices(hid, ids, list, stores);
  const activeIds = new Set(stores.map((s) => s.id));
  const main = stores[0] ? stores[0].id : null;

  for (const it of list.items) {
    const pr = prices[it.product_id];
    // Cout de la ligne par magasin. Si le magasin vend un autre format que la reference du produit
    // (sans promo a prix), on achete des emballages entiers : ex. 1 x 100 g demande = 1 sachet de 400 g.
    const ref = refSize.get(it.product_id);
    const costs = {};
    it.packs = {};
    for (const s of stores) {
      const e = pr[s.id];
      if (e.price == null) { costs[s.id] = null; continue; }
      if (e.pack && ref && !(e.promo && e.promo.price_cents != null)) {
        const n = Math.max(1, Math.ceil(it.qty * ref.n / e.pack.n - 1e-9));
        costs[s.id] = n * e.pack.price;
        it.packs[s.id] = { packs: n, size: sizeText(e.pack) };
      } else costs[s.id] = e.price * it.qty;
    }
    // prices = prix par unite de la ligne (x qty = cout reel) : l'interface multiplie par la quantite.
    it.prices = Object.fromEntries(stores.map((s) => [s.id, costs[s.id] == null ? null : costs[s.id] / (it.qty || 1)]));
    it.promos = stores.filter((s) => pr[s.id].promo).map((s) => ({ store_id: s.id, ...pr[s.id].promo }));
    it.best_store_id = bestStore(costs, forced.get(it.product_id), stores);
    it.manual_store = !!(it.store_id && activeIds.has(it.store_id));
    // Magasin retenu : choix manuel (magasin actif), sinon conseil, sinon magasin principal.
    it.at_store_id = it.manual_store ? it.store_id : (it.best_store_id || main);
    // Magasin ou l'article a ete pris (coche) : celui choisi pendant les courses, sinon le magasin retenu.
    it.bought_at = it.status === 'bought' ? (it.bought_store_id || it.at_store_id) : null;
  }

  // Scenarios sur les articles a acheter (hors suggestions en attente, indisponibles et
  // produits supprimes). Prix inconnu dans un magasin : meilleur prix connu ailleurs,
  // compte comme « non estime ».
  const items = list.items.filter((i) => !i.suggestion && i.status !== 'unavailable' && !i.deleted);
  const fallback = (it) => (it.best_store_id ? it.prices[it.best_store_id] : null);
  const perStore = stores.map((s) => {
    let total = 0, unknown = 0;
    for (const it of items) {
      const p = it.prices[s.id] ?? fallback(it);
      if (it.prices[s.id] == null) unknown++;
      if (p != null) total += p * it.qty;
    }
    const mine = items.filter((it) => it.at_store_id === s.id);
    const mineTotal = mine.reduce((n, it) => n + (it.prices[s.id] ?? fallback(it) ?? 0) * it.qty, 0);
    return { id: s.id, name: s.name, color: s.color, total: Math.round(total), unknown, items: mine.length, itemsTotal: Math.round(mineTotal), itemsUnknown: mine.filter((it) => it.prices[s.id] == null).length };
  });
  let split = 0, splitUnknown = 0;
  for (const it of items) {
    const p = it.prices[it.at_store_id] ?? fallback(it);
    if (it.prices[it.at_store_id] == null) splitUnknown++;
    if (p != null) split += p * it.qty;
  }
  const mono = perStore.length ? perStore.reduce((a, b) => (b.total < a.total ? b : a)) : null;
  const saving = mono ? Math.round(mono.total - split) : 0;
  const usedStores = perStore.filter((s) => s.items > 0).length;
  list.pricing = {
    stores: perStore, split: Math.round(split), splitUnknown, monoStoreId: mono ? mono.id : null, saving,
    threshold: h.threshold_cents, recommendSplit: usedStores > 1 && saving >= h.threshold_cents, noPrice: items.filter((it) => !it.best_store_id).length,
  };
  return list;
}

const sizeText = ({ n, u }) => (u === 'pc' ? `${n} pièce${n > 1 ? 's' : ''}` : n >= 1000 ? `${String(n / 1000).replace('.', ',')} ${u === 'g' ? 'kg' : 'L'}` : `${String(n).replace('.', ',')} ${u}`);

// ---------- Promos ----------
function listPromos(hid) {
  return db.prepare(`SELECT pr.id, pr.product_id, pr.store_id, pr.price_cents, pr.list_id, pr.valid_until, pr.note, p.name AS product, l.date AS list_date
    FROM promos pr JOIN products p ON p.id = pr.product_id LEFT JOIN lists l ON l.id = pr.list_id
    WHERE pr.household_id = ? AND ((pr.valid_until IS NOT NULL AND pr.valid_until >= ?) OR (pr.list_id IS NOT NULL AND l.status <> 'closed'))
    ORDER BY p.name_norm`).all(hid, today());
}

module.exports = { decorate, activePromos, listPromos, effectivePrices };
