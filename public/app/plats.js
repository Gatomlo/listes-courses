// Plats : liste (recherche par nom ou ingredient, filtres), fiche (informations,
// ingredients, recette facultative avec import depuis un lien, menu et historique).
import { esc, eur, fmtDate, on, acc, sheet, closeSheet, confirmSheet, toast, formData, isPc, localDay } from './ui.js';
import { get, post, put, patch, del, attempt } from './api.js';
import { S, hp, isManager, render, go, loadHouse, loadProducts, catName, categoryOrder } from './state.js';
import { matchLines } from './ticket.mjs';
import { micButton, stopDictation } from './multi.js';
import { packBlock, unitOptions, catOptions, catSubOptions, contField } from './catalogue.js';
import { I, btnI } from './icons.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const today = () => localDay();
const daysAgo = (d) => Math.round((Date.parse(today()) - Date.parse(d)) / 864e5);
export const SLOT = { pdj: 'P.-déj.', midi: 'Midi', soir: 'Soir', coll: 'Collation' };
// Repas possibles d'un plat (generation du menu) ; sans choix = midi et soir.
export const SLOT_ORDER = ['pdj', 'midi', 'coll', 'soir'];
const slotsLabel = (v) => SLOT_ORDER.filter((k) => (v || ['midi', 'soir']).includes(k)).map((k) => SLOT[k]).join(', ');
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };
const fmtQ = (q) => String(Math.round(q * 10) / 10).replace('.', ',');
// Unite d'un ingredient : NULL = emballages du produit, sinon comme lib/units.js (ING_UNITS) ;
// BASEU = unite de calcul (g et ml equivalents).
const IUNITS = [['g', 'g'], ['kg', 'kg'], ['ml', 'ml'], ['cl', 'cl'], ['l', 'L'], ['pc', 'pièce'], ['cc', 'CC'], ['cs', 'CS']];
const BASEU = { g: 'g', kg: 'g', ml: 'ml', cl: 'ml', l: 'ml', pc: 'pc', cc: 'ml', cs: 'ml' };
const iunitLabel = (i) => (i.iunit ? IUNITS.find(([k]) => k === i.iunit)[1] : i.unit);
const amountText = (q, i) => (i.iunit === 'g' && q >= 1000 ? `${fmtQ(q / 1000)} kg` : i.iunit === 'ml' && q >= 1000 ? `${fmtQ(q / 1000)} L` : `${fmtQ(q)} ${iunitLabel(i)}${i.iunit === 'pc' && q > 1 ? 's' : ''}`);
// Conversion possible en emballages (meme regle que lib/units.js, g et ml equivalents).
function convertible(i) {
  if (!i.iunit) return true;
  const p = (S.products || []).find((x) => x.id === i.product_id);
  if (!p) return i.conv !== false;
  if (!p.size) return false;
  const mass = (u) => u === 'g' || u === 'ml';
  const u = BASEU[i.iunit];
  return p.size.u === u || (mass(p.size.u) && mass(u)) || p.piece_qty > 0;
}

// Types de plats : ceux du foyer et ceux du plat edite.
const allTypes = () => [...new Set([...(S.house.types || []).map((t) => t.name), ...(ed ? ed.types : [])])].sort((a, b) => a.localeCompare(b, 'fr'));
export async function loadDishes() { S.dishes = await get(hp('/dishes')); }
// Tags connus : ceux du foyer (S.house.tags) et ceux des plats charges.
export const allTags = () => [...new Set([...(S.house.tags || []).map((t) => t.name), ...(S.dishes || []).flatMap((d) => d.tags)])].sort((a, b) => a.localeCompare(b, 'fr'));
// Cout estime par personne (centimes, NULL si inconnu) : « ≈ 1,08 € / pers. », « dès 0,75 € » si des ingredients n'ont pas de prix.
export const ppShort = (d) => (d.cost_pp == null ? '' : `${d.cost_partial ? 'dès ' : '≈ '}${eur(d.cost_pp)}`);
export const ppLabel = (d) => (d.cost_pp == null ? '' : `${ppShort(d)} / pers.`);
const PRICES = [['', 'Tous'], ['2', '≤ 2 €'], ['3', '≤ 3 €'], ['4', '≤ 4 €'], ['5', '≤ 5 €'], ['over', '> 5 €'], ['unk', 'Sans prix']];
const priceOk = (d, k) => !k || (k === 'unk' ? d.cost_pp == null : k === 'over' ? d.cost_pp != null && d.cost_pp > 500 : d.cost_pp != null && d.cost_pp <= Number(k) * 100);
// Pastilles de filtre par tag (action « act », tag actif « cur »).
export const tagChips = (act, cur) => {
  const ts = allTags();
  return ts.length ? `<div class="opt tags">${ts.map((t) => `<button class="${cur === t ? 'on' : ''}" data-a="${act}" data-t="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : '';
};

// ---------- Liste des plats ----------
// Vignette d'un plat : teinte tiree du nom, initiale, pastilles.
const hue = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
// Avec photo (adresse de l'API, ou image en attente d'enregistrement) : la photo remplace l'initiale.
const photoSrc = (p) => (!p ? '' : /^(data:|https?:)/.test(p) ? p : `api/${p}`);
export const tile = (name, pills = '', cls = '', photo = null) => `<div class="tile ${cls}${photo ? ' ph' : ''}" style="--h:${hue(name)}${photo ? `;background-image:url('${esc(photoSrc(photo)).replace(/'/g, '%27')}')` : ''}"><span class="mono-l">${esc(String(name || '?')[0].toUpperCase())}</span><div class="tb">${pills}</div></div>`;
const FILTERS = [['all', 'Tous'], ['wish', 'Envies'], ['recipe', 'Avec recette'], ['parts', 'Composés'], ['planned', 'Au menu'], ['memo', 'Sans détail'], ['draft', 'À valider']];
// Plats retenus par la recherche et les filtres (S.q : dish, dishFilter, dishSlot, dishType, dishTag).
function filteredDishes() {
  const f = S.q.dishFilter || 'all', tg = S.q.dishTag || '', ty = S.q.dishType || '', sl = S.q.dishSlot || '';
  const n = norm(S.q.dish || '').trim();
  return S.dishes.filter((d) => (!n || norm(d.name).includes(n) || d.tags.some((x) => norm(x).includes(n)) || (d.types || []).some((x) => norm(x).includes(n)) || d.ingredient_names.some((x) => norm(x).includes(n)) || (d.part_names || []).some((x) => norm(x).includes(n)))
    && (!tg || d.tags.includes(tg)) && priceOk(d, S.q.dishPrice) && (!ty || (d.types || []).includes(ty)) && (!sl || (d.slots || []).includes(sl))
    && (f === 'all' || (f === 'wish' && d.wish) || (f === 'recipe' && d.has_recipe) || (f === 'memo' && !d.ingredients && !d.parts) || (f === 'planned' && d.next_date) || (f === 'draft' && d.draft) || (f === 'parts' && d.parts)));
}
// Filtres actifs : [cle de S.q, libelle].
const activeFilters = () => [
  ...(S.q.dishFilter && S.q.dishFilter !== 'all' ? [['dishFilter', FILTERS.find(([k]) => k === S.q.dishFilter)[1]]] : []),
  ...(S.q.dishSlot ? [['dishSlot', SLOT[S.q.dishSlot]]] : []),
  ...(S.q.dishType ? [['dishType', S.q.dishType]] : []),
  ...(S.q.dishTag ? [['dishTag', `#${S.q.dishTag}`]] : []),
  ...(S.q.dishPrice ? [['dishPrice', `Prix ${PRICES.find(([k]) => k === S.q.dishPrice)[1]} / pers.`]] : []),
];
export function platsView() {
  const q = S.q.dish || '', f = S.q.dishFilter || 'all', tg = S.q.dishTag || '', ty = S.q.dishType || '', sl = S.q.dishSlot || '';
  const n = norm(q).trim();
  const list = filteredDishes(), act = activeFilters();
  const card = (d) => {
    const hits = n && !norm(d.name).includes(n) ? [...(d.part_names || []), ...d.ingredient_names].filter((x) => norm(x).includes(n)) : [];
    const pills = `${d.cost_pp != null ? `<span class="pill" title="Coût estimé par personne${d.cost_partial ? ' (des ingrédients n’ont pas de prix)' : ''}">${esc(ppShort(d))}</span>` : ''}${d.wish ? `<span class="pill" title="Envie">${I('bulb', 's')}</span>` : ''}${d.parts ? `<span class="pill">${I('puzzle', 's')} ${d.parts}</span>` : ''}${d.has_recipe ? `<span class="pill">${I('book', 's')}</span>` : ''}${d.draft ? `<span class="pill">${I('edit', 's')}</span>` : ''}`;
    // Tags en badges sur la photo : 3 au plus, puis « +N ».
    const tags = d.tags.slice(0, 3).map((t) => `<span class="pill">#${esc(t)}</span>`).join('') + (d.tags.length > 3 ? `<span class="pill">+${d.tags.length - 3}</span>` : '');
    return `<a class="dcard" href="#/plats/${d.id}">${tile(d.name, pills + tags, '', d.photo)}<div><h4>${esc(d.name)}</h4>
      <div class="muted small">${hits.length ? 'contient ' + esc(hits.join(', ')) : d.next_date ? `<span style="color:var(--leaf);font-weight:600">prévu ${esc(fmtDate(d.next_date, { weekday: 'short', day: 'numeric' }))}</span>` : d.last_date ? `il y a ${daysAgo(d.last_date)} j` : 'jamais servi'}</div></div></a>`;
  };
  const search = `<div class="search grow">${I('search')}<input class="txt" id="dish-q" placeholder="Plat, ingrédient, recette…" value="${esc(q)}" data-in="dish-q"></div>`;
  // Un seul bouton de filtres (a cote de la recherche) ouvre un panneau ; filtres actifs en pastilles retirables.
  const filters = `<div class="row gap">${search}<button class="btn sec2 fbtn" data-a="dish-filters" aria-label="Filtres">${I('sliders')}${act.length ? `<span class="badge">${act.length}</span>` : ''}</button>${act.length ? `<button class="btn sec2 fbtn" data-a="dish-unfilter" aria-label="Effacer les filtres">${I('x')}</button>` : ''}</div>`;
  return {
    title: 'Plats', sub: act.length ? `${list.length} plat${list.length > 1 ? 's' : ''} · ${act.map(([, t]) => t).join(' · ')}` : `${S.dishes.length} plat${S.dishes.length > 1 ? 's' : ''} du foyer`, large: true,
    right: isManager() ? `<button class="ib" data-a="dish-csv-open" aria-label="Importer des plats (CSV)" title="Importer des plats (CSV)">${I('upload')}</button><a class="ib" href="#/plats/nouveau" aria-label="Nouveau plat">${I('plus')}</a>` : '',
    body: `${filters}
      <div class="dgrid" style="margin-top:8px">${list.map(card).join('')}</div>
      ${list.length ? '' : `<div class="empty">Aucun plat trouvé.${isManager() && q ? `<br><button class="btn" style="margin-top:10px" data-a="dish-new-named">＋ Créer le plat « ${esc(q)} »</button>` : ''}</div>`}`,
  };
}
on('click', 'dish-unset', (el) => { S.q[el.dataset.k] = ''; render(); });

