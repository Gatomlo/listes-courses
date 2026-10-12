// Import de plats depuis un fichier CSV.
// Colonnes reconnues par leur en-tete (ordre libre, casse et accents ignores) :
//   nom (requis) ; portions ; temps ; repas ; tags ; lien ; ingredients ; etapes ; notes
// repas : « midi, soir », « petit-déjeuner », « collation »… (vide = midi et soir) ;
// tags : separes par « , » ou « | » ; ingredients : separes par « | », chacun « Produit »
// ou « Produit : quantité unité » (« Spaghetti : 500 g | Œufs : 3 pièces | Sel ») ;
// etapes : separees par « | » ou par des retours a la ligne.
// Plat deja connu (meme nom) : seuls ses repas (si la colonne est remplie) et ses tags
// (ajoutes) changent. Produit inconnu : cree (rayon Epicerie, emballage paquet).
const { db, tx, normalize } = require('./db');
const { httpError, str } = require('./util');
const { parseCsv } = require('./csvimport');
const C = require('./catalog');
const U = require('./units');
const M = require('./meals');

const COLS = {
  name: ['nom', 'plat', 'name'], portions: ['portions', 'personnes'], time: ['temps', 'duree'], slots: ['repas', 'creneaux'],
  tags: ['tags', 'tag'], url: ['lien', 'url', 'recette'], ings: ['ingredients'], steps: ['etapes'], notes: ['notes', 'remarques'],
};

// Repas : « déjeuner » et « dîner » sont refuses (sens different en Belgique et en France).
const SLOT_WORDS = [
  [/^(pdj|p\.?-?dej\.?|petit[- ]?dej(euner)?|matin|breakfast)$/, 'pdj'],
  [/^(midi|lunch)$/, 'midi'],
  [/^(soir|souper)$/, 'soir'],
  [/^(coll|collation|gouter|quatre[- ]heures|4 ?h|en[- ]cas)$/, 'coll'],
];
function parseSlots(v) {
  const out = [], bad = [];
  for (const w of String(v).split(/[,|/+]| et /).map((x) => normalize(x).replace(/\s+/g, ' ').trim()).filter(Boolean)) {
    const hit = SLOT_WORDS.find(([re]) => re.test(w));
    if (hit) out.push(hit[1]); else bad.push(w);
  }
  return { slots: out, bad };
}

// « Spaghetti : 500 g » -> { name, qty: 500, unit: 'g' } ; « Ail : 2 gousses » -> 1 emballage + note.
function parseIngredient(raw) {
  const [n, q] = raw.split(/\s*:\s*/, 2);
  const name = str(n, 80);
  if (!q) return { name, qty: 1, unit: null, note: null };
  const m = q.trim().match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
  if (!m) return { name, qty: 1, unit: null, note: str(q, 60) };
  const qty = Number(m[1].replace(',', '.')), a = U.normalizeAmount(qty, m[2]);
  return a ? { name, qty: a.qty, unit: a.unit, note: null } : { name, qty: 1, unit: null, note: str(q, 60) };
}

// dry : rien n'est enregistre, le resume dit ce qui serait fait.
function importDishes(hid, text, { dry = false } = {}) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw httpError(400, 'Fichier vide : une ligne d\'en-tête puis une ligne par plat.');
  if (rows.length > 1001) throw httpError(400, 'Fichier trop long (1000 lignes au plus).');
  const head = rows[0].map((h) => normalize(h).replace(/[_\s]+/g, ' '));
  const col = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]));
  if (col.name < 0) throw httpError(400, 'Colonne « nom » introuvable dans l\'en-tête.');

  const cats = C.categories(hid);
  const defaultCat = (cats.find((c) => normalize(c.name) === normalize('Épicerie')) || cats[0]).id;
  const findDish = db.prepare('SELECT id, slots FROM dishes WHERE household_id = ? AND name_norm = ? AND deleted_at IS NULL');
  const findProduct = db.prepare('SELECT id FROM products WHERE household_id = ? AND name_norm = ? AND deleted_at IS NULL');
  const tagsOf = db.prepare('SELECT t.name FROM dish_tags dt JOIN tags t ON t.id = dt.tag_id WHERE dt.dish_id = ?');
  const out = { created: [], updated: [], products: [], errors: [] };

  const run = () => {
    rows.slice(1).forEach((r, i) => {
      const line = i + 2;
      const v = (k, max = 200) => (col[k] >= 0 ? str(r[col[k]], max) : '');
      const fail = (msg) => out.errors.push({ line, msg });
      const name = str(v('name'), 80);
      if (!name) return fail('nom manquant');
      const { slots, bad } = parseSlots(v('slots'));
      if (bad.length) return fail(`repas « ${bad.join(', ')} » inconnu (petit-déjeuner, midi, soir, collation)`);
      const tags = v('tags', 400).split(/[,|]/).map((t) => str(t.replace(/^#/, ''), 30)).filter(Boolean);
      const url = v('url', 500);
      if (url && !/^https?:\/\//i.test(url)) return fail(`lien « ${url} » invalide (http ou https)`);

      const same = findDish.get(hid, normalize(name));
      if (same) {
        if (slots.length) db.prepare('UPDATE dishes SET slots = ? WHERE id = ?').run(M.slotsText(slots), same.id);
        if (tags.length) M.setDishTags(hid, same.id, [...tagsOf.all(same.id).map((t) => t.name), ...tags]);
        out.updated.push(name);
        return;
      }
      const ings = [];
      for (const raw of v('ings', 4000).split('|').map((x) => x.trim()).filter(Boolean).slice(0, 80)) {
        const g = parseIngredient(raw);
        if (!g.name) continue;
        let pid = (findProduct.get(hid, normalize(g.name)) || {}).id;
        if (!pid) {
          pid = Number(db.prepare(`INSERT INTO products (household_id, name, name_norm, category_id, unit, created_at)
            VALUES (?, ?, ?, ?, 'paquet', ?)`).run(hid, g.name, normalize(g.name), defaultCat, Date.now()).lastInsertRowid);
          out.products.push(g.name);
        }
        if (!ings.some((x) => x.product_id === pid)) ings.push({ ...g, product_id: pid });
      }
      const steps = v('steps', 8000).split(/\s*\|\s*|\r?\n/).map((x) => x.trim()).filter(Boolean).join('\n');
      M.saveDishRaw(hid, {
        name, portions: v('portions'), time_text: v('time'), url, steps, notes: v('notes', 2000),
        ingredients: ings, tags, slots,
      });
      out.created.push(name);
    });
    if (dry) throw DRY;
  };
  try { tx(run); } catch (e) { if (e !== DRY) throw e; }
  return { ...out, dry };
}
const DRY = new Error('dry');

module.exports = { importDishes, parseSlots, parseIngredient };
