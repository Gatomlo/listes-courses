// Plats : liste (recherche par nom ou ingredient, filtres), fiche (informations,
// ingredients, recette facultative avec import depuis un lien, menu et historique).
import { esc, fmtDate, on, acc, sheet, closeSheet, confirmSheet, toast, formData } from './ui.js';
import { get, post, put, del, attempt } from './api.js';
import { S, hp, isManager, render, go, loadHouse, loadProducts, catName, categoryOrder } from './state.js';
import { matchLines } from './ticket.mjs';
import { unitOptions, catOptions } from './catalogue.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (d) => Math.round((Date.parse(today()) - Date.parse(d)) / 864e5);
export const SLOT = { pdj: 'P.-déj.', midi: 'Midi', soir: 'Soir', coll: 'Collation' };
const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };
const fmtQ = (q) => String(Math.round(q * 10) / 10).replace('.', ',');
// Unite d'un ingredient : NULL = emballages du produit, sinon g / ml / pieces.
const IUNITS = [['g', 'g'], ['ml', 'ml'], ['pc', 'pièce']];
const iunitLabel = (i) => (i.iunit ? IUNITS.find(([k]) => k === i.iunit)[1] : i.unit);
const amountText = (q, i) => (i.iunit === 'g' && q >= 1000 ? `${fmtQ(q / 1000)} kg` : i.iunit === 'ml' && q >= 1000 ? `${fmtQ(q / 1000)} L` : `${fmtQ(q)} ${iunitLabel(i)}${i.iunit === 'pc' && q > 1 ? 's' : ''}`);
// Conversion possible en emballages (meme regle que lib/units.js, g et ml equivalents).
function convertible(i) {
  if (!i.iunit) return true;
  const p = (S.products || []).find((x) => x.id === i.product_id);
  if (!p) return i.conv !== false;
  if (!p.size) return false;
  const mass = (u) => u === 'g' || u === 'ml';
  return p.size.u === i.iunit || (mass(p.size.u) && mass(i.iunit)) || p.piece_qty > 0;
}

export async function loadDishes() { S.dishes = await get(hp('/dishes')); }
// Tags connus : ceux du foyer (S.house.tags) et ceux des plats charges.
export const allTags = () => [...new Set([...(S.house.tags || []).map((t) => t.name), ...(S.dishes || []).flatMap((d) => d.tags)])].sort((a, b) => a.localeCompare(b, 'fr'));
// Pastilles de filtre par tag (action « act », tag actif « cur »).
export const tagChips = (act, cur) => {
  const ts = allTags();
  return ts.length ? `<div class="opt tags">${ts.map((t) => `<button class="${cur === t ? 'on' : ''}" data-a="${act}" data-t="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : '';
};