// ---------- Panneau des filtres (telephone) ----------
// Vue principale : affichage, repas, puis Type et Tag comme lignes qui ouvrent une liste
// avec recherche (trop nombreux pour des pastilles). Applique en direct.
let fview = 'main', fq = '';
// Liste de choix d'un type ou d'un tag (panneau telephone, menu deroulant PC) : « Tous »,
// puis les valeurs filtrees par la recherche, avec leur nombre de plats.
const pickAll = (kind) => (kind === 'type' ? (S.house.types || []).map((t) => t.name) : allTags());
function pickRows(kind, search, act) {
  const key = kind === 'type' ? 'dishType' : 'dishTag', all = pickAll(kind), q = norm(search).trim();
  const count = (v) => S.dishes.filter((d) => (kind === 'type' ? d.types || [] : d.tags).includes(v)).length;
  const row = (v, label, c) => `<button class="item click" data-a="${act}" data-k="${key}" data-v="${esc(v)}"><span class="grow">${label}</span>${c != null ? `<span class="muted small">${c}</span>` : ''}${(S.q[key] || '') === v ? I('check', 's') : ''}</button>`;
  const items = all.filter((v) => !q || norm(v).includes(q));
  return `${q ? '' : row('', `<b>${kind === 'type' ? 'Tous les types' : 'Tous les tags'}</b>`)}
    ${items.map((v) => row(v, esc(kind === 'tag' ? `#${v}` : v), count(v))).join('') || `<p class="muted" style="padding:12px 14px;margin:0">${all.length ? 'Aucun résultat.' : kind === 'type' ? 'Aucun type : à créer dans Foyer.' : 'Aucun tag.'}</p>`}`;
}

