// Listes : accueil (A prevoir, prochaines courses, historique), detail d'une liste
// (articles par rayon, ajout, suggestions, fiche article, actions), creation, cloture.
import { esc, fmtDate, on, acc, sheet, closeSheet, confirmSheet, toast, formData } from './ui.js';
import { get, post, patch, del, attempt } from './api.js';
import { S, hp, isManager, render, go, loadHouse, loadProducts, catName, categoryOrder } from './state.js';
import { unitOptions, catOptions } from './catalogue.js';

const STATUS = { prep: 'En préparation', shopping: 'En courses', closed: 'Clôturée' };
const longDate = (d) => fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' });
const listTitle = (l) => (l.type === 'backlog' ? 'À prévoir' : `Courses du ${longDate(l.date)}`);
const qtyText = (q) => String(q).replace('.', ',');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

let summary = null;   // GET /lists
let current = null;   // liste affichee (GET /lists/:id)

export async function loadSummary() { summary = await get(hp('/lists')); }
export async function loadList(id) {
  current = await get(hp(`/lists/${id}`));
  if (!S.products) await loadProducts();
}
const refreshList = async (l) => { current = l || await get(hp(`/lists/${current.id}`)); await loadHouse(); render(); };

// ---------- Accueil ----------
export function listesView() {
  const s = summary, mgr = isManager();
  const card = (l) => `<a class="card click row" href="#/listes/${l.id}"><div class="grow"><h4>${esc(listTitle(l))}</h4>
    <div class="muted">${l.items} article${l.items > 1 ? 's' : ''}${l.status === 'shopping' ? ` · ${l.bought} coché${l.bought > 1 ? 's' : ''}` : ''}${l.pending ? ` · ${l.pending} suggestion${l.pending > 1 ? 's' : ''}` : ''}</div></div>
    <span class="pill ${l.status === 'prep' ? 'p-leaf' : l.status === 'shopping' ? 'p-carrot' : 'p-grey'}">${STATUS[l.status]}</span></a>`;
  return {
    title: 'Listes', sub: S.house.household.name,
    right: `<button class="btn sm sec2" data-a="go" data-to="#/foyers">🏡 Foyer ▾</button>`,
    body: `<a class="card click row" href="#/listes/${s.backlog.id}"><div class="grow"><h4>À prévoir</h4><div class="muted">${s.backlog.items} article${s.backlog.items > 1 ? 's' : ''} en attente d'une sortie${s.backlog.pending ? ` · ${s.backlog.pending} suggestion${s.backlog.pending > 1 ? 's' : ''}` : ''}</div></div><span class="pill p-grey">permanente</span></a>
      ${acc('l_next', { icon: '🛒', title: 'Prochaines courses', sum: ` · ${s.upcoming.length} liste${s.upcoming.length > 1 ? 's' : ''}`, def: true,
        body: `<div class="pad">${s.upcoming.map(card).join('') || '<p class="muted">Aucune liste prévue.</p>'}${mgr ? '<button class="btn sec2 full" data-a="list-new">＋ Nouvelle liste datée</button>' : ''}</div>` })}
      ${acc('l_old', { icon: '🕓', title: 'Historique', sum: ` · ${s.closed.length} liste${s.closed.length > 1 ? 's' : ''} clôturée${s.closed.length > 1 ? 's' : ''}`,
        body: `<div class="pad">${s.closed.map(card).join('') || '<p class="muted">Aucune liste clôturée.</p>'}</div>` })}`,
  };
}

