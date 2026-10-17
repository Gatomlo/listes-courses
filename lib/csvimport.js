// Import de produits (et de releves de prix) depuis un fichier CSV.
// Colonnes reconnues par leur en-tete (ordre libre, casse et accents ignores) :
//   nom (requis) ; rayon ; emballage ; contenance ; magasin ; prix ; promo ; prix normal ; date
// Separateur « ; » ou « , » (deduit de l'en-tete), guillemets doubles, decimales « , » ou « . ».
// Produit existant (meme nom) : ses caracteristiques ne changent pas, seuls les releves
// sont ajoutes. Rayon inconnu : cree en fin de parcours. Releve identique (magasin, date,
// prix, promo) : ignore, donc reimporter le meme fichier ne double rien.
const { db, tx, normalize } = require('./db');
const { httpError, str, cents, isoDate, today } = require('./util');
const C = require('./catalog');

const COLS = {
  name: ['nom', 'produit', 'name'], rayon: ['rayon', 'categorie'], sub: ['sous-rayon', 'sous rayon', 'sousrayon'], unit: ['emballage', 'unite'],
  contenance: ['contenance'], store: ['magasin'], price: ['prix', 'prix paye'], promo: ['promo'],
  normal: ['prix normal', 'prix_normal'], date: ['date'],
};

// Texte CSV -> tableau de lignes (tableaux de cellules).
function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0];
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}

const yes = (v) => ['1', 'oui', 'o', 'x', 'yes', 'y', 'vrai', 'true', 'promo'].includes(normalize(v));
// AAAA-MM-JJ ou JJ/MM/AAAA (ou JJ-MM-AAAA).
function csvDate(v) {
  const s = str(v, 20);
  if (!s) return today();
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return isoDate(m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s);
}

// dry : rien n'est enregistre, le resume dit ce qui serait fait.
function importProducts(hid, userId, text, { dry = false } = {}) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw httpError(400, 'Fichier vide : une ligne d\'en-tête puis une ligne par produit.');
  if (rows.length > 2001) throw httpError(400, 'Fichier trop long (2000 lignes au plus).');
  const head = rows[0].map((h) => normalize(h).replace(/[_\s]+/g, ' '));
  const col = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]));
  if (col.name < 0) throw httpError(400, 'Colonne « nom » introuvable dans l\'en-tête.');

  const stores = new Map(C.stores(hid).map((s) => [normalize(s.name), s]));
  const cats = new Map(C.categories(hid).map((c) => [normalize(c.name), c.id]));
  const defaultCat = cats.get(normalize('Épicerie')) || C.categories(hid)[0].id;
  const findProduct = db.prepare('SELECT id FROM products WHERE household_id = ? AND name_norm = ? AND deleted_at IS NULL');
  const sameRecord = db.prepare('SELECT 1 FROM price_records WHERE product_id = ? AND store_id = ? AND date = ? AND price_cents = ? AND promo = ?');
  const addRecord = db.prepare(`INSERT INTO price_records (product_id, store_id, price_cents, date, source, promo, user_id, created_at)
    VALUES (?, ?, ?, ?, 'manual', ?, ?, ?)`);
  const out = { created: [], existing: 0, categories: [], records: 0, skipped: 0, errors: [] };

  const run = () => {
    rows.slice(1).forEach((r, i) => {
      const line = i + 2;
      const v = (k) => (col[k] >= 0 ? str(r[col[k]], 200) : '');
      const fail = (msg) => out.errors.push({ line, msg });
      const name = str(v('name'), 80);
      if (!name) return fail('nom manquant');
      // Releves de la ligne, verifies avant toute ecriture.
      const recs = [];
      const price = cents(v('price')), normal = cents(v('normal'));
      let store = null, date = null;
      if (price || normal) {
        store = stores.get(normalize(v('store')));
        if (!store) return fail(v('store') ? `magasin « ${v('store')} » inconnu` : 'prix sans magasin');
        date = csvDate(v('date'));
        if (!date) return fail(`date « ${v('date')} » invalide (AAAA-MM-JJ ou JJ/MM/AAAA)`);
        if (price) recs.push([price, yes(v('promo')) ? 1 : 0]);
        if (normal && (!price || yes(v('promo')))) recs.push([normal, 0]);
      } else if (v('price')) return fail(`prix « ${v('price')} » invalide`);

      let pid = (findProduct.get(hid, normalize(name)) || {}).id;
      if (pid) out.existing++;
      else {
        let cid = defaultCat;
        const rayon = str(v('rayon'), 60);
        if (rayon) {
          cid = cats.get(normalize(rayon));
          if (!cid) { cid = C.insertCategory(hid, rayon); cats.set(normalize(rayon), cid); out.categories.push(rayon); }
        }
        const unitIn = normalize(v('unit'));
        const unit = C.UNITS.find((u) => normalize(u) === unitIn) || 'paquet';
        // Sous-rayon facultatif : cree dans le rayon du produit s'il n'existe pas.
        let sub = null;
        const subName = str(v('sub'), 60);
        if (subName) {
          sub = (db.prepare('SELECT id FROM subcategories WHERE category_id = ? AND name = ? COLLATE NOCASE').get(cid, subName) || {}).id
            || Number(db.prepare('INSERT INTO subcategories (household_id, category_id, name) VALUES (?, ?, ?)').run(hid, cid, subName).lastInsertRowid);
        }
        pid = Number(db.prepare(`INSERT INTO products (household_id, name, name_norm, category_id, subcategory_id, unit, contenance, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(hid, name, normalize(name), cid, sub, unit, str(v('contenance'), 30) || null, Date.now()).lastInsertRowid);
        out.created.push(name);
      }
      for (const [pc, promo] of recs) {
        if (sameRecord.get(pid, store.id, date, pc, promo)) { out.skipped++; continue; }
        addRecord.run(pid, store.id, pc, date, promo, userId, Date.now());
        out.records++;
      }
    });
    if (dry) throw DRY;
  };
  try { tx(run); } catch (e) { if (e !== DRY) throw e; }
  return { ...out, dry };
}
const DRY = new Error('dry');

module.exports = { parseCsv, importProducts };
