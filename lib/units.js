// Unites des ingredients et conversion en emballages.
//
// Un ingredient de plat se compte en emballages du produit (unite NULL) ou dans une unite
// de ING_UNITS (g, kg, ml, cl, l, pieces 'pc', tranches 'tr' (= 1 piece), cuilleres a cafe 'cc' = 5 ml, a soupe 'cs' = 15 ml),
// gardee telle quelle pour la recette et ramenee a g / ml / pc (toBase) pour les calculs. La contenance du produit (texte libre : « 500 g », « 1 L », « 6 x 33 cl »,
// « x12 ») donne la taille d'un emballage ; un produit vendu au kg vaut 1000 g, un produit
// a la piece (piece, tete, botte) vaut 1 piece. g et ml sont tenus pour equivalents
// (densite 1). Le poids d'une piece (piece_qty, en g ou ml) relie pieces et poids.
// Sans conversion possible, l'ingredient compte pour 1 emballage (par recette).
const ING_UNITS = ['g', 'kg', 'ml', 'cl', 'l', 'pc', 'tr', 'cc', 'cs'];
const BASE = { g: [1, 'g'], kg: [1000, 'g'], ml: [1, 'ml'], cl: [10, 'ml'], l: [1000, 'ml'], pc: [1, 'pc'], tr: [1, 'pc'], cc: [5, 'ml'], cs: [15, 'ml'] };
const SINGLE = ['pièce', 'tête', 'botte'];
const SCALE = { kg: [1000, 'g'], g: [1, 'g'], gr: [1, 'g'], mg: [0.001, 'g'], l: [1000, 'ml'], dl: [100, 'ml'], cl: [10, 'ml'], ml: [1, 'ml'] };

const num = (s) => Number(String(s).replace(',', '.'));

// « 500 g » -> { n: 500, u: 'g' } ; « 6 x 33 cl » -> { n: 1980, u: 'ml' } ; « x12 » -> { n: 12, u: 'pc' }.
function parseSize(contenance, unit) {
  const s = String(contenance || '').toLowerCase().replace(/\s+/g, ' ').trim();
  let m = s.match(/^(?:(\d+)\s*[x×*]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|gr|g|mg|l|dl|cl|ml)\b/);
  if (m) {
    const [k, u] = SCALE[m[3]];
    return { n: Math.round((m[1] ? Number(m[1]) : 1) * num(m[2]) * k * 1000) / 1000, u };
  }
  m = s.match(/^[x×]\s*(\d+)\b/) || s.match(/^(\d+)\s*(?:[x×]|pi[eè]ces?|pcs?|unit[eé]s?|œufs?|oeufs?|tranches?|rouleaux?|sachets?|capsules?)(?:\s|$)/);
  if (m) return { n: Number(m[1]), u: 'pc' };
  if (unit === 'kg') return { n: 1000, u: 'g' };
  if (SINGLE.includes(unit)) return { n: 1, u: 'pc' };
  return null;
}

// 2 cs -> { qty: 30, unit: 'ml' } ; unite inconnue ou NULL -> inchangee.
function toBase(qty, unit) {
  const b = BASE[unit];
  return b ? { qty: qty == null ? null : Math.round(qty * b[0] * 1000) / 1000, unit: b[1] } : { qty, unit };
}

// Quantite `qty` exprimee en `from` -> unite `to` (null si impossible).
function convert(qty, from, to, pieceQty) {
  const mass = (u) => u === 'g' || u === 'ml';
  if (from === to || (mass(from) && mass(to))) return qty;
  if (!(pieceQty > 0)) return null;
  if (from === 'pc' && mass(to)) return qty * pieceQty;
  if (mass(from) && to === 'pc') return qty / pieceQty;
  return null;
}

// Nombre (fractionnaire) d'emballages pour `qty` `unit` de ce produit ; null si inconvertible.
function packages(qty, unit, product) {
  if (!unit) return qty;
  const size = parseSize(product.contenance, product.unit);
  if (!size) return null;
  const b = toBase(qty, unit);
  const c = convert(b.qty, b.unit, size.u, product.piece_qty);
  return c == null ? null : c / size.n;
}

// Unite saisie (recette ou formulaire) -> { qty, unit } dans ING_UNITS ; unit null = emballage.
function normalizeAmount(qty, unit) {
  const u = String(unit || '').toLowerCase().replace(/\.$/, '').trim();
  const k = (f, to) => ({ qty: qty == null ? null : Math.round(qty * f * 1000) / 1000, unit: to });
  if (!u) return { qty, unit: null };
  if (ING_UNITS.includes(u)) return { qty, unit: u };
  if (/^pi[eè]ces?$/.test(u)) return { qty, unit: 'pc' };
  if (/^tranches?$/.test(u)) return { qty, unit: 'tr' };
  if (/^grammes?$|^gr$/.test(u)) return { qty, unit: 'g' };
  if (/^kilos?$/.test(u)) return { qty, unit: 'kg' };
  if (/^litres?$/.test(u)) return { qty, unit: 'l' };
  if (u === 'mg') return k(0.001, 'g');
  if (u === 'dl') return k(10, 'cl');
  if (/^c\.? ?à ?s|soupe|^cuill[eè]res?$/.test(u)) return { qty, unit: 'cs' };
  if (/^c\.? ?à ?c|caf[eé]/.test(u)) return { qty, unit: 'cc' };
  if (/^verres?$/.test(u)) return k(200, 'ml');
  if (/^tasses?$/.test(u)) return k(250, 'ml');
  return null; // gousse, pincee... : pas d'equivalent sur
}

// 1500 g -> « 1,5 kg » ; 2 pc -> « 2 pièces ».
function fmtAmount(n, u) {
  const r = (x) => String(Math.round(x * 100) / 100).replace('.', ',');
  if (u === 'pc') return `${r(n)} pièce${n > 1 ? 's' : ''}`;
  if (n >= 1000) return `${r(n / 1000)} ${u === 'g' ? 'kg' : 'L'}`;
  return `${r(n)} ${u}`;
}

module.exports = { ING_UNITS, toBase, parseSize, convert, packages, normalizeAmount, fmtAmount };