// ---------- Nouvelle liste ----------
async function newListSheet(date) {
  const pv = await attempt(() => get(hp(`/lists/new${date ? `?date=${date}` : ''}`)));
  if (!pv) return;
  sheet(`<h3>Nouvelle liste</h3>
    <label class="muted">Date des courses (rythme : ${S.house.household.rhythm_days} jours)</label><input class="txt" type="date" name="date" value="${pv.date}" data-ch="list-new-date">
    <div class="sec">Importer</div>
    <label class="row line"><input type="checkbox" class="cb" name="recurring" checked><span class="grow"><b>Articles récurrents dus</b><span class="muted block">${pv.recurring.map((p) => esc(p.name)).join(', ') || 'aucun'}</span></span></label>
    ${pv.backlog.length ? `<div class="muted small" style="margin-top:8px">Depuis « À prévoir »</div>${pv.backlog.map((i) => `<label class="row line"><input type="checkbox" class="cb" data-backlog="${i.id}" checked><span class="grow">${qtyText(i.qty)} × ${esc(i.name)}${i.note ? ` <span class="muted">· ${esc(i.note)}</span>` : ''}</span></label>`).join('')}` : '<p class="muted small">« À prévoir » est vide.</p>'}
    <div class="row end"><button class="btn" data-a="list-create">Créer la liste</button></div>`);
}
on('click', 'list-new', () => newListSheet());
on('change', 'list-new-date', (el) => newListSheet(el.value));
on('click', 'list-create', async () => {
  const root = document.querySelector('.sheet');
  const f = formData(root);
  const backlogItemIds = [...root.querySelectorAll('[data-backlog]')].filter((c) => c.checked).map((c) => Number(c.dataset.backlog));
  const l = await attempt(() => post(hp('/lists'), { date: f.date, recurring: f.recurring, backlogItemIds }));
  if (l) { closeSheet(); current = l; toast('Liste créée'); go(`#/listes/${l.id}`); }
});

// ---------- Detail d'une liste ----------
function itemRow(i, l) {
  const mgr = isManager(), open = l.status !== 'closed', dated = l.type === 'dated';
  const mine = i.suggestion && i.suggested_by === S.me.id;
  const pills = [
    i.suggestion ? `<span class="pill p-carrot">suggéré par ${esc(i.suggested_by_name || '?')}</span>` : '',
    i.origin === 'recurring' ? '<span class="pill p-leaf">🔁 récurrent</span>' : '',
    i.origin === 'carried' ? '<span class="pill p-grey">reporté</span>' : '',
    i.status === 'unavailable' ? '<span class="pill p-grey">indisponible</span>' : '',
    i.deleted ? '<span class="pill p-grey">retiré du catalogue</span>' : '',
  ].join('');
  const check = dated && open && !i.suggestion
    ? `<button class="chk${i.status === 'bought' ? ' on' : ''}" data-a="item-check" data-id="${i.id}" aria-label="Acheté">${i.status === 'bought' ? '✓' : ''}</button>` : '';
  const right = i.suggestion && open
    ? (mgr ? `<button class="btn sm" data-a="sugg-ok" data-id="${i.id}" title="Accepter">✓</button><button class="btn sm sec2" data-a="sugg-no" data-id="${i.id}" title="Refuser">✕</button>`
      : mine ? `<button class="btn sm sec2" data-a="item-del" data-id="${i.id}">Retirer</button>` : '')
    : '';
  return `<div class="item${i.suggestion ? ' pending' : ''}${i.status === 'bought' && open ? ' done' : ''}${i.deleted ? ' gone' : ''}">${check}
    <div class="grow${open && !i.suggestion ? ' click' : ''}" ${open && !i.suggestion ? `data-a="item" data-id="${i.id}"` : ''}><div class="nm">${qtyText(i.qty)} × ${esc(i.name)}${i.note ? ` <span class="muted fw4">· ${esc(i.note)}</span>` : ''}</div>
    ${pills ? `<div class="pills">${pills}</div>` : ''}${i.carried_label ? `<div class="muted small">→ reporté : ${i.carried_label === 'À prévoir' ? 'À prévoir' : 'liste du ' + fmtDate(i.carried_label)}</div>` : ''}</div>${right}</div>`;
}

