// Ticket de caisse : du texte lu par Tesseract aux lignes d'achat, puis rapprochement
// avec le catalogue. Module sans dependance (teste par node --test).
//  - ligne « LIBELLE  1,99 » : 1 article a 1,99 ;
//  - quantite « 2 x 0,65  1,30 » sur la ligne ou la suivante (libelle seul juste avant) ;
//  - remise « REMISE -0,50 » / « PROMO » : retiree de l'article precedent, marque promo ;
//  - ticket Collect&Go / Colruyt (PDF) : « 26700 BONI beurre 250g 2 1.89 3.78 » = n° article, libelle,
//    quantite, prix unitaire, montant (point decimal) ; remises sur la ligne suivante ;
//  - totaux, TVA, paiement, en-tetes : ignores.

export function normLabel(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

const SKIP = /\b(total|sous ?total|tva|btw|carte|bancontact|payconiq|maestro|visa|mastercard|especes?|rendu|merci|ticket|caisse|caissier|client|fidelite|points?|epargne|a payer|montant|change|tel|www|siret|bce|tva\s?be|articles?|nombre|heure)\b/;
const PRICE = /(-?\d{1,4}[.,]\d{2})\s*(?:€|eur|[a-d])?\s*$/i;
const QTY = /^\s*(\d{1,3}(?:[.,]\d{1,3})?)\s*[x*×]\s*(\d{1,4}[.,]\d{2})/i;
const DISC = /\b(remise|promo|reduc\w*|ristourne|korting|avantage|actie|bon de reduction)\b/;
const CG = /^(\d{3,7})\s+(.+?)\s+(\d{1,3})\s+(\d{1,4}\.\d{2})\s+(\d{1,4}\.\d{2})$/;
const num = (s) => Number(String(s).replace(',', '.'));
const round2 = (n) => Math.round(n * 100) / 100;

export function parseTicket(text) {
  const rows = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const items = [];
  let date = null, pendingQty = null;
  for (const raw of rows) {
    const low = normLabel(raw);
    if (!date) {
      const d = raw.match(/\b(\d{2})[/.-](\d{2})[/.-](\d{2}|\d{4})\b/);
      if (d) {
        const y = d[3].length === 2 ? '20' + d[3] : d[3];
        const iso = `${y}-${d[2]}-${d[1]}`;
        if (!Number.isNaN(Date.parse(iso)) && +d[2] <= 12 && +d[1] <= 31) date = iso;
      }
    }
    const cg = raw.match(CG);
    if (cg) {
      pendingQty = null;
      items.push({ label: cg[2].trim(), qty: num(cg[3]), unit: num(cg[4]), total: num(cg[5]) });
      continue;
    }
    if (SKIP.test(low)) continue;
    const q = raw.match(QTY);
    const pm = raw.match(PRICE);
    // Ligne de quantite seule : « 2 x 0,65  1,30 »
    if (q && raw.replace(QTY, '').replace(PRICE, '').replace(/[^a-z]/gi, '').length < 3) {
      const qty = num(q[1]), unit = num(q[2]);
      const prev = items[items.length - 1];
      if (prev && prev.waiting) {
        Object.assign(prev, { qty, unit, total: pm ? num(pm[1]) : round2(qty * unit), waiting: false });
      } else {
        pendingQty = { qty, unit };
      }
      continue;
    }
    if (!pm) {
      // Libelle sans prix : la quantite et le prix suivent peut-etre a la ligne suivante.
      if (/[a-z]{3}/.test(low)) items.push({ label: raw, qty: 1, unit: null, total: null, waiting: true });
      continue;
    }
    const price = num(pm[1]);
    let label = raw.slice(0, pm.index).trim();
    if (price < 0 || DISC.test(normLabel(label))) {
      const prev = [...items].reverse().find((i) => i.total != null);
      if (prev) { prev.discount = round2((prev.discount || 0) + Math.abs(price)); prev.promo = true; }
      continue;
    }
    if (!/[a-z]{2}/.test(normLabel(label))) continue;
    let qty = 1, unit = price;
    const qi = label.match(QTY);
    if (qi) { qty = num(qi[1]); unit = num(qi[2]); label = label.replace(QTY, '').trim(); } else if (pendingQty) { ({ qty, unit } = pendingQty); }
    pendingQty = null;
    items.push({ label, qty, unit, total: price });
  }
  return {
    date,
    items: items.filter((i) => i.total != null).map((i) => {
      const total = round2(i.total - (i.discount || 0));
      return { label: i.label, qty: i.qty, unit: i.discount && total > 0 ? round2(total / i.qty) : i.unit, total, promo: !!i.promo };
    }),
  };
}

// Magasin du ticket : nom d'un magasin du foyer present dans le texte.
export function detectStore(text, stores) {
  const t = normLabel(text);
  const s = stores.find((x) => t.includes(normLabel(x.name).split(' ')[0]));
  return s ? s.id : null;
}

const tokens = (s) => normLabel(s).split(' ').filter((t) => t.length >= 3 && /^[a-z]/.test(t));

// Rapprochement : correspondance memorisee pour ce magasin, sinon ressemblance des mots
// (prefixes : « TOMAT CONC » ~ « Tomates concassées »), avec un bonus pour les articles
// de la liste prevus dans ce magasin.
export function matchLines(items, { products, aliases = [], storeId, listItems = [] }) {
  const alias = new Map(aliases.filter((a) => a.store_id === storeId).map((a) => [a.label_norm, a.product_id]));
  const prods = products.map((p) => ({ p, toks: tokens(p.name) }));
  const here = new Set(listItems.filter((i) => i.at_store_id === storeId).map((i) => i.product_id));
  const inList = new Set(listItems.map((i) => i.product_id));
  return items.map((it) => {
    const key = normLabel(it.label);
    if (alias.has(key) && products.some((p) => p.id === alias.get(key))) return { ...it, key, product_id: alias.get(key), how: 'alias' };
    const lt = tokens(it.label);
    const weight = lt.reduce((n, a) => n + Math.min(a.length, 5), 0) || 1;
    let best = null, bestScore = 0;
    for (const { p, toks } of prods) {
      let s = 0;
      for (const a of lt) if (toks.some((b) => b.startsWith(a) || a.startsWith(b))) s += Math.min(a.length, 5);
      if (!s) continue;
      s /= weight;
      if (here.has(p.id)) s += 0.25; else if (inList.has(p.id)) s += 0.1;
      if (s > bestScore) { bestScore = s; best = p; }
    }
    return bestScore >= 0.6 ? { ...it, key, product_id: best.id, how: 'guess' } : { ...it, key, product_id: null, how: null };
  });
}
