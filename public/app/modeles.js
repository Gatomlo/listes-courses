// Modeles de semaine (generation du menu) : editeur de regles partage par l'ecran Foyer
// et le panneau « Générer le menu ». Regle = « exactement » ou « au plus » N repas d'un
// type de plat par semaine, repas vise facultatif.
import { esc, on } from './ui.js';
import { S } from './state.js';
import { I } from './icons.js';

const SLOT = { pdj: 'P.-déj.', midi: 'Midi', soir: 'Soir', coll: 'Collation' };
const SLOT_ORDER = ['pdj', 'midi', 'coll', 'soir'];

// « Exactement 2 × Pâtes (soir) »
export const ruleText = (r) => `${r.mode === 'max' ? 'Au plus' : 'Exactement'} ${r.n} × ${esc(r.type || (S.house.types.find((t) => t.id === r.type_id) || {}).name || '?')}${r.slot ? ` (${SLOT[r.slot].toLowerCase()})` : ''}`;

// Regles en cours d'edition et fonction qui redessine le panneau.
let ed = { rules: [], redraw: () => {} };
export function editRules(rules, redraw) { ed = { rules, redraw }; }

export function rulesHtml() {
  const types = S.house.types || [];
  if (!types.length) return '<p class="muted small">Aucun type de plat : créez-en dans Foyer → Types de plats, puis indiquez-les sur les fiches des plats.</p>';
  return `${ed.rules.map((r, k) => `<div class="card rule" style="padding:8px 10px;margin:6px 0">
      <div class="row gap"><select class="txt sm" style="flex:0 0 8.2em;min-width:0" data-ch="rule-f" data-k="${k}" data-f="mode" aria-label="Règle"><option value="exact" ${r.mode !== 'max' ? 'selected' : ''}>Exactement</option><option value="max" ${r.mode === 'max' ? 'selected' : ''}>Au plus</option></select>
        <input class="txt sm c" style="flex:0 0 3.6em;min-width:0;padding-left:4px;padding-right:4px" type="number" min="0" max="28" value="${r.n}" data-ch="rule-f" data-k="${k}" data-f="n" aria-label="Nombre de repas par semaine">
        <select class="txt sm" style="flex:1 1 0;min-width:0" data-ch="rule-f" data-k="${k}" data-f="type_id" aria-label="Type de plat">${types.map((t) => `<option value="${t.id}" ${t.id === r.type_id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
      <div class="row gap" style="margin-top:6px"><span class="muted small">par semaine,</span><select class="txt sm" style="flex:1 1 0;min-width:0" data-ch="rule-f" data-k="${k}" data-f="slot" aria-label="Repas"><option value="">tous les repas</option>${SLOT_ORDER.map((s) => `<option value="${s}" ${r.slot === s ? 'selected' : ''}>${SLOT[s].toLowerCase()} seulement</option>`).join('')}</select>
        <button class="ib" data-a="rule-del" data-k="${k}" aria-label="Retirer la règle">${I('x', 's')}</button></div></div>`).join('')}
    <button class="btn sec2 sm" data-a="rule-add">＋ Règle</button>`;
}
on('change', 'rule-f', (el) => {
  const r = ed.rules[Number(el.dataset.k)], f = el.dataset.f;
  r[f] = f === 'n' ? Math.min(28, Math.max(0, parseInt(el.value, 10) || 0)) : f === 'type_id' ? Number(el.value) : el.value || null;
  if (f === 'type_id') delete r.type;
});
on('click', 'rule-add', () => { ed.rules.push({ type_id: S.house.types[0].id, n: 1, mode: 'exact', slot: null }); ed.redraw(); });
on('click', 'rule-del', (el) => { ed.rules.splice(Number(el.dataset.k), 1); ed.redraw(); });
// Copie modifiable des regles d'un modele.
export const copyRules = (rules) => (rules || []).map(({ type_id, n, mode, slot }) => ({ type_id, n, mode, slot }));