export function listView() {
  const l = current, mgr = isManager(), open = l.status !== 'closed';
  const visible = l.items;
  const done = visible.filter((i) => i.status === 'bought' && !i.suggestion).length;
  const groups = categoryOrder().map((cid) => [cid, visible.filter((i) => i.category_id === cid)]).filter(([, is]) => is.length);
  const add = open ? `<div class="addbox"><input class="txt" id="add-q" autocomplete="off" placeholder="${mgr ? '＋ Ajouter un article…' : '＋ Suggérer un article…'}" data-in="add-q" data-enter="add-first"><div id="add-ac"></div></div>` : '';
  const body = l.status === 'closed' ? closedBody(l) : `${add}
    ${groups.map(([cid, is]) => acc(`lc_${cid}`, { title: catName(cid), sum: ` · ${is.length}${l.type === 'dated' ? ` · ${is.filter((i) => i.status === 'bought').length} coché${is.filter((i) => i.status === 'bought').length > 1 ? 's' : ''}` : ''}`, def: true, body: is.map((i) => itemRow(i, l)).join('') })).join('')
      || `<p class="muted">Liste vide. ${mgr ? 'Ajoutez un article ci-dessus.' : 'Suggérez un article ci-dessus.'}</p>`}`;
  return {
    title: listTitle(l), back: '#/listes',
    sub: l.type === 'backlog' ? 'Liste permanente' : `${STATUS[l.status]}${l.type === 'dated' && open ? ` · ${done}/${visible.filter((i) => !i.suggestion).length} coché${done > 1 ? 's' : ''}` : ''}`,
    right: l.type === 'dated' && open && mgr ? '<button class="btn sm sec2" data-a="list-menu" title="Actions de la liste">⋯</button>' : '',
    body,
  };
}

function closedBody(l) {
  const bought = l.items.filter((i) => i.status === 'bought');
  const left = l.items.filter((i) => i.status !== 'bought');
  return `${acc('h_bought', { icon: '✅', title: 'Achetés', sum: ` · ${bought.length}`, def: true, body: bought.map((i) => itemRow(i, l)).join('') || '<p class="muted">Rien.</p>' })}
    ${acc('h_left', { icon: '↪', title: 'Non achetés', sum: ` · ${left.length}`, def: true, body: left.map((i) => itemRow(i, l)).join('') || '<p class="muted">Tout a été acheté.</p>' })}
    ${isManager() && bought.length ? '<button class="btn sec2" data-a="list-copy">⧉ Copier les articles achetés dans « À prévoir »</button>' : ''}`;
}

// ---------- Ajout avec recherche dans le catalogue ----------
function matches(q) {
  const n = norm(q).trim();
  if (!n) return [];
  return S.products.filter((p) => norm(p.name).includes(n)).sort((a, b) => norm(a.name).indexOf(n) - norm(b.name).indexOf(n)).slice(0, 6);
}
on('input', 'add-q', (el) => {
  const q = el.value.trim(), ms = matches(q);
  document.getElementById('add-ac').innerHTML = q ? `<div class="ac">${ms.map((p) => `<button data-a="add-item" data-id="${p.id}"><span class="grow">${esc(p.name)}</span><span class="muted">${esc(catName(p.category_id))}</span></button>`).join('')}
    ${ms.some((p) => norm(p.name) === norm(q)) ? '' : `<button data-a="add-new"><b>＋ Créer « ${esc(q)} » dans le catalogue</b></button>`}</div>` : '';
});
async function addItem(product_id) {
  const l = await attempt(() => post(hp(`/lists/${current.id}/items`), { product_id }));
  if (!l) return;
  const name = (S.products.find((p) => p.id === product_id) || {}).name;
  await refreshList(l);
  toast(isManager() ? `${name} ajouté` : 'Suggestion envoyée au gestionnaire');
  document.getElementById('add-q')?.focus();
}
on('click', 'add-item', (el) => addItem(Number(el.dataset.id)));
on('click', 'add-first', () => {
  const q = document.getElementById('add-q').value.trim();
  const ms = matches(q);
  if (ms.length) addItem(ms[0].id); else if (q) document.querySelector('[data-a=add-new]')?.click();
});
on('click', 'add-new', () => {
  const q = document.getElementById('add-q').value.trim();
  sheet(`<h3>Nouveau produit</h3><p class="muted small">Ajouté au catalogue commun, puis à la liste.</p>
    <label class="muted">Nom</label><input class="txt" name="name" value="${esc(q)}">
    <div class="row gap"><label class="grow"><span class="muted">Rayon</span><select class="txt" name="category_id">${catOptions()}</select></label>
    <label class="grow"><span class="muted">Emballage</span><select class="txt" name="unit">${unitOptions('paquet')}</select></label></div>
    <div class="row end"><button class="btn" data-a="add-new-ok">Créer et ajouter</button></div>`);
});
on('click', 'add-new-ok', async () => {
  const p = await attempt(() => post(hp('/products'), formData(document.querySelector('.sheet'))));
  if (!p) return;
  closeSheet();
  await loadProducts();
  await addItem(p.id);
});