// ---------- Liste des plats ----------
export function platsView() {
  const q = S.q.dish || '', f = S.q.dishFilter || 'all', tg = S.q.dishTag || '';
  const n = norm(q).trim();
  const list = S.dishes.filter((d) => (!n || norm(d.name).includes(n) || d.tags.some((x) => norm(x).includes(n)) || d.ingredient_names.some((x) => norm(x).includes(n)))
    && (!tg || d.tags.includes(tg))
    && (f === 'all' || (f === 'recipe' && d.has_recipe) || (f === 'memo' && !d.ingredients) || (f === 'planned' && d.next_date)));
  const card = (d) => {
    const hits = n && !norm(d.name).includes(n) ? d.ingredient_names.filter((x) => norm(x).includes(n)) : [];
    return `<a class="card click" href="#/plats/${d.id}"><h4>${esc(d.name)}${d.has_recipe ? ' <span class="pill p-plum">📖</span>' : ''}</h4>
      <div class="muted">${hits.length ? 'contient ' + esc(hits.join(', ')) : d.ingredients ? `${d.ingredients} ingrédient${d.ingredients > 1 ? 's' : ''}${d.time_text ? ' · ⏱ ' + esc(d.time_text) : ''}` : 'Ingrédients connus par cœur'}</div>
      <div class="pills">${d.tags.map((t) => `<span class="pill p-grey">#${esc(t)}</span>`).join('')}${d.next_date ? `<span class="pill p-leaf">prévu ${esc(fmtDate(d.next_date, { weekday: 'short', day: 'numeric', month: 'short' }))}</span>` : ''}<span class="pill p-grey">${d.last_date ? `dernière fois il y a ${daysAgo(d.last_date)} j` : 'jamais servi'}</span></div></a>`;
  };
  return {
    title: 'Plats', sub: `${S.dishes.length} plat${S.dishes.length > 1 ? 's' : ''} du foyer`,
    body: `<input class="txt" id="dish-q" placeholder="🔍 Rechercher un plat ou un ingrédient…" value="${esc(q)}" data-in="dish-q">
      <div class="opt">${[['all', 'Tous'], ['recipe', '📖 Avec recette'], ['memo', 'Sans détail'], ['planned', 'Au menu']].map(([k, t]) => `<button class="${f === k ? 'on' : ''}" data-a="dish-filter" data-f="${k}">${t}</button>`).join('')}</div>
      ${tagChips('dish-tag', tg)}
      <div class="cards3">${list.map(card).join('')}</div>
      ${list.length ? '' : `<p class="muted">Aucun plat trouvé.</p>${isManager() && q ? `<button class="btn" data-a="dish-new-named">＋ Créer le plat « ${esc(q)} »</button>` : ''}`}
      ${isManager() ? '<a class="fab" href="#/plats/nouveau" title="Nouveau plat">＋</a>' : ''}`,
  };
}
on('input', 'dish-q', (el) => { S.q.dish = el.value; render(); const i = document.getElementById('dish-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
on('click', 'dish-filter', (el) => { S.q.dishFilter = el.dataset.f; render(); });
on('click', 'dish-tag', (el) => { S.q.dishTag = S.q.dishTag === el.dataset.t ? '' : el.dataset.t; render(); });
on('click', 'dish-new-named', () => { pendingName = S.q.dish; go('#/plats/nouveau'); });

// ---------- Fiche plat ----------
let ed = null;          // plat en cours d'edition
let pendingName = '';
// Creation depuis le menu : S.dishReturn = { date, slot } ; apres enregistrement, retour au menu.
export function newDishFrom(name, ret) { pendingName = name || ''; S.dishReturn = ret; go('#/plats/nouveau'); }
export async function loadDish(id) {
  if (!S.products) await loadProducts();
  if (id === 'nouveau') {
    ed = { id: null, name: pendingName || '', portions: 4, time_text: '', url: '', steps: '', notes: '', ingredients: [], groups: [], tags: [], upcoming: [], past: [], times: 0 };
    pendingName = '';
  } else {
    S.dishReturn = null;
    const d = await get(hp(`/dishes/${id}`));
    ed = { ...d, steps: d.steps || '', notes: d.notes || '', url: d.url || '', time_text: d.time_text || '' };
  }
}
export const currentDish = () => ed;

export function dishView() {
  const ro = !isManager(), dis = ro ? 'disabled' : '';
  const nIng = ed.ingredients.length;
  const ingRows = (t, empty) => ingsOf(t).map((i, k) => `<div class="item"><span class="grow">${esc(i.name)}${i.note ? ` <span class="muted small">· ${esc(i.note)}</span>` : ''}</span>
    ${i.is_base ? '<span class="pill p-grey">de base</span>' : `<input class="txt w5 sm c" value="${i.qty != null ? fmtQ(i.qty) : ''}" placeholder="—" ${dis} data-ch="ing-qty" data-t="${t}" data-k="${k}"><select class="txt sm w6" ${dis} data-ch="ing-unit" data-t="${t}" data-k="${k}" aria-label="Unité">${[['', i.unit], ...IUNITS].map(([v, l]) => `<option value="${v}" ${(i.iunit || '') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    ${convertible(i) ? '' : `<a class="pill p-carrot" href="#/catalogue/${i.product_id}" title="Indiquer la contenance de l'emballage (ex. 500 g) ou le poids d'une pièce dans la fiche produit ; en attendant : 1 ${esc(i.unit)}">⚠ contenance ?</a>`}`}
    ${ro ? '' : `<button class="ic" data-a="ing-del" data-t="${t}" data-k="${k}" title="Retirer">✕</button>`}</div>`).join('') || empty;
  const ingAdd = (t, ph) => (ro ? '' : `<div class="addbox" style="margin:8px 0"><input class="txt" id="ing-q-${t}" autocomplete="off" placeholder="${ph}" data-in="ing-q" data-t="${t}" data-enter="ing-first"><div id="ing-ac-${t}"></div></div>`);
  const variants = acc('d_var', {
    icon: '🔀', title: 'Variantes', sum: ed.groups.length ? ` · ${ed.groups.map((g) => esc(g.name)).join(', ')}` : ' · facultatives',
    body: `<p class="muted small" style="margin-top:8px">Un choix par groupe au moment de mettre le plat au menu (ex. Légume : carottes / épinards ; Viande : saucisse / pain de viande). Les ingrédients ci-dessus sont communs à toutes les variantes.</p>
      ${ed.groups.map((g, gk) => `<div class="vgrp"><div class="row gap"><input class="txt grow" value="${esc(g.name)}" placeholder="Nom du groupe (ex. Viande)" ${dis} data-ch="grp-name" data-g="${gk}">${ro ? '' : `<button class="ic" data-a="grp-del" data-g="${gk}" title="Retirer le groupe">✕</button>`}</div>
        ${g.options.map((o, ok) => `<div class="vopt"><div class="row gap"><input class="txt grow" value="${esc(o.name)}" placeholder="Option (ex. saucisse)" ${dis} data-ch="opt-name" data-g="${gk}" data-o="${ok}">${ro ? '' : `<button class="ic" data-a="opt-del" data-g="${gk}" data-o="${ok}" title="Retirer l’option">✕</button>`}</div>
          ${ingRows(`${gk}-${ok}`, '<p class="muted small">Pas d’ingrédient propre à cette option.</p>')}${ingAdd(`${gk}-${ok}`, `＋ Ingrédient pour « ${esc(o.name || 'cette option')} »…`)}</div>`).join('')}
        ${ro ? '' : `<button class="btn sec2 sm" data-a="opt-add" data-g="${gk}">＋ Option</button>`}</div>`).join('')}
      ${ro ? '' : `<button class="btn sec2 sm" style="margin:8px 0" data-a="grp-add">＋ Groupe de variantes</button>`}`,
  });
  const plan = ed.id ? acc('d_menu', {
    icon: '📅', title: 'Au menu', def: true,
    sum: `${ed.upcoming.length ? ` · prévu ${esc(fmtDate(ed.upcoming[0].date, { weekday: 'short', day: 'numeric', month: 'short' }))}` : ' · rien de prévu'}${ed.times ? ` · ${ed.times} fois` : ''}`,
    body: `<div class="muted small" style="margin-top:8px">À venir</div>
      ${ed.upcoming.map((m) => mealRow(m)).join('') || '<p class="muted">Pas encore prévu au menu.</p>'}
      <button class="btn sec2 sm" style="margin:6px 0" data-a="plan-dish" data-id="${ed.id}">📅 ${ro ? 'Suggérer au menu' : 'Ajouter au menu'}</button>
      <div class="muted small" style="margin-top:8px">Historique${ed.times > 5 ? ' · 5 dernières fois' : ''}</div>
      ${ed.times ? `<div class="pills"><span class="pill p-leaf">${ed.times} fois planifié</span><span class="pill p-grey">dernière il y a ${daysAgo(ed.past[0].date)} j</span>${ed.times > 1 ? `<span class="pill p-grey">en moyenne tous les ${Math.round(daysAgo(ed.first_date) / (ed.times - 1))} j</span>` : ''}</div>${ed.past.map((m) => mealRow(m)).join('')}` : '<p class="muted">Jamais planifié pour l’instant.</p>'}`,
  }) : '';
  return {
    title: ed.id ? ed.name : 'Nouveau plat', sub: ro ? 'Lecture seule (membre)' : ed.id ? 'Plat du foyer' : '', back: !ed.id && S.dishReturn ? '#/menu' : '#/plats',
    body: `${acc('d_info', { icon: '📝', title: 'Informations', def: true, sum: ` · ${ed.portions} pers.${ed.time_text ? ' · ⏱ ' + esc(ed.time_text) : ''}`,
        body: `<div class="form"><label class="muted">Nom</label><input class="txt" value="${esc(ed.name)}" ${dis} data-ch="ed" data-f="name">
          <div class="row gap"><label class="grow"><span class="muted">Portions de référence</span><input class="txt" type="number" min="1" value="${ed.portions}" ${dis} data-ch="ed" data-f="portions"></label>
          <label class="grow"><span class="muted">Temps</span><input class="txt" value="${esc(ed.time_text)}" placeholder="ex. 45 min" ${dis} data-ch="ed" data-f="time_text"></label></div>
          <label class="muted">Tags</label>
          <div class="pills">${ed.tags.map((t, k) => `<span class="pill p-grey">#${esc(t)}${ro ? '' : ` <button class="x" data-a="tag-rm" data-i="${k}" aria-label="Retirer">✕</button>`}</span>`).join('') || (ro ? '<span class="muted small">Aucun</span>' : '')}</div>
          ${ro ? '' : `<div class="row gap"><input class="txt grow" id="tag-in" list="tag-dl" placeholder="ex. rapide, végé, hiver…" data-enter="tag-add"><button class="btn sm sec2" data-a="tag-add">＋</button></div>
          <datalist id="tag-dl">${allTags().filter((t) => !ed.tags.includes(t)).map((t) => `<option value="${esc(t)}">`).join('')}</datalist>`}</div>` })}
      ${acc('d_ing', { icon: '🥕', title: 'Ingrédients', def: true, sum: ` · ${nIng || 'aucun'}`,
        body: `${ingRows('c', '<p class="muted">Aucun ingrédient : le plat sera un simple rappel dans la liste.</p>')}${ingAdd('c', '＋ Ajouter un ingrédient (produit)…')}${ro ? '' : `
          <p class="muted small">Quantités facultatives, ajustées au nombre de personnes du repas : en emballages, ou en g, ml, pièces (convertis en emballages grâce à la contenance du produit).</p>`}` })}
      ${variants}
      ${acc('d_rec', { icon: '📖', title: 'Recette', sum: ed.url || ed.steps || ed.notes ? ' · renseignée' : ' · facultative, vide',
        body: `<div class="form"><label class="muted">Lien vers une recette en ligne</label><div class="row gap"><input class="txt grow" value="${esc(ed.url)}" placeholder="https://…" ${dis} data-ch="ed" data-f="url">${ro ? '' : '<button class="btn sm" data-a="rec-import">⤓ Importer</button>'}</div>
          ${ro ? '' : '<p class="muted small">Importer lit nom, portions, temps, ingrédients et étapes quand le site les publie.</p>'}
          <label class="muted">Étapes (une par ligne)</label><textarea class="txt" rows="6" ${dis} data-ch="ed" data-f="steps">${esc(ed.steps)}</textarea>
          <label class="muted">Notes</label><textarea class="txt" rows="2" ${dis} data-ch="ed" data-f="notes">${esc(ed.notes)}</textarea>
          ${ed.id ? `<button class="btn sec2 sm" style="margin-top:8px" data-a="recipe-view" data-id="${ed.id}">📖 ${ro ? 'Voir' : 'Aperçu de'} la recette</button>` : ''}</div>` })}
      ${plan}
      ${ro ? '' : `<div class="row end">${ed.id ? '<button class="btn sec2 danger-t" data-a="dish-del">Supprimer</button>' : ''}<button class="btn" data-a="dish-save">Enregistrer</button></div>`}`,
  };
}
const mealRow = (m) => `<div class="item click" data-a="meal-open" data-id="${m.id}" data-date="${m.date}"><span class="muted w8">${esc(fmtDate(m.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</span><span class="grow">${SLOT[m.slot]} · ${m.persons} pers.</span><span class="muted">›</span></div>`;

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
const addIng = (p, qty = 1, note = null, t = ingT, iunit = null) => {
  ingsOf(t).push({ product_id: p.id, name: p.name, unit: p.unit, iunit: p.is_base ? null : iunit, is_base: !!p.is_base, qty: p.is_base ? null : qty, note });
};
on('click', 'ing-add', (el) => { addIng(S.products.find((p) => p.id === Number(el.dataset.id))); render(); ingInput()?.focus(); });
on('click', 'ing-first', (el) => { ingT = el.dataset.t; const ms = ingMatches(el.value); if (ms.length) { addIng(ms[0]); render(); ingInput()?.focus(); } });
on('click', 'ing-new', () => {
  const q = ingInput().value.trim();
  sheet(`<h3>Nouveau produit</h3><p class="muted small">Ajouté aux produits du foyer, puis au plat.</p>
    <label class="muted">Nom</label><input class="txt" name="name" value="${esc(q.charAt(0).toUpperCase() + q.slice(1))}">
    <div class="row gap"><label class="grow"><span class="muted">Rayon</span><select class="txt" name="category_id">${catOptions()}</select></label>
    <label class="grow"><span class="muted">Emballage</span><select class="txt" name="unit">${unitOptions('paquet')}</select></label></div>
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
  const body = { ...ed, ingredients: ings(ed.ingredients),
    groups: ed.groups.map((g) => ({ name: g.name, options: g.options.map((o) => ({ id: o.id, name: o.name, ingredients: ings(o.ingredients) })) })) };
  const d = await attempt(() => (ed.id ? put(hp(`/dishes/${ed.id}`), body) : post(hp('/dishes'), body)));
  if (!d) return;
  const isNew = !ed.id;
  ed = { ...d, steps: d.steps || '', notes: d.notes || '', url: d.url || '', time_text: d.time_text || '' };
  S.dishes = null;
  loadHouse().catch(() => {}); // tags du foyer (ecran Foyer)
  toast(isNew ? 'Plat créé' : 'Plat enregistré · listes recalculées');
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
export async function recipeSheet(dishId, persons, options) {
  const d = ed && ed.id === dishId ? ed : await attempt(() => get(hp(`/dishes/${dishId}`)));
  if (!d) return;
  const p = persons || d.portions, f = p / d.portions;
  const steps = String(d.steps || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const row = (i) => `<div class="item"><span class="grow">${esc(i.name)}${i.note ? ` <span class="muted small">· ${esc(i.note)}</span>` : ''}</span>${i.is_base || i.qty == null ? '<span class="pill p-grey">selon goût</span>' : `<b class="price">${esc(amountText(i.qty * f, i))}</b>`}</div>`;
  const groups = d.groups || [], keep = options ? new Set(chosenOf(d, options)) : null;
  const variant = keep ? groups.map((g) => g.options.find((o) => keep.has(o.id)).name).join(', ') : '';
  const ings = keep ? dishIngredients(d, options) : d.ingredients;
  sheet(`<h3>📖 ${esc(d.name)}${variant ? ` · ${esc(variant)}` : ''}</h3><p class="muted">${d.time_text ? '⏱ ' + esc(d.time_text) + ' · ' : ''}pour ${p} personne${p > 1 ? 's' : ''}</p>
    ${ings.length ? `<div class="sec">Ingrédients</div>${ings.map(row).join('')}` : ''}
    ${keep ? '' : groups.map((g) => `<div class="sec">${esc(g.name)} · au choix</div>${g.options.map((o) => `<div class="item"><b class="grow">${esc(o.name)}</b></div>${o.ingredients.map(row).join('')}`).join('')}`).join('')}
    ${steps.length ? `<div class="sec">Préparation</div><ol class="steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    ${d.notes ? `<div class="sec">Notes</div><p>${esc(d.notes)}</p>` : ''}
    ${d.url ? `<a class="btn sec2 full" href="${esc(d.url)}" target="_blank" rel="noopener">🔗 Ouvrir la recette en ligne</a>` : ''}
    ${!ings.length && !groups.length && !steps.length && !d.notes && !d.url ? '<p class="muted">Aucune recette renseignée pour ce plat.</p>' : ''}
    <div class="row end"><button class="btn sec2" data-a="close">Fermer</button></div>`);
}
on('click', 'recipe-view', (el) => recipeSheet(Number(el.dataset.id)));

// ---------- Import d'une recette depuis un lien ----------
let imp = null;
on('click', 'rec-import', async () => {
  const url = (ed.url || '').trim();
  if (!url) { toast('Collez d’abord le lien de la recette.', true); return; }
  sheet('<h3>Chargement de la recette…</h3><p class="muted">Lecture des données de la page (schema.org/Recipe).</p>');
  const r = await attempt(() => post(hp('/recipe-import'), { url }));
  if (!r) { closeSheet(); return; }
  if (!S.products) await loadProducts();
  const matched = matchLines(r.ingredients.map((g) => ({ ...g, label: g.name })), { products: S.products });
  imp = {
    ...r, f: { name: !ed.name, portions: !!r.portions, time: !!r.time, steps: r.steps.length > 0 },
    ing: matched.map((g) => ({ ...g, on: true, create: g.product_id ? null : { name: g.name.charAt(0).toUpperCase() + g.name.slice(1), category_id: categoryOrder()[0], unit: 'paquet', is_base: g.base } })),
  };
  importSheet();
});
function importSheet() {
  const m = imp;
  const prod = (id) => S.products.find((p) => p.id === id);
  sheet(`<h3>📖 ${esc(m.name || 'Recette')}</h3><p class="muted small">Trouvé sur la page : cocher ce qu'il faut reprendre.</p>
    ${[['name', 'Nom', m.name], ['portions', 'Portions', m.portions && `${m.portions} personnes`], ['time', 'Temps', m.time], ['steps', 'Étapes', m.steps.length && `${m.steps.length} étapes`]]
      .filter(([, , v]) => v).map(([k, t, v]) => `<label class="row line"><input type="checkbox" class="cb" data-ch="imp-f" data-k="${k}" ${m.f[k] ? 'checked' : ''}><span class="grow"><b>${t}</b> · ${esc(v)}</span></label>`).join('')}
    <div class="sec">Ingrédients (${m.ing.length})</div>
    ${m.ing.map((g, i) => `<label class="row line top"><input type="checkbox" class="cb" data-ch="imp-ing" data-i="${i}" ${g.on ? 'checked' : ''}><span class="grow"><span class="muted small">« ${esc(g.raw)} »</span><br>
      ${g.product_id ? `→ ${esc(prod(g.product_id).name)}` : `→ <span class="pill p-carrot">＋ créer</span> ${esc(g.create.name)} <span class="muted small">(${esc(catName(g.create.category_id))})</span>`}${g.base ? ' <span class="pill p-grey">de base</span>' : ''}</span></label>`).join('')}
    <p class="muted small">Les produits manquants seront créés dans les produits (rayon modifiable ensuite). Les quantités en g, ml ou pièces sont converties en emballages dans les listes (contenance du produit).</p>
    <div class="row end"><button class="btn sec2" data-a="close">Annuler</button><button class="btn" data-a="imp-ok">Appliquer au plat</button></div>`);
}
on('change', 'imp-f', (el) => { imp.f[el.dataset.k] = el.checked; });
on('change', 'imp-ing', (el) => { imp.ing[Number(el.dataset.i)].on = el.checked; });
on('click', 'imp-ok', async () => {
  const m = imp;
  if (m.f.name && m.name) ed.name = m.name;
  if (m.f.portions && m.portions) ed.portions = m.portions;
  if (m.f.time && m.time) ed.time_text = m.time;
  if (m.f.steps) ed.steps = m.steps.join('\n');
  let created = 0;
  for (const g of m.ing.filter((x) => x.on)) {
    let p = g.product_id ? S.products.find((x) => x.id === g.product_id) : null;
    if (!p) {
      p = await attempt(() => post(hp('/products'), g.create));
      if (!p) continue;
      S.products.push(p);
      created++;
    }
    if (ed.ingredients.some((i) => i.product_id === p.id)) continue;
    // Sans equivalent (gousse, pincee...) : 1 emballage, la quantite lue gardee en note.
    if (g.amount != null) addIng(p, g.amount, null, 'c', g.amount_unit);
    else addIng(p, 1, g.qty != null ? `${String(g.qty).replace('.', ',')}${g.unit ? ' ' + g.unit : ''}` : null, 'c');
  }
  closeSheet();
  await loadProducts();
  toast(`Recette importée${created ? ` · ${created} produit${created > 1 ? 's' : ''} créé${created > 1 ? 's' : ''}` : ''} · enregistrer pour garder`);
  render();
});
