// Plats : liste (recherche par nom ou ingredient, filtres), fiche (informations,
// ingredients, recette facultative avec import depuis un lien, menu et historique).
import { esc, fmtDate, on, acc, sheet, closeSheet, confirmSheet, toast, formData } from './ui.js';
import { get, post, put, del, attempt } from './api.js';
import { S, hp, isManager, render, go, loadHouse, loadProducts, catName, categoryOrder } from './state.js';
import { matchLines } from './ticket.mjs';
import { unitOptions, catOptions, contField } from './catalogue.js';
import { I, btnI } from './icons.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (d) => Math.round((Date.parse(today()) - Date.parse(d)) / 864e5);
export const SLOT = { pdj: 'P.-déj.', midi: 'Midi', soir: 'Soir', coll: 'Collation' };
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

export async function loadDishes() { S.dishes = await get(hp('/dishes')); }
// Tags connus : ceux du foyer (S.house.tags) et ceux des plats charges.
export const allTags = () => [...new Set([...(S.house.tags || []).map((t) => t.name), ...(S.dishes || []).flatMap((d) => d.tags)])].sort((a, b) => a.localeCompare(b, 'fr'));
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
export function platsView() {
  const q = S.q.dish || '', f = S.q.dishFilter || 'all', tg = S.q.dishTag || '';
  const n = norm(q).trim();
  const list = S.dishes.filter((d) => (!n || norm(d.name).includes(n) || d.tags.some((x) => norm(x).includes(n)) || d.ingredient_names.some((x) => norm(x).includes(n)) || (d.part_names || []).some((x) => norm(x).includes(n)))
    && (!tg || d.tags.includes(tg))
    && (f === 'all' || (f === 'recipe' && d.has_recipe) || (f === 'memo' && !d.ingredients && !d.parts) || (f === 'planned' && d.next_date) || (f === 'draft' && d.draft) || (f === 'parts' && d.parts)));
  const card = (d) => {
    const hits = n && !norm(d.name).includes(n) ? [...(d.part_names || []), ...d.ingredient_names].filter((x) => norm(x).includes(n)) : [];
    const pills = `${d.parts ? `<span class="pill">${I('puzzle', 's')} ${d.parts}</span>` : ''}${d.has_recipe ? `<span class="pill">${I('book', 's')}</span>` : ''}${d.draft ? `<span class="pill">${I('edit', 's')}</span>` : ''}`;
    return `<a class="dcard" href="#/plats/${d.id}">${tile(d.name, pills, '', d.photo)}<div><h4>${esc(d.name)}</h4>
      <div class="muted small">${hits.length ? 'contient ' + esc(hits.join(', ')) : d.next_date ? `<span style="color:var(--leaf);font-weight:600">prévu ${esc(fmtDate(d.next_date, { weekday: 'short', day: 'numeric' }))}</span>` : d.last_date ? `il y a ${daysAgo(d.last_date)} j` : 'jamais servi'}</div></div></a>`;
  };
  return {
    title: 'Plats', sub: `${S.dishes.length} plat${S.dishes.length > 1 ? 's' : ''} du foyer`, large: true,
    right: isManager() ? `<a class="ib" href="#/plats/nouveau" aria-label="Nouveau plat">${I('plus')}</a>` : '',
    body: `<div class="search">${I('search')}<input class="txt" id="dish-q" placeholder="Plat, ingrédient, recette…" value="${esc(q)}" data-in="dish-q"></div>
      <div class="opt">${[['all', 'Tous'], ['recipe', 'Avec recette'], ['parts', 'Composés'], ['planned', 'Au menu'], ['memo', 'Sans détail'], ['draft', 'Suggestions']].map(([k, t]) => `<button class="${f === k ? 'on' : ''}" data-a="dish-filter" data-f="${k}">${t}</button>`).join('')}</div>
      ${tagChips('dish-tag', tg)}
      <div class="dgrid" style="margin-top:8px">${list.map(card).join('')}</div>
      ${list.length ? '' : `<div class="empty">Aucun plat trouvé.${isManager() && q ? `<br><button class="btn" style="margin-top:10px" data-a="dish-new-named">＋ Créer le plat « ${esc(q)} »</button>` : ''}</div>`}`,
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
    ed = { id: null, name: pendingName || '', portions: 4, time_text: '', url: '', steps: '', notes: '', ingredients: [], groups: [], parts: [], used_in: [], tags: [], upcoming: [], past: [], times: 0 };
    pendingName = '';
  } else {
    S.dishReturn = null;
    const d = await get(hp(`/dishes/${id}`));
    ed = { parts: [], used_in: [], ...d, steps: d.steps || '', notes: d.notes || '', url: d.url || '', time_text: d.time_text || '' };
  }
}
export const currentDish = () => ed;