// ---------- Coche, suggestions ----------
on('click', 'item-check', async (el) => {
  const i = current.items.find((x) => x.id === Number(el.dataset.id));
  const l = await attempt(() => patch(hp(`/items/${i.id}`), { status: i.status === 'bought' ? 'todo' : 'bought' }));
  if (l) refreshList(l);
});
on('click', 'sugg-ok', async (el) => { const l = await attempt(() => post(hp(`/items/${el.dataset.id}/accept`))); if (l) { toast('Suggestion acceptée'); refreshList(l); } });
on('click', 'sugg-no', async (el) => { const l = await attempt(() => post(hp(`/items/${el.dataset.id}/refuse`))); if (l) { toast('Suggestion refusée'); refreshList(l); } });
on('click', 'item-del', async (el) => {
  const l = await attempt(() => del(hp(`/items/${el.dataset.id}`)));
  if (l) { closeSheet(); toast('Article retiré'); refreshList(l); }
});

// ---------- Fiche article ----------
on('click', 'item', async (el) => {
  const i = current.items.find((x) => x.id === Number(el.dataset.id));
  const mgr = isManager();
  if (!summary) await loadSummary();
  const others = [summary.backlog, ...summary.upcoming].filter((x) => x.id !== current.id);
  const p = S.products.find((x) => x.id === i.product_id) || {};
  sheet(`<h3>${esc(i.name)}</h3><p class="muted">${esc(catName(i.category_id))} · ${esc(i.unit)}</p>
    <div class="row"><span class="grow">Quantité</span><button class="btn sm sec2" data-a="qty" data-d="-1">−</button><input class="txt w5 c" name="qty" inputmode="decimal" value="${qtyText(i.qty)}"><button class="btn sm sec2" data-a="qty" data-d="1">＋</button></div>
    <label class="muted" style="display:block;margin-top:8px">Note</label><input class="txt" name="note" value="${esc(i.note || '')}" placeholder="ex. bio, grand format">
    ${current.type === 'dated' ? `<label class="row line" style="margin-top:8px"><input type="checkbox" class="cb" name="unavailable" ${i.status === 'unavailable' ? 'checked' : ''}><span class="grow">Indisponible en magasin</span></label>` : ''}
    ${mgr && others.length ? `<div class="sec">Déplacer vers</div><div class="opt">${others.map((o) => `<button data-a="item-move" data-id="${i.id}" data-to="${o.id}">${o.type === 'backlog' ? 'À prévoir' : 'Liste du ' + esc(fmtDate(o.date))}</button>`).join('')}</div>` : ''}
    ${mgr ? `<div class="row line"><span class="grow"><b>🔁 Récurrent</b><span class="muted block">${p.recurrence ? 'Revient automatiquement' : 'Non'}</span></span><button class="btn sm sec2" data-a="item-rec" data-pid="${i.product_id}" data-rec="${p.recurrence ? '' : 1}">${p.recurrence ? 'Arrêter' : 'Rendre récurrent'}</button></div>` : ''}
    <div class="row end"><button class="btn sec2" data-a="go-product" data-pid="${i.product_id}">Fiche produit</button>${mgr ? `<button class="btn sec2 danger-t" data-a="item-del" data-id="${i.id}">Retirer</button>` : ''}<button class="btn" data-a="item-save" data-id="${i.id}">Enregistrer</button></div>`);
});
on('click', 'qty', (el) => {
  const input = document.querySelector('.sheet [name=qty]');
  const v = Number(String(input.value).replace(',', '.')) || 0;
  input.value = qtyText(Math.max(1, v + Number(el.dataset.d)));
});
on('click', 'item-save', async (el) => {
  const f = formData(document.querySelector('.sheet'));
  const i = current.items.find((x) => x.id === Number(el.dataset.id));
  const body = { qty: f.qty, note: f.note };
  if (f.unavailable !== undefined && i.status !== 'bought') body.status = f.unavailable ? 'unavailable' : 'todo';
  const l = await attempt(() => patch(hp(`/items/${i.id}`), body));
  if (l) { closeSheet(); refreshList(l); }
});
on('click', 'item-move', async (el) => {
  const l = await attempt(() => post(hp(`/items/${el.dataset.id}/move`), { list_id: Number(el.dataset.to) }));
  if (l) { closeSheet(); toast('Article déplacé'); summary = null; refreshList(l); }
});
on('click', 'item-rec', async (el) => {
  const p = await attempt(() => patch(hp(`/products/${el.dataset.pid}`), { recurrence: el.dataset.rec || null }));
  if (p) { closeSheet(); await loadProducts(); toast(p.recurrence ? 'Produit récurrent' : 'Récurrence arrêtée'); render(); }
});
on('click', 'go-product', (el) => { closeSheet(); go(`#/catalogue/${el.dataset.pid}`); });

