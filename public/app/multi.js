// Ajout de plusieurs articles d'un coup (« lait, 2 beurre, œufs ») : decoupe, rapprochement
// avec les produits, apercu avant ajout, produits inconnus crees. Marche hors-ligne (operations).
import { esc, sheet, closeSheet, toast, on } from './ui.js';
import { sync, newOp, attempt } from './api.js';
import { S, isManager, loadProducts } from './state.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// « 2 beurre », « 3x lait », « lait » -> { qty, name }
export function parseMulti(text) {
  return String(text || '').split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean).map((t) => {
    const m = t.match(/^(\d+(?:[.,]\d+)?)\s*(?:x|×)?\s+(.+)$/i);
    return m ? { qty: Number(m[1].replace(',', '.')) || 1, name: m[2].trim() } : { qty: 1, name: t };
  });
}
function match(name) {
  const n = norm(name);
  return S.products.find((p) => norm(p.name) === n) || S.products.find((p) => norm(p.name).startsWith(n)) || S.products.find((p) => norm(p.name).includes(n)) || null;
}

let pending = null; // { listId, entries, after }
const preview = () => sheet(`<h3>${isManager() ? 'Ajouter' : 'Suggérer'} ${pending.entries.length} article${pending.entries.length > 1 ? 's' : ''}</h3>
  <div class="group tiles">${pending.entries.map((e) => `<div class="item"><span class="grow"><b>${e.qty !== 1 ? `${String(e.qty).replace('.', ',')} × ` : ''}${esc(e.product ? e.product.name : e.name)}</b></span>${e.product ? '' : '<span class="pill p-carrot">nouveau produit</span>'}</div>`).join('')}</div>
  <div class="row end"><button class="btn sec2" data-a="close">Annuler</button><button class="btn" data-a="multi-ok">Ajouter</button></div>`);

// listId : liste ou ajouter ; after : rappel apres l'ajout (rechargement de l'ecran).
export async function multiAdd(listId, text, after) {
  const entries = parseMulti(text);
  if (!entries.length) return false;
  if (!S.products) await loadProducts();
  entries.forEach((e) => { e.product = match(e.name); });
  pending = { listId, entries, after };
  // Un seul produit connu : ajout direct ; sinon apercu.
  if (entries.length === 1 && entries[0].product) { await commit(); return true; }
  preview();
  return true;
}
async function commit() {
  const { listId, entries, after } = pending; pending = null;
  const cat = (S.house.categories[0] || {}).id;
  const ops = entries.map((e) => (e.product
    ? newOp({ type: 'item.add', list_id: listId, product_id: e.product.id, qty: e.qty })
    : newOp({ type: 'product.add', name: e.name, category_id: cat, unit: 'paquet', list_id: listId, qty: e.qty })));
  closeSheet();
  const r = await attempt(() => sync(S.me.householdId, ops));
  if (r === undefined) return;
  toast(isManager() ? `${entries.length} article${entries.length > 1 ? 's' : ''} ajouté${entries.length > 1 ? 's' : ''}` : 'Suggestion envoyée au gestionnaire');
  if (entries.some((e) => !e.product)) loadProducts().catch(() => {});
  if (after) await after();
}
on('click', 'multi-ok', () => commit());