// Fiche : vignette et informations, puis onglets Ingredients / Recette / Composition /
// Historique ; « Cuisiner » et « Ajouter au menu » en bas d'ecran.
export function dishView() {
  // Brouillon : modifiable par le membre qui l'a propose tant qu'il n'est pas valide.
  const mgr = isManager(), ro = !mgr && !(ed.draft && ed.draft_by === S.me.id), dis = ro ? 'disabled' : '';
  const ingRows = (t, empty) => ingsOf(t).map((i, k) => `<div class="item"><span class="grow">${esc(i.name)}${i.note ? ` <span class="muted small">· ${esc(i.note)}</span>` : ''}${i.is_base ? ' <span class="pill p-grey">de base</span>' : ''}</span>
    ${ro ? `<b class="price">${i.qty != null ? esc(amountText(i.qty, i)) : '<span class="muted fw4">selon goût</span>'}</b>` : `<input class="txt w5 sm c" value="${i.qty != null ? fmtQ(i.qty) : ''}" placeholder="—" data-ch="ing-qty" data-t="${t}" data-k="${k}"><select class="txt sm w6" data-ch="ing-unit" data-t="${t}" data-k="${k}" aria-label="Unité">${[['', i.unit], ...IUNITS].map(([v, l]) => `<option value="${v}" ${(i.iunit || '') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`}
    ${i.is_base || convertible(i) ? '' : `<a class="pill p-carrot" href="#/catalogue/${i.product_id}" title="Indiquer la contenance de l'emballage (ex. 500 g) ou le poids d'une pièce dans la fiche produit ; en attendant : 1 ${esc(i.unit)}">contenance ?</a>`}
    ${ro ? '' : `<button class="ib" data-a="ing-del" data-t="${t}" data-k="${k}" aria-label="Retirer">${I('x', 's')}</button>`}</div>`).join('') || empty;
  const ingAdd = (t, ph) => (ro ? '' : `<div class="addbox" style="margin:8px 0"><input class="txt" id="ing-q-${t}" autocomplete="off" placeholder="${ph}" data-in="ing-q" data-t="${t}" data-enter="ing-first"><div id="ing-ac-${t}"></div></div>`);
  const variants = !ed.groups.length && ro ? '' : `<div class="sec">Variantes <span class="fw4" style="text-transform:none;letter-spacing:0">un choix par groupe au menu</span></div>
      ${ed.groups.map((g, gk) => `<div class="card"><div class="row gap"><input class="txt grow" value="${esc(g.name)}" placeholder="Nom du groupe (ex. Viande)" ${dis} data-ch="grp-name" data-g="${gk}">${ro ? '' : `<button class="ib" data-a="grp-del" data-g="${gk}" aria-label="Retirer le groupe">${I('trash', 's')}</button>`}</div>
        ${g.options.map((o, ok) => `<div class="vopt"><div class="row gap"><input class="txt grow" value="${esc(o.name)}" placeholder="Option (ex. saucisse)" ${dis} data-ch="opt-name" data-g="${gk}" data-o="${ok}">${ro ? '' : `<button class="ib" data-a="opt-del" data-g="${gk}" data-o="${ok}" aria-label="Retirer l’option">${I('x', 's')}</button>`}</div>
          ${ingRows(`${gk}-${ok}`, '<p class="muted small">Pas d’ingrédient propre à cette option.</p>')}${ingAdd(`${gk}-${ok}`, `＋ Ingrédient pour « ${esc(o.name || 'cette option')} »…`)}</div>`).join('')}
        ${ro ? '' : `<button class="btn sec2 sm" data-a="opt-add" data-g="${gk}">＋ Option</button>`}</div>`).join('')}
      ${ro ? '' : `<button class="btn ghost" data-a="grp-add">${I('plus', 's')} Groupe de variantes</button>`}
      ${!ed.groups.length && !ro ? '<p class="muted small">Ex. Légume : carottes / épinards ; Viande : saucisse / haché. Les ingrédients ci-dessus sont communs à toutes les variantes.</p>' : ''}`;
  const tabIng = `<div class="card">${ingRows('c', ed.parts.length ? '<p class="muted">Rien en plus des recettes (ex. pain pita, olives…).</p>' : '<p class="muted">Aucun ingrédient : le plat sera un simple rappel dans la liste.</p>')}${ingAdd('c', '＋ Ajouter un ingrédient (produit)…')}</div>
    ${ro ? '' : '<p class="muted small" style="margin:0 4px">Quantités facultatives, ajustées au nombre de personnes : en emballages, ou en g, ml, pièces (convertis grâce à la contenance du produit).</p>'}${variants}`;
  const steps = String(ed.steps || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const tabRec = ro ? `${ed.url ? `<a class="card click row" href="${esc(ed.url)}" target="_blank" rel="noopener">${I('link')}<span class="grow small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ed.url)}</span>${I('arrowR', 's')}</a>` : ''}
      ${steps.length ? `<div class="card"><ol class="steps">${steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>` : '<div class="empty">Pas d’étapes renseignées.</div>'}${ed.notes ? `<div class="sec">Notes</div><div class="card pre">${esc(ed.notes)}</div>` : ''}`
    : `<div class="card form"><label class="muted small">Lien vers une recette en ligne</label><div class="row gap"><input class="txt grow" value="${esc(ed.url)}" placeholder="https://…" data-ch="ed" data-f="url">${mgr ? `<button class="btn sm" data-a="rec-import">${I('upload', 's')} Importer</button>` : ''}</div>
      ${mgr ? '<p class="muted small">Importer lit nom, portions, temps, ingrédients et étapes quand le site les publie.</p>' : ''}
      <label class="muted small">Étapes (une par ligne)</label><textarea class="txt" rows="7" data-ch="ed" data-f="steps">${esc(ed.steps)}</textarea>
      <label class="muted small">Notes</label><textarea class="txt" rows="2" data-ch="ed" data-f="notes">${esc(ed.notes)}</textarea></div>`;
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
  const tabs = [['ing', ed.parts.length ? 'Ingrédients' : 'Ingrédients'], ['rec', 'Recette'], ...(ed.used_in.length ? [] : [['parts', `Composition${ed.parts.length ? ` · ${ed.parts.length}` : ''}`]]), ...(ed.id ? [['hist', 'Historique']] : [])];
  const cur = tabs.some(([k]) => k === S.q.dtab) ? S.q.dtab : ed.parts.length ? 'parts' : 'ing';
  const pills = `${ed.parts.length ? `<span class="pill">${I('puzzle', 's')} plat composé</span>` : ''}${ed.tags.map((t) => `<span class="pill">#${esc(t)}</span>`).join('')}`;
  const info = ro ? `<h1 class="mid" style="font-size:26px;margin:14px 2px 4px">${esc(ed.name)}</h1>
      <p class="row small muted" style="margin:0 2px;flex-wrap:wrap">${I('users', 's')} ${ed.portions} pers.${ed.time_text ? ` · ${I('clock', 's')} ${esc(ed.time_text)}` : ''}</p>`
    : `<div class="card form" style="margin-top:12px"><label class="muted small">Nom</label><input class="txt" value="${esc(ed.name)}" data-ch="ed" data-f="name">
      <div class="row gap"><label class="grow"><span class="muted small">Portions de référence</span><input class="txt" type="number" min="1" value="${ed.portions}" data-ch="ed" data-f="portions"></label>
      <label class="grow"><span class="muted small">Temps</span><input class="txt" value="${esc(ed.time_text)}" placeholder="ex. 45 min" data-ch="ed" data-f="time_text"></label></div>
      <label class="muted small">Tags</label>
      <div class="pills">${ed.tags.map((t, k) => `<span class="pill p-grey">#${esc(t)} <button class="x" data-a="tag-rm" data-i="${k}" aria-label="Retirer">✕</button></span>`).join('')}</div>
      <div class="row gap" style="margin-top:6px"><input class="txt grow" id="tag-in" list="tag-dl" placeholder="ex. rapide, végé, hiver…" data-enter="tag-add"><button class="btn sm sec2" data-a="tag-add">＋</button></div>
      <datalist id="tag-dl">${allTags().filter((t) => !ed.tags.includes(t)).map((t) => `<option value="${esc(t)}">`).join('')}</datalist></div>`;
  return {
    title: ed.id ? ed.name : 'Nouveau plat', back: !ed.id && S.dishReturn ? '#/menu' : '#/plats',
    sub: ed.draft ? 'Proposition à valider par un gestionnaire' : ro ? 'Lecture seule (membre)' : '',
    right: ro ? '' : `${ed.id && mgr ? `<button class="ib" data-a="dish-del" aria-label="Supprimer">${I('trash')}</button>` : ''}<button class="btn sm" data-a="dish-save">${ed.draft && mgr ? 'Valider la fiche' : 'Enregistrer'}</button>`,
    body: `${ed.draft ? `<div class="banner">${I('edit')}<span>Proposé par un membre : ${mgr ? 'enregistrer valide la fiche' : 'à valider par un gestionnaire'}.</span></div>` : ''}
      <div class="split dish"><div>${tile(ed.name || '?', pills, 'hero-t', curPhoto())}
      ${ro ? '' : `<div class="btn-row" style="margin-top:8px">${btnI('camera', curPhoto() ? 'Changer la photo' : 'Ajouter une photo', 'data-a="dish-photo"')}${curPhoto() ? btnI('trash', 'Retirer la photo', 'data-a="dish-photo-x"', 'sec2 danger-t') : ''}</div>`}${info}
      ${ed.used_in.length ? `<p class="small" style="margin:8px 2px">${I('puzzle', 's')} Recette de ${ed.used_in.map((d) => `<a href="#/plats/${d.id}" style="color:var(--plum);font-weight:650">${esc(d.name)}</a>`).join(', ')}</p>` : ''}
      </div><div>
      <div class="seg" style="margin-top:14px">${tabs.map(([k, t]) => `<button class="${cur === k ? 'on' : ''}" data-a="dtab" data-k="${k}">${t}</button>`).join('')}</div>
      ${{ ing: tabIng, rec: tabRec, parts: tabParts, hist: tabHist }[cur]}</div></div>`,
    dock: ed.id ? `<div class="btn-row grow">${btnI('book', 'Cuisiner', `href="#/plats/${ed.id}/cuisine"`, 'sec2', 'a')}${btnI('calendar', mgr ? 'Ajouter au menu' : 'Suggérer au menu', `data-a="plan-dish" data-id="${ed.id}"`, '')}</div>` : null,
  };
}
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
const addPart = (d) => { ed.parts.push({ dish_id: d.id, name: d.name, portions: d.portions, dish_portions: d.portions }); };
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
    <div class="row gap"><label class="grow"><span class="muted">Rayon</span><select class="txt" name="category_id">${catOptions()}</select></label>
    <label class="grow"><span class="muted">Emballage</span><select class="txt" name="unit">${unitOptions('paquet')}</select></label></div>
    ${contField()}
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
  const body = { ...ed, ...(ed.photo_data ? { photo_data: ed.photo_data } : ed.photo_url ? { photo_url: ed.photo_url } : ed.photo_remove ? { photo: null } : {}), photo_preview: undefined, ingredients: ings(ed.ingredients), parts: ed.used_in.length ? undefined : ed.parts.map((p) => ({ dish_id: p.dish_id, portions: p.portions })),
    groups: ed.groups.map((g) => ({ name: g.name, options: g.options.map((o) => ({ id: o.id, name: o.name, ingredients: ings(o.ingredients) })) })) };
  const d = await attempt(() => (ed.id ? put(hp(`/dishes/${ed.id}`), body) : post(hp('/dishes'), body)));
  if (!d) return;
  const isNew = !ed.id, wasDraft = ed.draft;
  ed = { ...d, steps: d.steps || '', notes: d.notes || '', url: d.url || '', time_text: d.time_text || '' };
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
  const r = await attempt(() => post(hp('/recipe-import'), { url }));
  if (!r) { closeSheet(); return; }
  if (!S.products) await loadProducts();
  const matched = matchLines(r.ingredients.map((g) => ({ ...g, label: g.name })), { products: S.products });
  imp = {
    ...r, f: { name: !ed.name, portions: !!r.portions, time: !!r.time, steps: r.steps.length > 0, photo: !!r.image && !ed.photo },
    ing: matched.map((g) => { const p = g.product_id && S.products.find((x) => x.id === g.product_id);
      return { ...g, on: true, label: p ? p.name : g.name.charAt(0).toUpperCase() + g.name.slice(1),
        create: p ? null : { name: g.name.charAt(0).toUpperCase() + g.name.slice(1), category_id: categoryOrder()[0], unit: 'paquet', is_base: g.base } }; }),
  };
  importSheet();
});
// Ecran d'import : chaque ingredient peut etre renomme (nouveau produit) ou relie a un produit
// existant (nom choisi dans la liste) ; la quantite lue est affichee pour verification.
const impQty = (g) => (g.amount != null ? amountText(g.amount, { iunit: g.amount_unit, unit: 'emballage' }) : g.qty != null ? `${fmtQ(g.qty)}${g.unit ? ' ' + g.unit : ''} → 1 emballage` : '');
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
    <p class="muted small" style="margin:-4px 0 8px">Nom modifiable : choisissez un produit existant dans la liste pour le relier, ou gardez un nouveau nom pour le créer.</p>
    ${m.ing.map((g, i) => `<div class="imp-line"><input type="checkbox" class="cb" data-ch="imp-ing" data-i="${i}" ${g.on ? 'checked' : ''} aria-label="Reprendre">
      <div class="grow"><div class="muted small">« ${esc(g.raw)} »${impQty(g) ? ` · <b>${esc(impQty(g))}</b>` : ''}</div>
        <div class="row" style="margin-top:4px"><input class="txt sm grow" list="imp-dl" value="${esc(g.label)}" data-ch="imp-name" data-i="${i}" aria-label="Produit">
        <span class="pill ${g.product_id ? 'p-leaf' : 'p-carrot'}" id="imp-st-${i}">${g.product_id ? 'existant' : 'nouveau'}</span></div>
        <select class="txt sm" id="imp-cat-${i}" data-ch="imp-cat" data-i="${i}" style="margin-top:4px" ${g.product_id ? 'hidden' : ''} aria-label="Rayon du nouveau produit">${catOptions(g.create ? g.create.category_id : categoryOrder()[0])}</select></div></div>`).join('')}
    <datalist id="imp-dl">${S.products.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>
    <p class="muted small">Les quantités en g, ml, pièces, cuillères sont converties en emballages dans les listes (contenance du produit).</p>
    <div class="row end"><button class="btn sec2" data-a="close">Annuler</button><button class="btn" data-a="imp-ok">Appliquer au plat</button></div>`);
}
on('change', 'imp-f', (el) => { imp.f[el.dataset.k] = el.checked; });
on('change', 'imp-ing', (el) => { imp.ing[Number(el.dataset.i)].on = el.checked; });
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
    // Sans equivalent (gousse, pincee...) : 1 emballage, la quantite lue gardee en note.
    if (g.amount != null) addIng(p, g.amount, null, 'c', g.amount_unit);
    else addIng(p, 1, g.qty != null ? `${String(g.qty).replace('.', ',')}${g.unit ? ' ' + g.unit : ''}` : null, 'c');
  }
  closeSheet();
  await loadProducts();
  toast(`Recette importée${created ? ` · ${created} produit${created > 1 ? 's' : ''} créé${created > 1 ? 's' : ''}` : ''} · enregistrer pour garder`);
  render();
});