// ---------- Actions de la liste ----------
on('click', 'list-menu', () => {
  const l = current;
  const hasBought = l.items.some((i) => i.status === 'bought');
  sheet(`<h3>${esc(listTitle(l))}</h3>
    <label class="muted">Date des courses</label><input class="txt" type="date" name="date" value="${l.date}">
    <div class="row end"><button class="btn sec2" data-a="list-date">Changer la date</button></div>
    <div class="sec">Statut</div>
    <button class="btn sec2 full" data-a="list-status" data-s="${l.status === 'prep' ? 'shopping' : 'prep'}">${l.status === 'prep' ? '🛒 Commencer les courses' : '↩ Repasser en préparation'}</button>
    <button class="btn full" style="margin-top:8px" data-a="list-close">✔ Clôturer la liste</button>
    <button class="btn sec2 full danger-t" style="margin-top:8px" data-a="list-del" ${hasBought ? 'disabled title="Des articles sont cochés : clôturer plutôt"' : ''}>Supprimer la liste</button>`);
});
on('click', 'list-date', async () => {
  const date = document.querySelector('.sheet [name=date]').value;
  const l = await attempt(() => patch(hp(`/lists/${current.id}`), { date }));
  if (l) { closeSheet(); toast('Date modifiée'); summary = null; refreshList(l); }
});
on('click', 'list-status', async (el) => {
  const l = await attempt(() => patch(hp(`/lists/${current.id}`), { status: el.dataset.s }));
  if (l) { closeSheet(); summary = null; refreshList(l); }
});
on('click', 'list-del', async () => {
  const n = current.items.filter((i) => !i.suggestion && ['manual', 'carried'].includes(i.origin)).length;
  const ok = await confirmSheet({ title: 'Supprimer la liste ?', danger: true, ok: 'Supprimer',
    text: `${n} article${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''} à la main repart${n > 1 ? 'ent' : ''} dans « À prévoir ». Les récurrents et suggestions sont abandonnés.` });
  if (ok && await attempt(() => del(hp(`/lists/${current.id}`)))) { summary = null; toast('Liste supprimée'); go('#/listes'); }
});