const CLOSE = '<button class="ib x" data-a="close" aria-label="Fermer"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
function filterSheet() {
  const n = filteredDishes().length;
  let html;
  if (fview === 'main') {
    const pick = (label, k, cur, empty) => `<button class="item click" data-a="fs-view" data-v="${k}"><span class="grow"><b>${label}</b><span class="muted block">${cur ? esc(cur) : empty}</span></span>${I('chev', 's chev')}</button>`;
    html = `<h3>${I('sliders', 's')} Filtres</h3>
      <div class="sec">Afficher</div><div class="opt wrap">${FILTERS.map(([k, t]) => `<button class="${(S.q.dishFilter || 'all') === k ? 'on' : ''}" data-a="fs-set" data-k="dishFilter" data-v="${k}">${t}</button>`).join('')}</div>
      <div class="sec">Repas</div><div class="seg">${SLOT_ORDER.map((k) => `<button class="${S.q.dishSlot === k ? 'on' : ''}" data-a="fs-set" data-k="dishSlot" data-v="${k}">${SLOT[k]}</button>`).join('')}</div>
      <div class="sec">Prix par personne</div><div class="opt wrap">${PRICES.filter(([k]) => k).map(([k, t]) => `<button class="${S.q.dishPrice === k ? 'on' : ''}" data-a="fs-set" data-k="dishPrice" data-v="${k}">${t}</button>`).join('')}</div>
      <div class="group" style="margin-top:14px">${pick('Type', 'type', S.q.dishType, 'Tous les types')}${pick('Tag', 'tag', S.q.dishTag && `#${S.q.dishTag}`, 'Tous les tags')}</div>
      <div class="row gap" style="margin-top:14px">${activeFilters().length ? `<button class="btn sec2" data-a="fs-clear">Effacer</button>` : ''}<button class="btn grow" data-a="close">Voir ${n} plat${n > 1 ? 's' : ''}</button></div>`;
  } else {
    html = `<div class="row"><button class="ib" data-a="fs-view" data-v="main" aria-label="Retour">${I('back')}</button><h3 style="margin:0">${fview === 'type' ? 'Type' : 'Tag'}</h3></div>
      ${pickAll(fview).length > 6 ? `<div class="search" style="margin:10px 0">${I('search')}<input class="txt" id="fs-q" placeholder="Rechercher…" value="${esc(fq)}" data-in="fs-q"></div>` : ''}
      <div class="group fs-list">${pickRows(fview, fq, 'fs-pick')}</div>`;
  }
  const el = document.querySelector('.sheet.dfs');
  if (el) el.innerHTML = CLOSE + html; else sheet(html).classList.add('dfs');
}
on('click', 'dish-filters', () => { fview = 'main'; fq = ''; filterSheet(); });
on('click', 'fs-view', (el) => { fview = el.dataset.v; fq = ''; filterSheet(); });
on('click', 'fs-set', (el) => { const k = el.dataset.k; S.q[k] = S.q[k] === el.dataset.v ? '' : el.dataset.v; render(); filterSheet(); });
on('click', 'fs-pick', (el) => { S.q[el.dataset.k] = el.dataset.v; fview = 'main'; fq = ''; render(); filterSheet(); });
on('click', 'fs-clear', () => { S.q.dishPrice = ''; S.q.dishFilter = ''; S.q.dishSlot = ''; S.q.dishType = ''; S.q.dishTag = ''; render(); filterSheet(); });
on('input', 'fs-q', (el) => { fq = el.value; filterSheet(); const i = document.getElementById('fs-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
on('input', 'dish-q', (el) => { S.q.dish = el.value; render(); const i = document.getElementById('dish-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
on('click', 'dish-filter', (el) => { S.q.dishFilter = el.dataset.f; render(); });
on('click', 'dish-price', (el) => { S.q.dishPrice = S.q.dishPrice === el.dataset.k ? '' : el.dataset.k; render(); });
on('click', 'dish-slot', (el) => { S.q.dishSlot = S.q.dishSlot === el.dataset.t ? '' : el.dataset.t; render(); });
on('click', 'dish-unfilter', () => { S.q.dishPrice = ''; S.q.dishFilter = ''; S.q.dishTag = ''; S.q.dishType = ''; S.q.dishSlot = ''; render(); });
on('click', 'dish-new-named', () => { pendingName = S.q.dish; go('#/plats/nouveau'); });

// ---------- Import CSV de plats (gestionnaire) : apercu puis import ----------
const DCSV_HEAD = 'nom;portions;temps;repas;types;tags;lien;ingrédients;variantes;étapes;notes';
let dcsvText = '';
on('click', 'dish-csv-open', () => {
  dcsvText = '';
  sheet(`<h3>${I('upload', 's')} Importer des plats</h3>
    <p class="muted small">Fichier CSV (séparateur « ; » ou « , »), une ligne d'en-tête puis un plat par ligne :<br><code style="word-break:break-all">${DCSV_HEAD}</code></p>
    <p class="muted small">Seul <b>nom</b> est obligatoire. <b>repas</b> : petit-déjeuner, midi, soir, collation (plusieurs séparés par « , » ; vide = midi et soir). <b>types</b> (poisson, pâtes…) et <b>tags</b> séparés par « , » ou « | ».
      <b>ingrédients</b> séparés par « | », chacun « Produit » ou « Produit : quantité unité » (ex. <code>Spaghetti : 500 g | Œufs : 3 pièces | Sel</code>) ; produit inconnu : créé. <b>variantes</b> : groupes séparés par « | », chacun « Groupe : option / option », ingrédients d’une option entre parenthèses séparés par « + » (ex. <code>Viande : saucisse (Saucisse : 4 pièces) / haché (Haché : 400 g) | Légume : carottes / épinards</code>). <b>étapes</b> séparées par « | ».
      Plat déjà connu : seuls ses repas, ses types et ses tags sont complétés (ingrédients et variantes inchangés). Réimporter le même fichier ne double rien.</p>
    <button class="btn sec2 sm" data-a="dish-csv-model">Télécharger un modèle</button>
    <label class="muted" style="display:block;margin-top:10px">Fichier</label><input class="txt" type="file" accept=".csv,text/csv,text/plain" data-ch="dish-csv-file">
    <div id="dcsv-res"></div>`);
});
on('click', 'dish-csv-model', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + DCSV_HEAD + '\r\n'
    + 'Spaghetti bolognaise;4;45 min;midi, soir;pâtes, bœuf;rapide;;Spaghetti : 500 g | Haché : 400 g | Tomates pelées : 2 | Oignon : 1 pièce | Ail : 2 gousses;;Faire revenir l\'oignon | Ajouter le haché puis les tomates | Cuire les pâtes;\r\n'
    + 'Pancakes;4;20 min;petit-déjeuner, collation;;sucré;;Farine : 250 g | Lait : 50 cl | Œufs : 2 pièces;Garniture : sucre / chocolat (Pâte à tartiner : 1) / fruits (Fraises : 250 g);;\r\n'
    + 'Soupe de légumes;6;1 h;soir;soupe;hiver, végé;https://exemple.be/soupe;;;;Se congèle bien\r\n'
    + 'Stoemp;4;40 min;midi, soir;belge;hiver;;Pommes de terre : 1 kg | Beurre : 50 g;Viande : saucisse (Saucisse : 4 pièces) / boulettes (Haché : 500 g + Chapelure : 1) | Légume : carottes (Carottes : 600 g) / poireaux (Poireaux : 2 pièces);Cuire les pommes de terre et le légume | Écraser avec le beurre | Servir avec la viande;\r\n'], { type: 'text/csv' }));
  a.download = 'modele-plats.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
const dcsvSummary = (r) => `<div class="card" style="margin-top:10px">
  <p><b>${r.created.length}</b> plat${r.created.length > 1 ? 's' : ''} ${r.dry ? 'à créer' : 'créé' + (r.created.length > 1 ? 's' : '')} · <b>${r.updated.length}</b> déjà connu${r.updated.length > 1 ? 's' : ''} (repas, types et tags complétés)${r.products.length ? ` · ${plural(r.products.length, 'produit')} ${r.dry ? 'à créer' : 'créé' + (r.products.length > 1 ? 's' : '')}` : ''}</p>
  ${r.created.length ? `<p class="muted small">${r.created.map(esc).join(' · ')}</p>` : ''}
  ${r.products.length ? `<p class="small">Nouveaux produits (rayon Épicerie, à compléter) : ${r.products.map(esc).join(', ')}</p>` : ''}
  ${r.errors.length ? `<p class="small" style="color:var(--danger)">${plural(r.errors.length, 'ligne')} ignorée${r.errors.length > 1 ? 's' : ''} :<br>${r.errors.map((e) => `ligne ${e.line} : ${esc(e.msg)}`).join('<br>')}</p>` : ''}</div>`;
on('change', 'dish-csv-file', async (el) => {
  const file = el.files && el.files[0];
  if (!file) return;
  dcsvText = await file.text();
  const r = await attempt(() => post(hp('/dishes/import'), { csv: dcsvText, dry: true }));
  if (!r) return;
  document.getElementById('dcsv-res').innerHTML = dcsvSummary(r) + (r.created.length || r.updated.length
    ? '<div class="row end" style="margin-top:10px"><button class="btn" data-a="dish-csv-go">Importer</button></div>'
    : '<p class="muted small">Rien à importer.</p>');
});
on('click', 'dish-csv-go', async () => {
  const r = await attempt(() => post(hp('/dishes/import'), { csv: dcsvText }));
  if (!r) return;
  S.products = null;
  await Promise.all([loadDishes(), loadHouse(), loadProducts()]);
  render();
  document.getElementById('dcsv-res').innerHTML = dcsvSummary(r);
  toast(`${plural(r.created.length, 'plat')} importé${r.created.length > 1 ? 's' : ''}${r.updated.length ? `, ${r.updated.length} complété${r.updated.length > 1 ? 's' : ''}` : ''}`);
});

// ---------- Fiche plat ----------
let ed = null;          // plat en cours d'edition
let pendingName = '';
// Creation depuis le menu : S.dishReturn = { date, slot } ; apres enregistrement, retour au menu.
export function newDishFrom(name, ret) { pendingName = name || ''; S.dishReturn = ret; go('#/plats/nouveau'); }
export async function loadDish(id) {
  // Fiche en lecture a chaque ouverture, sauf lien « modifier » (S.q.openEdit).
  S.q.deditId = S.q.openEdit && String(S.q.openEdit) === String(id) ? Number(id) : null;
  S.q.openEdit = null;
  if (!S.products) await loadProducts();
  if (id === 'nouveau') {
    ed = { id: null, name: pendingName || '', slots: ['midi', 'soir'], types: [], portions: 4, time_text: '', url: '', steps: '', notes: '', ahead: '', ingredients: [], groups: [], parts: [], used_in: [], tags: [], upcoming: [], past: [], times: 0 };
    pendingName = '';
  } else {
    S.dishReturn = null;
    const d = await get(hp(`/dishes/${id}`));
    ed = { parts: [], used_in: [], ...d, steps: d.steps || '', notes: d.notes || '', ahead: d.ahead || '', url: d.url || '', time_text: d.time_text || '' };
  }
}
export const currentDish = () => ed;
on('click', 'dish-wish', async () => {
  if (!await attempt(() => post(hp('/wishes'), { dish_id: ed.id }))) return;
  toast(isManager() ? 'Envie ajoutée' : 'Envie proposée'); S.wishes = null; S.dishes = null; await Promise.all([loadDish(ed.id), loadHouse()]); render();
});
on('click', 'dish-unwish', async () => {
  if (!await attempt(() => del(hp(`/wishes/${ed.wish_id}`)))) return;
  toast('Envie retirée'); S.wishes = null; S.dishes = null; await Promise.all([loadDish(ed.id), loadHouse()]); render();
});

// Fiche : vignette et informations, puis onglets Ingredients / Recette / Composition /
// Historique ; « Cuisiner » et « Ajouter au menu » en bas d'ecran.
export function dishView() {
  // Brouillon : modifiable par le membre qui l'a propose tant qu'il n'est pas valide.
  // Fiche en lecture par defaut ; « Modifier » passe en edition (nouveau plat : edition).
  const mgr = isManager(), canEdit = mgr || !!(ed.draft && ed.draft_by === S.me.id);
  const ro = !canEdit || (!!ed.id && S.q.deditId !== ed.id);
  const ingRows = (t, empty) => ingsOf(t).map((i, k) => `<div class="item${ro ? '' : ' ing-ed'}"><span class="grow">${esc(i.name)}${i.note ? ` <span class="muted small">· ${esc(i.note)}</span>` : ''}${i.is_base ? ' <span class="pill p-grey">de base</span>' : ''}</span>
    ${ro ? `<b class="price">${i.qty != null ? esc(amountText(i.qty, i)) : '<span class="muted fw4">selon goût</span>'}</b>${i.cost != null ? `<span class="muted small" style="min-width:46px;text-align:right">≈ ${eur(i.cost)}</span>` : ''}` : `<input class="txt w5 sm c" value="${i.qty != null ? fmtQ(i.qty) : ''}" placeholder="—" data-ch="ing-qty" data-t="${t}" data-k="${k}"><select class="txt sm w6" data-ch="ing-unit" data-t="${t}" data-k="${k}" aria-label="Unité">${[['', i.unit], ...IUNITS].map(([v, l]) => `<option value="${v}" ${(i.iunit || '') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`}
    ${i.is_base || convertible(i) ? '' : mgr ? `<button class="pill p-carrot cont" data-a="ing-cont" data-id="${i.product_id}" aria-label="Contenance ?" title="Indiquer la contenance de l'emballage (ex. 500 g) ou le poids d'une pièce ; en attendant : 1 ${esc(i.unit)}">${I('box', 's')}</button>` : `<span class="pill p-carrot cont" aria-label="Contenance ?" title="Contenance du produit inconnue : 1 ${esc(i.unit)} par recette">${I('box', 's')}</span>`}
    ${ro ? '' : `<button class="ib" data-a="ing-del" data-t="${t}" data-k="${k}" aria-label="Retirer">${I('x', 's')}</button>`}</div>`).join('') || empty;
  const ingAdd = (t, ph) => (ro ? '' : `<div class="addbox" style="margin:8px 0"><input class="txt" id="ing-q-${t}" autocomplete="off" placeholder="${ph}" data-in="ing-q" data-t="${t}" data-enter="ing-first"><div id="ing-ac-${t}"></div></div>`);
  const variants = ro ? (!ed.groups.length ? '' : `<div class="sec">Variantes <span class="fw4" style="text-transform:none;letter-spacing:0">un choix par groupe au menu</span></div>
      ${ed.groups.map((g, gk) => `<div class="card"><b>${esc(g.name)}</b>${g.options.map((o, ok) => `<div class="vopt"><div class="small" style="font-weight:650;margin:6px 0 2px">${esc(o.name)}</div>
        ${ingRows(`${gk}-${ok}`, '<p class="muted small" style="margin:2px 0">Pas d’ingrédient propre à cette option.</p>')}</div>`).join('')}</div>`).join('')}`)
    : `<div class="sec">Variantes <span class="fw4" style="text-transform:none;letter-spacing:0">un choix par groupe au menu</span></div>
      ${ed.groups.map((g, gk) => `<div class="card"><div class="row gap"><input class="txt grow" value="${esc(g.name)}" placeholder="Nom du groupe (ex. Viande)" data-ch="grp-name" data-g="${gk}"><button class="ib" data-a="grp-del" data-g="${gk}" aria-label="Retirer le groupe">${I('trash', 's')}</button></div>
        ${g.options.map((o, ok) => `<div class="vopt"><div class="row gap"><input class="txt grow" value="${esc(o.name)}" placeholder="Option (ex. saucisse)" data-ch="opt-name" data-g="${gk}" data-o="${ok}"><button class="ib" data-a="opt-del" data-g="${gk}" data-o="${ok}" aria-label="Retirer l’option">${I('x', 's')}</button></div>
          ${ingRows(`${gk}-${ok}`, '<p class="muted small">Pas d’ingrédient propre à cette option.</p>')}${ingAdd(`${gk}-${ok}`, `＋ Ingrédient pour « ${esc(o.name || 'cette option')} »…`)}</div>`).join('')}
        <button class="btn sec2 sm" data-a="opt-add" data-g="${gk}">＋ Option</button></div>`).join('')}
      <button class="btn ghost" data-a="grp-add">${I('plus', 's')} Groupe de variantes</button>
      ${!ed.groups.length ? '<p class="muted small">Ex. Légume : carottes / épinards ; Viande : saucisse / haché. Les ingrédients ci-dessus sont communs à toutes les variantes.</p>' : ''}`;
  const tabIng = `${ro ? `<p class="muted small" style="margin:0 4px 8px">${I('users', 's')} Pour ${ed.portions} personne${ed.portions > 1 ? 's' : ''}${ed.cost_pp != null ? ` · <b>${esc(ppLabel(ed))}</b>` : ''}${ed.time_text ? ` · ${I('clock', 's')} ${esc(ed.time_text)}` : ''}</p>` : ''}<div class="card">${ingRows('c', ed.parts.length ? '<p class="muted">Rien en plus des recettes (ex. pain pita, olives…).</p>' : '<p class="muted">Aucun ingrédient : le plat sera un simple rappel dans la liste.</p>')}${ingAdd('c', '＋ Ajouter un ingrédient (produit)…')}${ro || !mgr ? '' : `<button class="btn sec2 full" data-a="rec-paste">${I('upload', 's')} Dicter ou coller une liste d’ingrédients</button>`}</div>
    ${ro ? '' : '<p class="muted small" style="margin:0 4px">Quantités facultatives, ajustées au nombre de personnes : en emballages, ou en g, ml, pièces (convertis grâce à la contenance du produit).</p>'}${variants}`;
  const steps = String(ed.steps || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const aheadRo = ed.ahead ? `<div class="card ahead"><div class="row small" style="margin-bottom:4px">${I('bell', 's')}<b>À faire à l’avance</b><span class="muted">· la veille</span></div><div class="pre">${esc(ed.ahead)}</div></div>` : '';
  const tabRec = ro ? `${aheadRo}${ed.url ? `<a class="card click row" href="${esc(ed.url)}" target="_blank" rel="noopener">${I('link')}<span class="grow small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ed.url)}</span>${I('arrowR', 's')}</a>` : ''}
      ${steps.length ? `<div class="card"><ol class="steps">${steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>` : '<div class="empty">Pas d’étapes renseignées.</div>'}${ed.notes ? `<div class="sec">Notes</div><div class="card pre">${esc(ed.notes)}</div>` : ''}`
    : `<div class="card form"><label class="muted small">Lien vers une recette en ligne</label><div class="row gap"><input class="txt grow" value="${esc(ed.url)}" placeholder="https://…" data-ch="ed" data-f="url">${mgr ? `<button class="btn sm" data-a="rec-import">${I('upload', 's')} Importer</button><button class="btn sm sec2" data-a="rec-paste" title="Coller la liste des ingrédients">Coller</button>` : ''}</div>
      ${mgr ? '<p class="muted small">Importer lit nom, portions, temps, ingrédients et étapes quand le site les publie. Si le site refuse, « Coller » reprend la liste des ingrédients copiée depuis la page.</p>' : ''}
      <label class="muted small">Étapes (une par ligne)</label><textarea class="txt" rows="7" data-ch="ed" data-f="steps">${esc(ed.steps)}</textarea>
      <label class="muted small">Notes</label><textarea class="txt" rows="2" data-ch="ed" data-f="notes">${esc(ed.notes)}</textarea>
      <label class="muted small">${I('bell', 's')} À faire à l’avance <span class="fw4">(rappel la veille au soir)</span></label><textarea class="txt" rows="2" maxlength="1000" placeholder="ex. sortir la viande du congélateur, faire tremper les pois chiches" data-ch="ed" data-f="ahead">${esc(ed.ahead)}</textarea></div>`;
  // Plat compose : recettes (autres plats) a preparer ensemble ; un seul niveau.
  const tabParts = `<p class="muted small" style="margin:0 4px 10px">Pour un plat fait de plusieurs recettes (ex. Mezze : houmous, taboulé, falafels). Chaque recette reste un plat à part ; ses ingrédients s'ajoutent aux courses du repas.</p>
      <div class="group">${ed.parts.map((p, k) => `<div class="item"><span class="ico plum">${I('puzzle')}</span><a class="grow" style="color:inherit;text-decoration:none" href="#/plats/${p.dish_id}"><b>${esc(p.name)}</b><span class="muted block">${fmtQ(p.portions)} portions sur ${p.dish_portions} · pour les ${ed.portions} du plat</span></a>
        ${ro ? I('chev', 's chev') : `<input class="txt w5 sm c" type="number" min="0.5" step="0.5" value="${fmtQ(p.portions)}" data-ch="part-portions" data-k="${k}" aria-label="Portions">
        <button class="ib" data-a="part-up" data-k="${k}" aria-label="Monter" ${k ? '' : 'disabled'}>${I('up', 's')}</button><button class="ib" data-a="part-del" data-k="${k}" aria-label="Retirer">${I('x', 's')}</button>`}</div>`).join('') || '<p class="muted" style="padding:12px 14px;margin:0">Plat simple : aucune recette rattachée.</p>'}</div>
      ${ro ? '' : `<div class="addbox" style="margin:8px 0"><input class="txt" id="part-q" autocomplete="off" placeholder="＋ Ajouter une recette (plat existant ou nouveau)…" data-in="part-q" data-enter="part-first"><div id="part-ac"></div></div>`}`;
  const tabHist = !ed.id ? '' : `<div class="row gap"><div class="card grow"><div class="big">${ed.times}</div><div class="muted small">fois servi</div></div>
      <div class="card grow"><div class="big">${ed.past.length ? daysAgo(ed.past[0].date) + ' j' : '—'}</div><div class="muted small">depuis la dernière fois</div></div>
      ${ed.times > 1 ? `<div class="card grow"><div class="big">${Math.round(daysAgo(ed.first_date) / (ed.times - 1))} j</div><div class="muted small">en moyenne</div></div>` : ''}</div>
      <div class="sec">À venir</div><div class="group">${ed.upcoming.map((m) => mealRow(m)).join('') || '<p class="muted" style="padding:12px 14px;margin:0">Pas encore prévu au menu.</p>'}</div>
      <div class="sec">Historique${ed.times > 5 ? ' · 5 dernières fois' : ''}</div><div class="group">${ed.past.map((m) => mealRow(m)).join('') || '<p class="muted" style="padding:12px 14px;margin:0">Jamais planifié pour l’instant.</p>'}</div>`;
  // [clé, libellé, icône, compteur] ; « Général » seulement en édition ; icône seule sur téléphone.
  // « Avancé » : composition (plat simple, en modification) et historique ; l'onglet Composition n'apparaît que pour un plat composé.
  const showComp = !ro && !ed.used_in.length && !ed.parts.length;
  const tabAdv = `${showComp ? `<div class="sec">Plat composé</div>${tabParts}` : ''}${ed.id ? `<div class="sec">Historique</div>${tabHist}` : ''}`;
  const tabs = [...(ro ? [] : [['gen', 'Général', 'sliders']]), ['ing', 'Ingrédients', 'basket'], ['rec', 'Recette', 'book'], ...(ed.parts.length ? [['parts', 'Composition', 'puzzle', ed.parts.length]] : []), ...(tabAdv ? [['adv', 'Avancé', 'clock']] : [])];
  const cur = tabs.some(([k]) => k === S.q.dtab) ? S.q.dtab : !ro && !ed.id ? 'gen' : ed.parts.length ? 'parts' : 'ing';
  const pills = `${ed.parts.length ? `<span class="pill">${I('puzzle', 's')} plat composé</span>` : ''}${ed.tags.map((t) => `<span class="pill">#${esc(t)}</span>`).join('')}`;
  // Lecture : informations en liste (sous les onglets sur telephone, a gauche sur PC).
  const infoRo = `<div class="group" style="margin-top:12px">${[['Portions', `${ed.portions} personne${ed.portions > 1 ? 's' : ''}`], ['Coût', ed.cost_pp == null ? '' : `${ppLabel(ed)}${ed.cost_partial ? ` · ${ed.cost_missing} ingrédient${ed.cost_missing > 1 ? 's' : ''} sans prix` : ''}`], ['Temps', ed.time_text], ['Repas', slotsLabel(ed.slots)],
    ['Types', ed.types.join(', ')], ['Tags', ed.tags.map((t) => `#${t}`).join(' ')]].filter(([, v]) => v)
    .map(([k, v]) => `<div class="item"><span class="muted w6">${k}</span><span class="grow">${esc(v)}</span></div>`).join('')}</div>`;
  const info = ro ? infoRo
    : `<div class="card form"><label class="muted small">Nom</label><input class="txt" value="${esc(ed.name)}" data-ch="ed" data-f="name">
      <div class="row gap"><label class="grow"><span class="muted small">Portions de référence</span><input class="txt" type="number" min="1" value="${ed.portions}" data-ch="ed" data-f="portions"></label>
      <label class="grow"><span class="muted small">Temps</span><input class="txt" value="${esc(ed.time_text)}" placeholder="ex. 45 min" data-ch="ed" data-f="time_text"></label></div>
      <label class="muted small">Repas possibles <span class="fw4">(génération du menu)</span></label>
      <div class="opt" style="margin:4px 0 8px;padding:2px 0;flex-wrap:wrap">${SLOT_ORDER.map((k) => `<button class="${ed.slots.includes(k) ? 'on' : ''}" data-a="ed-slot" data-s="${k}">${SLOT[k]}</button>`).join('')}</div>
      <label class="muted small">Types <span class="fw4">(modèles de semaine)</span></label>
      <div class="opt" style="margin:4px 0 4px;padding:2px 0;flex-wrap:wrap">${allTypes().map((t) => `<button class="${ed.types.includes(t) ? 'on' : ''}" data-a="ed-type" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="row gap" style="margin-bottom:8px"><input class="txt grow" id="type-new" placeholder="Autre type (ex. poisson, pâtes…)" data-enter="type-new"><button class="btn sm sec2" data-a="type-new">＋</button></div>
      <label class="muted small">Tags</label>
      <div class="pills">${ed.tags.map((t, k) => (norm(t) === 'economique' ? `<span class="pill p-leaf" title="Automatique : coût par personne sous le palier des réglages">#${esc(t)} · auto</span>` : `<span class="pill p-grey">#${esc(t)} <button class="x" data-a="tag-rm" data-i="${k}" aria-label="Retirer">✕</button></span>`)).join('')}</div>
      <div class="row gap" style="margin-top:6px"><input class="txt grow" id="tag-in" autocomplete="off" placeholder="Chercher ou créer un tag…" data-in="tag-q" data-enter="tag-add"><button class="btn sm sec2" data-a="tag-add">＋</button></div>
      <div class="pills" id="tag-sug" style="margin-top:6px">${tagSug('')}</div></div>`;
  const banner = ed.draft ? `<div class="banner">${I('edit')}<span>Proposé par un membre : ${mgr ? 'enregistrer valide la fiche' : 'à valider par un gestionnaire'}.</span></div>` : '';
  const hero = tile(ed.name || '?', pills, 'hero-t', curPhoto());
  const usedIn = ed.used_in.length ? `<p class="small" style="margin:8px 2px">${I('puzzle', 's')} Recette de ${ed.used_in.map((d) => `<a href="#/plats/${d.id}" style="color:var(--plum);font-weight:650">${esc(d.name)}</a>`).join(', ')}</p>` : '';
  const tabsHtml = `<div class="seg" style="margin-top:14px">${tabs.map(([k, t, ic, n]) => `<button class="tb ${cur === k ? 'on' : ''}" data-a="dtab" data-k="${k}" aria-label="${t}" title="${t}">${I(ic, 's')}<span class="tl">${t}</span>${n ? `<span class="tn">${n}</span>` : ''}</button>`).join('')}</div>
      ${{ gen: info, ing: tabIng, rec: tabRec, parts: tabParts, adv: tabAdv }[cur]}`;
  return {
    title: ed.id ? ed.name : 'Nouveau plat', back: !ed.id && S.dishReturn ? '#/menu' : '#/plats',
    sub: ed.draft ? 'Proposition à valider par un gestionnaire' : !canEdit ? 'Lecture seule (membre)' : !ro && ed.id ? 'Modification' : '',
    right: ro ? (canEdit ? `<button class="btn sm sec2" data-a="dish-edit">${I('edit', 's')} Modifier</button>` : '')
      : `${ed.id && mgr ? `<button class="ib" data-a="dish-del" aria-label="Supprimer">${I('trash')}</button>` : ''}${ed.id ? '<button class="btn sm sec2" data-a="dish-cancel">Annuler</button>' : ''}<button class="btn sm" data-a="dish-save">${ed.draft && mgr ? 'Valider la fiche' : 'Enregistrer'}</button>`,
    // Telephone en lecture : onglets juste sous la photo, informations en bas.
    body: ro && !isPc() ? `${banner}${hero}${tabsHtml}${usedIn}<div class="sec">Infos</div>${infoRo}`
      : `${banner}<div class="split dish"><div>${hero}
      ${ro ? '' : `<div class="btn-row" style="margin-top:8px">${btnI('camera', curPhoto() ? 'Changer la photo' : 'Ajouter une photo', 'data-a="dish-photo"')}${curPhoto() ? btnI('trash', 'Retirer la photo', 'data-a="dish-photo-x"', 'sec2 danger-t') : ''}</div>`}${ro ? infoRo : ''}
      ${usedIn}</div><div>${tabsHtml}</div></div>`,
    dock: ed.id ? `<div class="btn-row grow">${btnI('book', 'Cuisiner', `href="#/plats/${ed.id}/cuisine"`, 'sec2', 'a')}${ed.wish_id ? btnI('bulb', 'Retirer des envies', `data-a="dish-unwish"`, 'sec2') : btnI('bulb', 'Ajouter aux envies', `data-a="dish-wish"`, 'sec2')}${btnI('calendar', mgr ? 'Ajouter au menu' : 'Suggérer au menu', `data-a="plan-dish" data-id="${ed.id}"`, '')}</div>` : null,
  };
}
on('click', 'dish-open-edit', (el) => { closeSheet(); S.q.openEdit = Number(el.dataset.id); go(el.getAttribute('href')); });
on('click', 'dish-edit', () => { S.q.deditId = ed.id; render(); window.scrollTo(0, 0); });
// Annuler : on recharge la fiche enregistree.
on('click', 'dish-cancel', async () => { await loadDish(ed.id); render(); });
on('click', 'ed-slot', (el) => {
  const k = el.dataset.s, v = ed.slots || ['midi', 'soir'];
  if (v.includes(k) && v.length === 1) { toast('Au moins un repas'); return; }
  ed.slots = v.includes(k) ? v.filter((x) => x !== k) : [...v, k];
  render();
});
on('click', 'ed-type', (el) => { const t = el.dataset.t; ed.types = ed.types.includes(t) ? ed.types.filter((x) => x !== t) : [...ed.types, t]; render(); });
on('click', 'type-new', () => {
  const i = document.getElementById('type-new'), n = i.value.trim();
  if (!n) return;
  const known = allTypes().find((t) => norm(t) === norm(n));
  if (!ed.types.includes(known || n)) ed.types.push(known || n);
  render();
});
on('click', 'dtab', (el) => { S.q.dtab = el.dataset.k; render(); });
// Photo : choisie sur l'appareil (redimensionnee a 1280 px, jpeg) ou reprise de la recette
// importee ; envoyee avec l'enregistrement du plat.
const curPhoto = () => (ed.photo_remove ? null : ed.photo_preview || ed.photo || null);
on('click', 'dish-photo', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', async () => {
    const f = input.files[0];
    if (!f) return;
    try {
      const img = await createImageBitmap(f);
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      ed.photo_data = c.toDataURL('image/jpeg', 0.84);
      ed.photo_preview = ed.photo_data; ed.photo_url = null; ed.photo_remove = false;
      toast('Photo prête · enregistrer pour la garder');
      render();
    } catch { toast('Image illisible', true); }
  });
  input.click();
});
on('click', 'dish-photo-x', () => { ed.photo_remove = true; ed.photo_data = null; ed.photo_url = null; ed.photo_preview = null; render(); });

const mealRow = (m) => `<div class="item click" data-a="meal-open" data-id="${m.id}" data-date="${m.date}"><span class="muted w8">${esc(fmtDate(m.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</span><span class="grow">${SLOT[m.slot]} · ${m.persons} pers.${m.via ? ` <span class="pill p-plum">${I('puzzle', 's')} ${esc(m.via)}</span>` : ''}</span>${I('chev', 's chev')}</div>`;

// Composition : recherche parmi les plats (ni lui-meme, ni plat compose, ni deja la).
function partMatches(q) {
  const n = norm(q).trim();
  return n ? (S.dishes || []).filter((d) => norm(d.name).includes(n) && d.id !== ed.id && !d.parts && !ed.parts.some((p) => p.dish_id === d.id)).slice(0, 6) : [];
}
on('input', 'part-q', async (el) => {
  if (!S.dishes) await loadDishes();
  const q = el.value.trim(), ms = partMatches(q);
  document.getElementById('part-ac').innerHTML = q ? `<div class="ac">${ms.map((d) => `<button data-a="part-add" data-id="${d.id}"><span class="grow">${esc(d.name)}</span><span class="muted">${d.portions} p.</span></button>`).join('')}
    ${isManager() && !S.dishes.some((d) => norm(d.name) === norm(q)) ? `<button data-a="part-new"><b>＋ Créer le plat « ${esc(q)} »</b></button>` : ''}</div>` : '';
});
const addPart = (d) => { ed.parts.push({ dish_id: d.id, name: d.name, portions: d.portions, dish_portions: d.portions }); S.q.dtab = 'parts'; };
const partFocus = () => setTimeout(() => document.getElementById('part-q')?.focus());
on('click', 'part-add', (el) => { addPart(S.dishes.find((d) => d.id === Number(el.dataset.id))); render(); partFocus(); });
on('click', 'part-first', (el) => { const ms = partMatches(el.value); if (ms.length) { addPart(ms[0]); render(); partFocus(); } });
// Nouveau plat (fiche vide, a completer ensuite : ingredients, import depuis un lien).
on('click', 'part-new', async () => {
  const q = document.getElementById('part-q').value.trim();
  const d = await attempt(() => post(hp('/dishes'), { name: q.charAt(0).toUpperCase() + q.slice(1) }));
  if (!d) return;
  S.dishes = null;
  addPart(d);
  toast(`Plat « ${d.name} » créé · à compléter depuis sa fiche`);
  render();
  partFocus();
});
on('change', 'part-portions', (el) => { const n = num(el.value); if (n) ed.parts[Number(el.dataset.k)].portions = n; });
on('click', 'part-del', (el) => { ed.parts.splice(Number(el.dataset.k), 1); render(); });
on('click', 'part-up', (el) => { const k = Number(el.dataset.k); if (k) { ed.parts.splice(k - 1, 0, ...ed.parts.splice(k, 1)); render(); } });

on('change', 'ed', (el) => { ed[el.dataset.f] = el.dataset.f === 'portions' ? Math.max(1, parseInt(el.value, 10) || 4) : el.value; });
// Ingredients d'une cible : 'c' = communs, 'g-o' = option o du groupe g.
function ingsOf(t) {
  if (t === 'c' || !t) return ed.ingredients;
  const [g, o] = t.split('-').map(Number);
  return ed.groups[g].options[o].ingredients;
}
on('change', 'ing-qty', (el) => { ingsOf(el.dataset.t)[Number(el.dataset.k)].qty = num(el.value); });
on('change', 'ing-unit', (el) => { ingsOf(el.dataset.t)[Number(el.dataset.k)].iunit = el.value || null; render(); });
on('click', 'ing-del', (el) => { ingsOf(el.dataset.t).splice(Number(el.dataset.k), 1); render(); });

// Variantes : groupes et options.
on('click', 'grp-add', () => { ed.groups.push({ name: '', options: [{ name: '', ingredients: [] }, { name: '', ingredients: [] }] }); render(); });
on('click', 'grp-del', (el) => { ed.groups.splice(Number(el.dataset.g), 1); render(); });
on('change', 'grp-name', (el) => { ed.groups[Number(el.dataset.g)].name = el.value; });
on('click', 'opt-add', (el) => { ed.groups[Number(el.dataset.g)].options.push({ name: '', ingredients: [] }); render(); });
on('click', 'opt-del', (el) => {
  const g = ed.groups[Number(el.dataset.g)];
  g.options.splice(Number(el.dataset.o), 1);
  if (!g.options.length) ed.groups.splice(Number(el.dataset.g), 1);
  render();
});
on('change', 'opt-name', (el) => { ed.groups[Number(el.dataset.g)].options[Number(el.dataset.o)].name = el.value; });

let ingT = 'c'; // cible de la derniere recherche d'ingredient
const ingInput = () => document.getElementById(`ing-q-${ingT}`);
function ingMatches(q) {
  const n = norm(q).trim();
  return n ? S.products.filter((p) => norm(p.name).includes(n) && !ingsOf(ingT).some((i) => i.product_id === p.id)).slice(0, 6) : [];
}
on('input', 'ing-q', (el) => {
  ingT = el.dataset.t;
  const q = el.value.trim(), ms = ingMatches(q);
  document.getElementById(`ing-ac-${ingT}`).innerHTML = q ? `<div class="ac">${ms.map((p) => `<button data-a="ing-add" data-id="${p.id}"><span class="grow">${esc(p.name)}</span><span class="muted">${esc(catName(p.category_id))}</span></button>`).join('')}
    ${S.products.some((p) => norm(p.name) === norm(q)) ? '' : `<button data-a="ing-new"><b>＋ Créer « ${esc(q)} » dans les produits</b></button>`}</div>` : '';
});
const addIng = (p, qty = p.is_base ? null : 1, note = null, t = ingT, iunit = null) => {
  ingsOf(t).push({ product_id: p.id, name: p.name, unit: p.unit, iunit, is_base: !!p.is_base, qty, note });
};
on('click', 'ing-add', (el) => { addIng(S.products.find((p) => p.id === Number(el.dataset.id))); render(); ingInput()?.focus(); });
on('click', 'ing-first', (el) => { ingT = el.dataset.t; const ms = ingMatches(el.value); if (ms.length) { addIng(ms[0]); render(); ingInput()?.focus(); } });
on('click', 'ing-new', () => {
  const q = ingInput().value.trim();
  sheet(`<h3>Nouveau produit</h3><p class="muted small">Ajouté aux produits du foyer, puis au plat.</p>
    <label class="muted">Nom</label><input class="txt" name="name" value="${esc(q.charAt(0).toUpperCase() + q.slice(1))}">
    <label class="muted">Rayon</label><select class="txt" name="rayon">${catSubOptions()}</select>
    ${packBlock(`<label class="muted">Emballage</label><select class="txt" name="unit">${unitOptions('paquet')}</select>`, contField())}
    <label class="row line"><input type="checkbox" class="cb" name="is_base"><span class="grow">Ingrédient de base (sel, huile, épices…)</span></label>
    <div class="row end"><button class="btn" data-a="ing-new-ok">Créer et ajouter</button></div>`);
});
on('click', 'ing-new-ok', async () => {
  const p = await attempt(() => post(hp('/products'), formData(document.querySelector('.sheet'))));
  if (!p) return;
  closeSheet();
  await loadProducts();
  addIng(p);
  render();
});

// Contenance d'un produit modifiee sur place (le plat en cours n'est pas quitte).
let contPid = null;
on('click', 'ing-cont', (el) => {
  contPid = Number(el.dataset.id);
  const p = S.products.find((x) => x.id === contPid);
  if (!p) return;
  sheet(`<h3>${esc(p.name)}</h3><p class="muted small">Pour convertir les g, ml ou pièces de la recette en ${esc(p.unit)}s dans les listes.</p>
    <div class="form" id="cont-form">${contField(p.contenance)}
    <label class="row"><span class="grow"><b>Poids d'une pièce</b><span class="muted block">Facultatif, en g (ou ml)</span></span><input class="txt w5 c" name="piece_qty" inputmode="decimal" value="${p.piece_qty != null ? String(p.piece_qty).replace('.', ',') : ''}" placeholder="g"></label></div>
    <div class="row end"><button class="btn sec2" data-a="close">Annuler</button><button class="btn" data-a="ing-cont-ok">Enregistrer</button></div>`);
});
on('click', 'ing-cont-ok', async () => {
  const p = await attempt(() => patch(hp(`/products/${contPid}`), formData(document.getElementById('cont-form'))));
  if (!p) return;
  closeSheet();
  await loadProducts();
  toast('Contenance enregistrée');
  render();
});

// Tags existants proposes sous le champ, filtres pendant la frappe (tous au depart).
function tagSug(q) {
  const n = norm(q.replace(/^#/, '')).trim();
  return allTags().filter((t) => norm(t) !== 'economique' && !ed.tags.some((x) => norm(x) === norm(t)) && (!n || norm(t).includes(n)))
    .map((t) => `<button class="pill" data-a="tag-pick" data-t="${esc(t)}">#${esc(t)}</button>`).join('');
}
on('input', 'tag-q', (el) => { document.getElementById('tag-sug').innerHTML = tagSug(el.value); });
on('click', 'tag-pick', (el) => { if (!ed.tags.some((x) => norm(x) === norm(el.dataset.t))) ed.tags.push(el.dataset.t); document.getElementById('tag-in').value = ''; render(); });
// Tags : ajout (Entree, virgules acceptees), retrait ; enregistres avec le plat.
function takeTagInput() {
  const i = document.getElementById('tag-in');
  if (!i) return;
  for (const t of i.value.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean)) {
    if (!ed.tags.some((x) => norm(x) === norm(t))) ed.tags.push(allTags().find((x) => norm(x) === norm(t)) || t);
  }
  i.value = '';
}
on('click', 'tag-add', () => { takeTagInput(); render(); setTimeout(() => document.getElementById('tag-in')?.focus()); });
on('click', 'tag-rm', (el) => { ed.tags.splice(Number(el.dataset.i), 1); render(); });
on('click', 'dish-save', async () => {
  takeTagInput();
  const ings = (list) => list.map((i) => ({ product_id: i.product_id, qty: i.qty, unit: i.iunit || null, note: i.note }));
  const body = { ...ed, ...(ed.photo_data ? { photo_data: ed.photo_data } : ed.photo_url ? { photo_url: ed.photo_url } : ed.photo_remove ? { photo: null } : {}), photo_preview: undefined, ingredients: ings(ed.ingredients), parts: ed.used_in.length ? undefined : ed.parts.map((p) => ({ dish_id: p.dish_id, portions: p.portions })),
    groups: ed.groups.map((g) => ({ name: g.name, options: g.options.map((o) => ({ id: o.id, name: o.name, ingredients: ings(o.ingredients) })) })) };
  const d = await attempt(() => (ed.id ? put(hp(`/dishes/${ed.id}`), body) : post(hp('/dishes'), body)));
  if (!d) return;
  const isNew = !ed.id, wasDraft = ed.draft;
  ed = { ...d, steps: d.steps || '', notes: d.notes || '', ahead: d.ahead || '', url: d.url || '', time_text: d.time_text || '' };
  S.q.deditId = null;
  S.dishes = null;
  loadHouse().catch(() => {}); // tags du foyer (ecran Foyer)
  S.wishes = null;
  toast(isNew ? 'Plat créé' : wasDraft && !d.draft ? 'Fiche validée' : 'Plat enregistré · listes recalculées');
  if (isNew && S.dishReturn) { S.dishReturn.dish_id = d.id; go('#/menu'); } else if (isNew) go(`#/plats/${d.id}`); else render();
});
on('click', 'dish-del', async () => {
  const n = ed.upcoming.length;
  const ok = await confirmSheet({ title: `Supprimer « ${ed.name} » ?`, ok: 'Supprimer', danger: true,
    text: `${n ? `Il est prévu dans ${n} repas à venir (${ed.upcoming.map((m) => esc(fmtDate(m.date))).join(', ')}) : ces repas seront retirés du menu et leurs ingrédients des listes.` : 'Il n’est prévu dans aucun repas à venir.'} Les menus passés gardent son nom.` });
  if (ok && await attempt(() => del(hp(`/dishes/${ed.id}`)))) { S.dishes = null; toast('Plat supprimé'); go('#/plats'); }
});

// ---------- Variantes ----------
// Option retenue par groupe : celle demandee si elle existe, sinon la premiere.
export function chosenOf(d, options) {
  const want = new Set(options || []);
  return (d.groups || []).map((g) => (g.options.find((o) => want.has(o.id)) || g.options[0]).id);
}
// Ingredients communs + ceux des options retenues.
export function dishIngredients(d, options) {
  const keep = new Set(chosenOf(d, options));
  return [...d.ingredients, ...(d.groups || []).flatMap((g) => g.options.filter((o) => keep.has(o.id)).flatMap((o) => o.ingredients))];
}

// ---------- Recette (lecture, quantites ajustees) ----------
// options : variantes du repas ; sans repas, toutes les options sont listees par groupe.
// Plat compose : chaque recette (sauf celles ecartees du repas, partSkip) a la suite.
export async function recipeSheet(dishId, persons, options, partSkip = []) {
  const d = ed && ed.id === dishId ? ed : await attempt(() => get(hp(`/dishes/${dishId}`)));
  if (!d) return;
  const p = persons || d.portions, f = p / d.portions;
  const steps = String(d.steps || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const row = (i) => ingRow(i, f);
  const groups = d.groups || [], keep = options ? new Set(chosenOf(d, options)) : null;
  const variant = keep ? groups.map((g) => g.options.find((o) => keep.has(o.id)).name).join(', ') : '';
  const ings = keep ? dishIngredients(d, options) : d.ingredients;
  sheet(`<h3>${I('book', 's')} ${esc(d.name)}${variant ? ` · ${esc(variant)}` : ''}</h3><p class="muted">${d.time_text ? '⏱ ' + esc(d.time_text) + ' · ' : ''}pour ${p} personne${p > 1 ? 's' : ''}</p>
    ${ings.length ? `<div class="sec">Ingrédients</div>${ings.map(row).join('')}` : ''}
    ${keep ? '' : groups.map((g) => `<div class="sec">${esc(g.name)} · au choix</div>${g.options.map((o) => `<div class="item"><b class="grow">${esc(o.name)}</b></div>${o.ingredients.map(row).join('')}`).join('')}`).join('')}
    ${steps.length ? `<div class="sec">Préparation</div><ol class="steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    ${d.notes ? `<div class="sec">Notes</div><p>${esc(d.notes)}</p>` : ''}
    ${d.url ? `<a class="btn sec2 full" href="${esc(d.url)}" target="_blank" rel="noopener">${I('link', 's')} Ouvrir la recette en ligne</a>` : ''}
    ${(d.parts || []).filter((x) => !partSkip.includes(x.dish_id)).map((x) => partRecipe(x, f)).join('')}
    ${!ings.length && !groups.length && !steps.length && !d.notes && !d.url && !(d.parts || []).length ? '<p class="muted">Aucune recette renseignée pour ce plat.</p>' : ''}
    <div class="row end"><button class="btn sec2" data-a="close">Fermer</button></div>`);
}
// Recette d'un composant : quantites pour sa part du plat compose (facteur f du repas).
const ingRow = (i, f) => `<div class="item"><span class="grow">${esc(i.name)}${i.note ? ` <span class="muted small">· ${esc(i.note)}</span>` : ''}</span>${i.qty == null ? '<span class="pill p-grey">selon goût</span>' : `<b class="price">${esc(amountText(i.qty * f, i))}</b>`}</div>`;
function partRecipe(x, f) {
  const g = (f * x.portions) / x.dish_portions, steps = String(x.steps || '').split('\n').map((s) => s.trim()).filter(Boolean);
  return `<div class="part-rec"><h4>${I('puzzle', 's')} ${esc(x.name)}${x.variant ? ` · ${esc(x.variant)}` : ''}</h4>
    <p class="muted small">${x.time_text ? '⏱ ' + esc(x.time_text) + ' · ' : ''}${fmtQ(g * x.dish_portions)} portion${g * x.dish_portions > 1 ? 's' : ''} (recette pour ${x.dish_portions})</p>
    ${(x.ingredients || []).map((i) => ingRow(i, g)).join('')}
    ${steps.length ? `<ol class="steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    ${x.notes ? `<p class="muted">${esc(x.notes)}</p>` : ''}
    ${x.url ? `<a class="btn sec2 sm" href="${esc(x.url)}" target="_blank" rel="noopener">${I('link', 's')} Recette en ligne</a>` : ''}
    ${!(x.ingredients || []).length && !steps.length && !x.notes && !x.url ? '<p class="muted small">Pas encore de détail : <a href="#/plats/' + x.dish_id + '" data-a="close-nav">compléter la fiche</a>.</p>' : ''}</div>`;
}
on('click', 'recipe-view', (el) => recipeSheet(Number(el.dataset.id)));

// ---------- Import d'une recette depuis un lien ----------
let imp = null;
on('click', 'rec-import', async () => {
  const url = (ed.url || '').trim();
  if (!url) { toast('Collez d’abord le lien de la recette.', true); return; }
  sheet('<h3>Chargement de la recette…</h3><p class="muted">Lecture des données de la page (schema.org/Recipe).</p>');
  let r;
  try { r = await post(hp('/recipe-import'), { url }); } catch (e) {
    // Site qui refuse le serveur ou page sans recette lisible : repli sur le collage.
    if (e.status === 502 || e.status === 422) pasteSheet(e.message);
    else { closeSheet(); toast(e.status === 0 ? 'Pas de réseau : action possible seulement en ligne.' : e.message, true); }
    return;
  }
  // Legende Instagram sans liste d'ingredients reconnue : texte propose au collage.
  if (r.source === 'instagram' && !r.ingredients.length) { pasteSheet('Aucune liste d’ingrédients reconnue dans la description : vérifiez le texte ci-dessous.', r.caption); return; }
  await showImport(r);
});
// Repli : ingredients copies depuis la page, une ligne chacun.
function pasteSheet(why, text = '') {
  sheet(`<h3>Coller les ingrédients</h3>${why ? `<p class="muted small">${esc(why)}</p>` : ''}
    <p class="muted small">Dictez ou copiez la liste des ingrédients, une ligne par ingrédient (ex. « 300 g de farine »).</p>
    <textarea class="txt" id="rec-text" rows="8" placeholder="300 g de farine&#10;3 oeufs&#10;60 cl de lait">${esc(text)}</textarea>
    ${micButton('rec-text', true) ? `<div class="row gap" style="margin-top:6px">${micButton('rec-text', true)}<span class="muted small">Dictée : dites un ingrédient par phrase (« 200 grammes de farine »), marquez une pause entre deux. Retoucher le bouton pour arrêter.</span></div>` : ''}
    <div class="row end"><button class="btn sec2" data-a="close">Annuler</button><button class="btn" data-a="rec-paste-ok">Lire les ingrédients</button></div>`);
  setTimeout(() => document.getElementById('rec-text')?.focus());
}
on('click', 'rec-paste', () => pasteSheet(''));
on('click', 'rec-paste-ok', async () => {
  stopDictation();
  const r = await attempt(() => post(hp('/recipe-import'), { text: document.getElementById('rec-text').value }));
  if (r) await showImport(r);
});
async function showImport(r) {
  if (!S.products) await loadProducts();
  const matched = matchLines(r.ingredients.map((g) => ({ ...g, label: g.name })), { products: S.products });
  imp = {
    ...r, f: { name: !ed.name, portions: !!r.portions, time: !!r.time, steps: r.steps.length > 0, photo: !!r.image && !ed.photo },
    ing: matched.map((g) => { const p = g.product_id && S.products.find((x) => x.id === g.product_id);
      // Quantite reprise de la recette (modifiable) ; sans equivalent (gousse, pincee...) :
      // 1 emballage, la quantite lue gardee en note.
      return { ...g, on: true, q: g.amount != null ? g.amount : 1, u: g.amount != null ? g.amount_unit : null,
        note: g.amount == null && g.qty != null ? `${fmtQ(g.qty)}${g.unit ? ' ' + g.unit : ''}` : null, label: p ? p.name : g.name.charAt(0).toUpperCase() + g.name.slice(1),
        create: p ? null : { name: g.name.charAt(0).toUpperCase() + g.name.slice(1), category_id: categoryOrder()[0], unit: 'paquet', is_base: g.base } }; }),
  };
  importSheet();
}
// Ecran d'import : chaque ingredient peut etre renomme (nouveau produit) ou relie a un produit
// existant (nom choisi dans la liste) ; quantite et unite pre-remplies depuis la recette, modifiables.
function impMatch(g) {
  const p = S.products.find((x) => norm(x.name) === norm(g.label));
  g.product_id = p ? p.id : null;
  if (!p) g.create = { ...(g.create || { category_id: categoryOrder()[0], unit: 'paquet', is_base: g.base }), name: g.label };
}
function importSheet() {
  const m = imp;
  sheet(`<h3>${I('book', 's')} ${esc(m.name || 'Recette')}</h3><p class="muted small">Trouvé sur la page : cocher ce qu'il faut reprendre.</p>
    ${m.image ? `<label class="row line"><input type="checkbox" class="cb" data-ch="imp-f" data-k="photo" ${m.f.photo ? 'checked' : ''}><img src="${esc(m.image)}" alt="" style="width:72px;height:54px;object-fit:cover;border-radius:10px"><span class="grow"><b>Photo</b> de la recette</span></label>` : ''}
    ${[['name', 'Nom', m.name], ['portions', 'Portions', m.portions && `${m.portions} personnes`], ['time', 'Temps', m.time], ['steps', 'Étapes', m.steps.length && `${m.steps.length} étapes`]]
      .filter(([, , v]) => v).map(([k, t, v]) => `<label class="row line"><input type="checkbox" class="cb" data-ch="imp-f" data-k="${k}" ${m.f[k] ? 'checked' : ''}><span class="grow"><b>${t}</b> · ${esc(v)}</span></label>`).join('')}
    <div class="sec">Ingrédients (${m.ing.length})</div>
    <p class="muted small" style="margin:-4px 0 8px">Tapez pour chercher un produit existant et le relier (touchez-le dans la liste), ou gardez un nouveau nom pour le créer.</p>
    ${m.ing.map((g, i) => `<div class="imp-line"><input type="checkbox" class="cb" data-ch="imp-ing" data-i="${i}" ${g.on ? 'checked' : ''} aria-label="Reprendre">
      <div class="grow"><div class="muted small">« ${esc(g.raw)} »</div>
        <div class="row" style="margin-top:4px"><input class="txt sm grow" autocomplete="off" value="${esc(g.label)}" data-ch="imp-name" data-in="imp-search" data-i="${i}" aria-label="Produit">
        <span class="pill ${g.product_id ? 'p-leaf' : 'p-carrot'}" id="imp-st-${i}">${g.product_id ? 'existant' : 'nouveau'}</span></div>
        <div id="imp-ac-${i}"></div>
        <select class="txt sm" id="imp-cat-${i}" data-ch="imp-cat" data-i="${i}" style="margin-top:4px" ${g.product_id ? 'hidden' : ''} aria-label="Rayon du nouveau produit">${catOptions(g.create ? g.create.category_id : categoryOrder()[0])}</select>
        <div class="row gap" style="margin-top:4px"><input class="txt w5 sm c" value="${g.q != null ? fmtQ(g.q) : ''}" placeholder="—" data-ch="imp-q" data-i="${i}" aria-label="Quantité"><select class="txt sm w6" data-ch="imp-u" data-i="${i}" aria-label="Unité">${[['', 'emballage'], ...IUNITS].map(([v, l]) => `<option value="${v}" ${(g.u || '') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${g.note ? `<span class="muted small">· ${esc(g.note)}</span>` : ''}</div></div></div>`).join('')}
    <p class="muted small">Les quantités en g, ml, pièces, cuillères sont converties en emballages dans les listes (contenance du produit).</p>
    <div class="row end"><button class="btn sec2" data-a="close">Annuler</button><button class="btn" data-a="imp-ok">Appliquer au plat</button></div>`);
}
on('change', 'imp-f', (el) => { imp.f[el.dataset.k] = el.checked; });
on('change', 'imp-ing', (el) => { imp.ing[Number(el.dataset.i)].on = el.checked; });
on('change', 'imp-q', (el) => { imp.ing[Number(el.dataset.i)].q = num(el.value); });
on('change', 'imp-u', (el) => { imp.ing[Number(el.dataset.i)].u = el.value || null; });
// Sans redessiner le panneau (garde le defilement) : etat « existant / nouveau » mis a jour sur place.
on('change', 'imp-name', (el) => {
  const k = Number(el.dataset.i), g = imp.ing[k];
  g.label = el.value.trim() || g.label;
  impMatch(g);
  const st = document.getElementById(`imp-st-${k}`), cat = document.getElementById(`imp-cat-${k}`);
  st.textContent = g.product_id ? 'existant' : 'nouveau';
  st.className = `pill ${g.product_id ? 'p-leaf' : 'p-carrot'}`;
  cat.hidden = !!g.product_id;
});
// Recherche pendant la frappe : produits contenant le texte ; toucher un produit le relie.
on('input', 'imp-search', (el) => {
  const k = Number(el.dataset.i), n = norm(el.value).trim(), box = document.getElementById(`imp-ac-${k}`);
  const ms = n ? S.products.filter((p) => norm(p.name).includes(n) && norm(p.name) !== n).slice(0, 6) : [];
  box.innerHTML = ms.length ? `<div class="ac">${ms.map((p) => `<button data-a="imp-pick" data-i="${k}" data-id="${p.id}"><span class="grow">${esc(p.name)}</span><span class="muted">${esc(catName(p.category_id))}</span></button>`).join('')}</div>` : '';
});
on('click', 'imp-pick', (el) => {
  const k = Number(el.dataset.i), p = S.products.find((x) => x.id === Number(el.dataset.id));
  if (!p) return;
  const inp = document.querySelector(`[data-in="imp-search"][data-i="${k}"]`);
  inp.value = p.name;
  document.getElementById(`imp-ac-${k}`).innerHTML = '';
  inp.dispatchEvent(new Event('change', { bubbles: true }));
});
on('change', 'imp-cat', (el) => { const g = imp.ing[Number(el.dataset.i)]; if (g.create) g.create.category_id = Number(el.value); });
on('click', 'imp-ok', async () => {
  const m = imp;
  if (m.f.name && m.name) ed.name = m.name;
  if (m.f.portions && m.portions) ed.portions = m.portions;
  if (m.f.time && m.time) ed.time_text = m.time;
  if (m.f.steps) ed.steps = m.steps.join('\n');
  if (m.f.photo && m.image) { ed.photo_url = m.image; ed.photo_data = null; ed.photo_preview = m.image; ed.photo_remove = false; }
  let created = 0;
  for (const g of m.ing.filter((x) => x.on)) {
    let p = g.product_id ? S.products.find((x) => x.id === g.product_id) : null;
    if (!p) {
      p = await attempt(() => post(hp('/products'), { ...g.create, name: g.label }));
      if (!p) continue;
      S.products.push(p);
      created++;
    }
    if (ed.ingredients.some((i) => i.product_id === p.id)) continue;
    addIng(p, g.q, g.note, 'c', g.u);
  }
  closeSheet();
  await loadProducts();
  toast(`Recette importée${created ? ` · ${created} produit${created > 1 ? 's' : ''} créé${created > 1 ? 's' : ''}` : ''} · enregistrer pour garder`);
  render();
});

// ---------- Mode cuisine : quantites ajustees, recettes enchainees ----------
// Telephone : pas a pas (ingredients, puis une etape par ligne des consignes ; bouton
// « Ingrédients » sur chaque etape ; glisser a gauche / a droite pour changer d'etape).
// PC : tout sur une page. L'ecran reste allume tant que le mode cuisine est ouvert.
const stepsOf = (x) => String(x || '').split('\n').map((t) => t.trim()).filter(Boolean);
// Recettes du mode cuisine : le plat puis ses composants, chacun avec son facteur.
function cookParts() {
  const d = ed, p = Number(S.q[`cp${d.id}`] || S.route[2] || d.portions), f = p / d.portions;
  return { p, list: [{ ...d, ingredients: dishIngredients(d, null), g: f, own: true },
    ...(d.parts || []).map((x) => ({ ...x, g: (f * x.portions) / x.dish_portions }))] };
}
const ingCard = (list, g) => (list.length ? `<div class="card">${list.map((i) => `<div class="ing"><span class="grow">${esc(i.name)}${i.note ? ` <span class="muted small">· ${esc(i.note)}</span>` : ''}</span><span class="q">${i.qty == null ? '<span class="muted">selon goût</span>' : esc(amountText(i.qty * g, i))}</span></div>`).join('')}</div>` : '');
const partHead = (x) => `<div class="mid">${esc(x.name)}${x.variant ? ` · ${esc(x.variant)}` : ''}</div>
  <p class="muted small" style="margin:2px 0 8px">${x.time_text ? `⏱ ${esc(x.time_text)} · ` : ''}${fmtQ(x.g * x.dish_portions)} portions (recette pour ${x.dish_portions})</p>`;
const variantsNote = (d) => ((d.groups || []).length ? `<p class="muted small" style="margin:0 4px 10px">Variantes : ${d.groups.map((g) => `${esc(g.name)} (${g.options.map((o) => esc(o.name)).join(' / ')})`).join(' ; ')}. Quantités de la 1re option.</p>` : '');
// Tous les ingredients (par recette pour un plat compose).
const allIngs = (list) => list.map((x) => (x.own ? `${ingCard(x.ingredients || [], x.g)}${variantsNote(x)}` : (x.ingredients || []).length ? `<div class="part">${partHead(x)}${ingCard(x.ingredients, x.g)}</div>` : '')).join('')
  || '<div class="empty">Pas d’ingrédients renseignés.</div>';
const stepperHtml = (p) => `<div class="card row"><span class="grow"><b>Pour ${p} personne${p > 1 ? 's' : ''}</b><span class="muted block">quantités ajustées</span></span>
  <span class="stepper"><button data-a="cook-p" data-d="-1" aria-label="Moins">${I('minus')}</button><b>${p}</b><button data-a="cook-p" data-d="1" aria-label="Plus">${I('plus')}</button></span></div>`;
const cookStep = () => Number(S.q[`cs${ed.id}`] || 0);

export function cookView() {
  setTimeout(syncWake);
  const d = ed, { p, list } = cookParts();
  const head = { title: d.name, back: `#/plats/${d.id}`, noNav: true, sub: `${d.time_text ? `⏱ ${d.time_text}` : ''}${wakeLock ? `${d.time_text ? ' · ' : ''}écran allumé` : ''}` };
  if (isPc()) {
    const block = (x) => { const st = stepsOf(x.steps); return `${ingCard(x.ingredients || [], x.g)}${st.length ? `<div class="card"><ol class="steps">${st.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>` : ''}${x.notes ? `<p class="muted pre" style="margin:0 4px 10px">${esc(x.notes)}</p>` : ''}${x.url ? `<a class="btn sec2 sm" href="${esc(x.url)}" target="_blank" rel="noopener">${I('link', 's')} Recette en ligne</a>` : ''}`; };
    return { ...head, body: `${stepperHtml(p)}${block(list[0])}${variantsNote(d)}${list.slice(1).map((x) => `<div class="part">${partHead(x)}${block(x)}</div>`).join('')}` };
  }
  // Telephone : etape 0 = ingredients, puis une etape par ligne des consignes.
  const steps = list.flatMap((x) => stepsOf(x.steps).map((t) => ({ text: t, part: x.own ? null : x.name })));
  const n = steps.length, k = Math.min(cookStep(), n);
  const bar = `<div class="ck-bar">${[0, ...steps.map((_, i) => i + 1)].map((i) => `<span class="${i === k ? 'on' : i < k ? 'past' : ''}"></span>`).join('')}</div>`;
  const links = list.filter((x) => x.url).map((x) => `<a class="btn sec2 sm" href="${esc(x.url)}" target="_blank" rel="noopener">${I('link', 's')} ${list.length > 1 ? esc(x.name) : 'Recette en ligne'}</a>`).join(' ');
  const notes = list.filter((x) => x.notes).map((x) => `<p class="muted pre small" style="margin:10px 4px">${list.length > 1 ? `<b>${esc(x.name)}</b> · ` : ''}${esc(x.notes)}</p>`).join('');
  let body, dock;
  if (k === 0) {
    body = `${n ? bar : ''}<div class="ck-label">Ingrédients</div>${stepperHtml(p)}${allIngs(list)}
      ${n ? '' : `<p class="muted" style="margin:10px 4px">Pas d’étapes renseignées.</p>${links}`}${n ? '' : notes}`;
    dock = n ? `<button class="btn full" data-a="ck-go" data-d="1">Commencer · ${n} étape${n > 1 ? 's' : ''} ${I('arrowR', 's')}</button>` : null;
  } else {
    const st = steps[k - 1], prevPart = k > 1 ? steps[k - 2].part : null;
    body = `${bar}<div class="ck-label">Étape ${k} sur ${n}${st.part ? ` · ${esc(st.part)}` : ''}</div>
      ${st.part && st.part !== prevPart ? `<p class="muted small" style="margin:0 2px 8px">${I('puzzle', 's')} Recette « ${esc(st.part)} »</p>` : ''}
      <div class="ck-step" data-swipe="1">${esc(st.text)}</div>
      ${k === n ? `${notes}${links ? `<div style="margin-top:12px">${links}</div>` : ''}` : ''}`;
    dock = `<button class="btn sec2" data-a="ck-go" data-d="-1" aria-label="Étape précédente">${I('back')}</button>
      <button class="btn sec2 grow" data-a="ck-ings">${I('bowl', 's')} Ingrédients</button>
      ${k < n ? `<button class="btn" data-a="ck-go" data-d="1" aria-label="Étape suivante">Suivante ${I('arrowR', 's')}</button>` : `<a class="btn" href="#/plats/${d.id}">${I('check', 's')} Terminé</a>`}`;
  }
  return { ...head, body, dock };
}
on('click', 'cook-p', (el) => { const k = `cp${ed.id}`; S.q[k] = Math.max(1, Number(S.q[k] || S.route[2] || ed.portions) + Number(el.dataset.d)); render(); });
function ckGo(delta) {
  const { list } = cookParts(), n = list.reduce((a, x) => a + stepsOf(x.steps).length, 0);
  const k = Math.max(0, Math.min(n, cookStep() + delta));
  if (k === cookStep()) return;
  S.q[`cs${ed.id}`] = k;
  render();
  window.scrollTo(0, 0);
}
on('click', 'ck-go', (el) => ckGo(Number(el.dataset.d)));
// Ingredients sans quitter l'etape (panneau), personnes modifiables.
on('click', 'ck-ings', () => {
  const { p, list } = cookParts();
  sheet(`<h3>${I('bowl', 's')} Ingrédients · ${p} personne${p > 1 ? 's' : ''}</h3>${allIngs(list)}`);
});
// Glisser horizontalement sur l'etape : suivante / precedente.
let swipe = null;
document.addEventListener('touchstart', (e) => {
  if (!location.hash.includes('/cuisine') || isPc() || e.touches.length > 1 || e.target.closest('.sheet, .dock, button, a, input')) { swipe = null; return; }
  swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!swipe) return;
  const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
  swipe = null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) ckGo(dx < 0 ? 1 : -1);
}, { passive: true });

// Ecran allume tant que le mode cuisine est ouvert et visible (si le navigateur le
// permet) ; le navigateur relache le verrou quand l'app passe en arriere-plan.
let wakeLock = null, wakeBusy = false;
export const isAwake = () => !!wakeLock;
export async function syncWake() {
  const want = /\/(cuisine|magasin\/)/.test(location.hash) && document.visibilityState === 'visible';
  if (want && !wakeLock && !wakeBusy && 'wakeLock' in navigator) {
    wakeBusy = true;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; if (/\/(cuisine|magasin\/)/.test(location.hash)) render(); });
      if (/\/(cuisine|magasin\/)/.test(location.hash)) render();
    } catch { /* refuse (economie d'energie, page non securisee) : veille normale */ }
    wakeBusy = false;
  } else if (!want && wakeLock) { const w = wakeLock; wakeLock = null; w.release().catch(() => {}); }
}
// Entree dans le mode cuisine : on repart des ingredients.
window.addEventListener('hashchange', (e) => {
  if (location.hash.includes('/cuisine') && !String(e.oldURL).includes('/cuisine')) Object.keys(S.q).filter((k) => /^cs\d/.test(k)).forEach((k) => delete S.q[k]);
  syncWake();
});
document.addEventListener('visibilitychange', syncWake);