// ---------- Mode cuisine : plein ecran, quantites ajustees, recettes enchainees ----------
export function cookView() {
  const d = ed, k = `cp${d.id}`, p = Number(S.q[k] || S.route[2] || d.portions), f = p / d.portions;
  const stepsOf = (x) => String(x || '').split('\n').map((t) => t.trim()).filter(Boolean);
  const ings = (list, g) => (list.length ? `<div class="card">${list.map((i) => `<div class="ing"><span class="grow">${esc(i.name)}${i.note ? ` <span class="muted small">· ${esc(i.note)}</span>` : ''}</span><span class="q">${i.qty == null ? '<span class="muted">selon goût</span>' : esc(amountText(i.qty * g, i))}</span></div>`).join('')}</div>` : '');
  const block = (x, g) => { const st = stepsOf(x.steps); return `${ings(x.ingredients || [], g)}${st.length ? `<div class="card"><ol class="steps">${st.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>` : ''}${x.notes ? `<p class="muted pre" style="margin:0 4px 10px">${esc(x.notes)}</p>` : ''}${x.url ? `<a class="btn sec2 sm" href="${esc(x.url)}" target="_blank" rel="noopener">${I('link', 's')} Recette en ligne</a>` : ''}`; };
  const own = dishIngredients(d, null);
  return {
    title: d.name, back: `#/plats/${d.id}`, noNav: true, sub: d.time_text ? `⏱ ${d.time_text}` : '',
    right: `<button class="ib" data-a="wake" aria-label="Garder l’écran allumé">${I('eye')}</button>`,
    body: `<div class="card row"><span class="grow"><b>Pour ${p} personne${p > 1 ? 's' : ''}</b><span class="muted block">quantités ajustées</span></span>
      <span class="stepper"><button data-a="cook-p" data-d="-1" aria-label="Moins">${I('minus')}</button><b>${p}</b><button data-a="cook-p" data-d="1" aria-label="Plus">${I('plus')}</button></span></div>
      ${block({ ...d, ingredients: own }, f)}
      ${(d.groups || []).length ? `<p class="muted small" style="margin:0 4px 10px">Variantes : ${d.groups.map((g) => `${esc(g.name)} (${g.options.map((o) => esc(o.name)).join(' / ')})`).join(' ; ')}. Quantités de la 1re option.</p>` : ''}
      ${(d.parts || []).map((x) => { const g = (f * x.portions) / x.dish_portions; return `<div class="part"><div class="mid">${esc(x.name)}${x.variant ? ` · ${esc(x.variant)}` : ''}</div>
        <p class="muted small" style="margin:2px 0 8px">${x.time_text ? `⏱ ${esc(x.time_text)} · ` : ''}${fmtQ(g * x.dish_portions)} portions (recette pour ${x.dish_portions})</p>${block(x, g)}</div>`; }).join('')}`,
  };
}
on('click', 'cook-p', (el) => { const k = `cp${ed.id}`; S.q[k] = Math.max(1, Number(S.q[k] || S.route[2] || ed.portions) + Number(el.dataset.d)); render(); });
// Ecran allume pendant la cuisine (si le navigateur le permet).
let wakeLock = null;
on('click', 'wake', async () => {
  try {
    if (wakeLock) { await wakeLock.release(); wakeLock = null; toast('Écran : veille normale'); return; }
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
    toast('L’écran reste allumé');
  } catch { toast('Ce navigateur ne peut pas garder l’écran allumé', true); }
});