// Cloture : destination de chaque article non achete.
on('click', 'list-close', () => {
  const left = current.items.filter((i) => i.status !== 'bought' && !i.suggestion);
  const next = current.next;
  const opts = (i) => `<select class="txt w12" data-fate="${i.id}">${next ? `<option value="next">Liste du ${esc(fmtDate(next.date))}</option>` : ''}<option value="backlog">À prévoir</option><option value="drop">Abandonner</option></select>`;
  sheet(`<h3>Clôturer la liste</h3>
    ${left.length ? `<p class="muted">${left.length} article${left.length > 1 ? 's' : ''} non acheté${left.length > 1 ? 's' : ''}. Où ${left.length > 1 ? 'les' : 'le'} reporter ?</p>
    ${left.map((i) => `<div class="row line"><span class="grow">${qtyText(i.qty)} × ${esc(i.name)}</span>${opts(i)}</div>`).join('')}` : '<p class="muted">Tous les articles ont été achetés.</p>'}
    ${current.items.some((i) => i.suggestion) ? '<p class="muted small">Les suggestions en attente seront abandonnées.</p>' : ''}
    <div class="row end"><button class="btn sec2" data-a="close">Annuler</button><button class="btn" data-a="list-close-ok">Clôturer</button></div>`);
});
on('click', 'list-close-ok', async () => {
  const fates = {};
  document.querySelectorAll('.sheet [data-fate]').forEach((s) => { fates[s.dataset.fate] = s.value; });
  const r = await attempt(() => post(hp(`/lists/${current.id}/close`), { fates }));
  if (r) { closeSheet(); summary = null; toast('Liste clôturée'); await refreshList(); }
});
on('click', 'list-copy', async () => {
  const r = await attempt(() => post(hp(`/lists/${current.id}/copy-to-backlog`)));
  if (r) toast(`${r.copied} article${r.copied > 1 ? 's' : ''} copié${r.copied > 1 ? 's' : ''} dans « À prévoir »`);
});

// ---------- Suggestions (ecran Foyer) ----------
export async function loadSuggestions() { S.suggestions = await get(hp('/suggestions')); }
export function suggestionsHtml() {
  const mgr = isManager();
  return (S.suggestions || []).map((s) => `<div class="item"><div class="grow"><div class="nm">${qtyText(s.qty)} × ${esc(s.name)}</div>
    <div class="muted">${esc(s.suggested_by_name || '?')} → ${s.list_type === 'backlog' ? 'À prévoir' : 'liste du ' + esc(fmtDate(s.list_date))}</div></div>
    ${mgr ? `<button class="btn sm" data-a="fsugg-ok" data-id="${s.id}">Accepter</button><button class="btn sm sec2" data-a="fsugg-no" data-id="${s.id}">✕</button>` : '<span class="pill p-carrot">en attente</span>'}</div>`).join('')
    || '<p class="muted">Rien en attente.</p>';
}
const afterSugg = async (msg) => { toast(msg); summary = null; await Promise.all([loadHouse(), loadSuggestions()]); render(); };
on('click', 'fsugg-ok', async (el) => { if (await attempt(() => post(hp(`/items/${el.dataset.id}/accept`)))) afterSugg('Suggestion acceptée'); });
on('click', 'fsugg-no', async (el) => { if (await attempt(() => post(hp(`/items/${el.dataset.id}/refuse`)))) afterSugg('Suggestion refusée'); });

export const listNeedsLoad = () => !summary;
export const resetLists = () => { summary = null; };
