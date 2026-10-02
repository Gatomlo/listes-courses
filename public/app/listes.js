// Listes : accueil (A prevoir, prochaines courses, historique), detail d'une liste
// (articles par rayon, ajout, suggestions, fiche article, actions), creation, cloture.
import { esc, eur, fmtDate, on, acc, sheet, closeSheet, confirmSheet, toast, formData, isPc } from './ui.js';
import { get, post, patch, del, attempt, sync, newOp, setCached } from './api.js';
import { S, hp, isManager, render, go, loadHouse, loadProducts, catName, categoryOrder, activeStores, storeById } from './state.js';
import { unitOptions, catOptions } from './catalogue.js';
import { SLOT } from './plats.js';

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
const refreshList = async (l) => { current = l || await get(hp(`/lists/${current.id}`)); setCached(hp(`/lists/${current.id}`), current); await loadHouse(); render(); };
export const currentList = () => current;
const isTemp = (id) => String(id).startsWith('tmp');

// Actions du mode courses : appliquees tout de suite a l'ecran et a la copie locale,
// puis envoyees (ou mises en file sans reseau, voir api.js).
async function runOps(ops, local) {
  local(current);
  setCached(hp(`/lists/${current.id}`), current);
  render();
  const r = await attempt(() => sync(S.me.householdId, ops));
  if (r && r.lists) {
    const l = r.lists.find((x) => x.id === current.id);
    if (l) await refreshList(l);
  }
}
const itemUpdate = (i, fields) => runOps([newOp({ type: 'item.update', item_id: i.id, fields })], () => Object.assign(i, fields,
  fields.store_id !== undefined ? { manual_store: !!fields.store_id, at_store_id: fields.store_id || i.best_store_id || i.at_store_id } : {}));

// ---------- Accueil ----------
export function listesView() {
  const s = summary, mgr = isManager();
  const card = (l) => `<a class="card click row" href="#/listes/${l.id}"><div class="grow"><h4>${esc(listTitle(l))}</h4>
    <div class="muted">${l.items} article${l.items > 1 ? 's' : ''}${l.estimate != null && l.items ? ` · ≈ ${eur(l.estimate)}` : ''}${l.status === 'shopping' ? ` · ${l.bought} coché${l.bought > 1 ? 's' : ''}` : ''}${l.pending ? ` · ${l.pending} suggestion${l.pending > 1 ? 's' : ''}` : ''}</div></div>
    <span class="pill ${l.status === 'prep' ? 'p-leaf' : l.status === 'shopping' ? 'p-carrot' : 'p-grey'}">${STATUS[l.status]}</span></a>`;
  return {
    title: 'Listes', sub: S.house.household.name,
    right: `<button class="btn sm sec2" data-a="go" data-to="#/foyers">🏡 Foyer ▾</button>`,
    body: `<a class="card click row" href="#/listes/${s.backlog.id}"><div class="grow"><h4>À prévoir</h4><div class="muted">${s.backlog.items} article${s.backlog.items > 1 ? 's' : ''}${s.backlog.estimate != null && s.backlog.items ? ` · ≈ ${eur(s.backlog.estimate)}` : ''} en attente d'une sortie${s.backlog.pending ? ` · ${s.backlog.pending} suggestion${s.backlog.pending > 1 ? 's' : ''}` : ''}</div></div><span class="pill p-grey">permanente</span></a>
      ${S.house.pending || (S.suggestions || []).length ? acc('sugg', { icon: '💡', title: 'Suggestions en attente', sum: ` <span class="badge">${S.house.pending}</span>`, def: true, body: suggestionsHtml() }) : ''}
      ${acc('l_next', { icon: '🛒', title: 'Prochaines courses', sum: ` · ${s.upcoming.length} liste${s.upcoming.length > 1 ? 's' : ''}`, def: true,
        body: `<div class="pad">${s.upcoming.map(card).join('') || '<p class="muted">Aucune liste prévue.</p>'}</div>` })}
      ${acc('l_old', { icon: '🕓', title: 'Historique', sum: ` · ${s.closed.length} liste${s.closed.length > 1 ? 's' : ''} clôturée${s.closed.length > 1 ? 's' : ''}`,
        body: `<div class="pad">${s.closed.map(card).join('') || '<p class="muted">Aucune liste clôturée.</p>'}</div>` })}
      ${mgr ? '<button class="fab" data-a="list-new" title="Nouvelle liste datée">＋</button>' : ''}`,
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
// Une ligne par article : coche, quantite × nom (· note), indicateurs courts, prix au
// magasin retenu, plats (modale), promo, etiquette du magasin. Le detail est dans la fiche.
function itemRow(i, l) {
  const mgr = isManager(), open = l.status !== 'closed', dated = l.type === 'dated';
  const mine = i.suggestion && i.suggested_by === S.me.id;
  const flags = [
    i.suggestion ? `<span class="flag" title="Suggéré par ${esc(i.suggested_by_name || '?')}">💡</span>` : '',
    i.origin === 'recurring' ? '<span class="flag" title="Récurrent">🔁</span>' : '',
    i.origin === 'carried' ? '<span class="flag" title="Reporté">↪</span>' : '',
    i.status === 'unavailable' ? '<span class="flag" title="Indisponible">⛔</span>' : '',
    i.carried_label ? `<span class="flag muted" title="Reporté">→ ${i.carried_label === 'À prévoir' ? 'À prévoir' : esc(fmtDate(i.carried_label))}</span>` : '',
  ].join('');
  const check = dated && open && !i.suggestion
    ? `<button class="chk${i.status === 'bought' ? ' on' : ''}" data-a="item-check" data-id="${i.id}" aria-label="Acheté">${i.status === 'bought' ? '✓' : ''}</button>` : '';
  const priced = open && !i.deleted;
  const price = priced && !i.suggestion ? (i.prices[i.at_store_id] != null ? eur(i.prices[i.at_store_id] * i.qty) : '<span class="muted">?</span>') : '';
  const meals = i.from && i.from.length ? `<button class="ic" title="Plats concernés" data-a="item-meals" data-id="${i.id}">🍽</button>` : '';
  const right = i.suggestion && open
    ? (mgr ? `<button class="btn sm" data-a="sugg-ok" data-id="${i.id}" title="Accepter">✓</button><button class="btn sm sec2" data-a="sugg-no" data-id="${i.id}" title="Refuser">✕</button>`
      : mine ? `<button class="btn sm sec2" data-a="item-del" data-id="${i.id}" title="Retirer">✕</button>` : '')
    : priced ? `<button class="ic${i.promos.length ? ' on' : ''}" title="${i.promos.length ? 'En promo' : 'Promo'}" data-a="promo" data-pid="${i.product_id}" data-sid="${i.promos[0] ? i.promos[0].store_id : i.at_store_id || ''}">🏷</button>${storeButton(i)}` : '';
  return `<div class="item line1${i.suggestion ? ' pending' : ''}${i.status === 'bought' && open ? ' done' : ''}${i.deleted ? ' gone' : ''}">${check}
    <div class="grow nm${open && !i.suggestion ? ' click' : ''}" ${open && !i.suggestion ? `data-a="item" data-id="${i.id}"` : ''}>${qtyText(i.qty)} × ${esc(i.name)}${i.note ? ` <span class="muted fw4">· ${esc(i.note)}</span>` : ''}</div>
    ${flags}${price ? `<span class="price small">${price}</span>` : ''}${meals}${right}</div>`;
}
on('click', 'meals-menu', () => { closeSheet(); go('#/menu'); });
on('click', 'item-meals', (el) => {
  const i = current.items.find((x) => String(x.id) === el.dataset.id);
  if (!i) return;
  sheet(`<h3>${esc(i.name)}</h3><p class="muted">Nécessaire pour :</p>${i.from.map((d) => `<div class="item">🍽 ${esc(d)}</div>`).join('')}
    ${i.meal_qty > 0 ? `<p class="muted small">Dont ${qtyText(i.meal_qty)} ${esc(i.unit)} pour les repas.</p>` : ''}
    <div class="row end"><button class="btn sec2" data-a="meals-menu">Ouvrir le menu</button></div>`);
});

// ---------- Prix et magasins ----------
const storeName = (sid) => (storeById(sid) || {}).name || '?';
const storeTag = (sid, extra = '') => {
  const s = storeById(sid);
  return s ? `<span class="st${extra}" style="--c:${esc(s.color)}">${esc(s.name)}</span>` : '';
};
// Etiquette du magasin retenu : la toucher passe au magasin actif suivant (pointille =
// choix manuel ; revenir au conseil depuis la fiche article).
function storeButton(i) {
  const s = storeById(i.at_store_id);
  if (!s) return '';
  return `<button class="st${i.manual_store ? ' manual' : ''}" style="--c:${esc(s.color)}" title="Changer de magasin" data-a="store-cycle" data-id="${i.id}">${esc(s.name)}</button>`;
}
function priceHint(i) {
  const here = i.prices[i.at_store_id];
  const others = activeStores().filter((s) => s.id !== i.at_store_id)
    .map((s) => (i.prices[s.id] == null ? `${esc(s.name)} : prix inconnu` : `${esc(s.name)} ${eur(i.prices[s.id])}`));
  if (here == null && others.every((o) => o.includes('inconnu'))) return 'Prix inconnu';
  return [`${here == null ? 'prix inconnu' : eur(here)} / ${esc(i.unit)}`, ...others].join(' · ');
}
function promoPills(i) {
  return i.promos.map((p) => `<span class="pill p-carrot click" data-a="promo" data-pid="${i.product_id}" data-sid="${p.store_id}">🏷 ${esc(storeName(p.store_id))} ${p.price_cents != null ? eur(p.price_cents) : 'promo'} · ${p.list_id ? 'ces courses' : `jusqu'au ${esc(fmtDate(p.valid_until))}`}</span>`).join('');
}

// Encadre en tete des articles : scenarios, economie de la repartition, « tout chez X ».
function scenPanel(l) {
  const p = l.pricing, mgr = isManager();
  if (!p || !p.stores.length) return '';
  const max = Math.max(1, ...p.stores.map((s) => s.total), p.split);
  const bar = (v, c) => `<div class="bar"><i style="width:${Math.round((v / max) * 100)}%;background:${c}"></i></div>`;
  const mono = p.stores.find((s) => s.id === p.monoStoreId);
  const used = p.stores.filter((s) => s.items).length;
  const banner = p.stores.length < 2 ? '' : `<div class="saving ${p.recommendSplit ? 'good' : 'meh'}">
    <div class="muted">${used < 2 ? 'Tout est prévu dans un seul magasin' : p.recommendSplit ? 'Deux magasins valent la peine' : 'Un seul magasin suffit'}</div>
    <big>${eur(Math.abs(p.saving))} ${p.saving >= 0 ? 'd’économie' : 'de surcoût'}</big>
    <div class="muted">répartition actuelle vs tout chez ${esc(mono.name)} · seuil ${eur(p.threshold)}</div></div>`;
  return `<div class="wide-acc">${acc('l_scen', { icon: '📊', title: 'Scénarios comparés', def: 'closed', sum: p.stores.length > 1 ? ` · ${p.saving >= 0 ? 'économie' : 'surcoût'} ${eur(Math.abs(p.saving))}` : ` · ${eur(p.split)}`,
    body: `${banner}<div class="scen">${p.stores.map((s) => `<div><span>Tout chez ${esc(s.name)}${s.unknown ? ` <span class="pill p-carrot">${s.unknown} prix inconnu${s.unknown > 1 ? 's' : ''}</span>` : ''}</span>${bar(s.total, s.color)}</div><b class="price">${eur(s.total)}</b>`).join('')}
      <div><b>Répartition actuelle</b>${bar(p.split, 'var(--leaf)')}</div><b class="price">${eur(p.split)}</b></div>
      ${p.noPrice ? `<p class="muted small">${p.noPrice} article${p.noPrice > 1 ? 's' : ''} sans aucun prix connu (non estimé${p.noPrice > 1 ? 's' : ''}).</p>` : ''}
      ${mgr && p.stores.length > 1 ? `<div class="row wrap">${p.stores.map((s) => `<button class="btn sm sec2" data-a="assign" data-sid="${s.id}">Tout ${esc(s.name)}</button>`).join('')}<button class="btn sm sec2" data-a="assign" data-sid="">Conseil</button></div>` : ''}
      <p class="muted small">Touchez l'étiquette d'un magasin sur un article pour le déplacer ; les choix manuels sont en pointillé.</p>` })}</div>`;
}

function basePanel(l) {
  if (!l.base || !l.base.length) return '';
  return acc('lc_base', { icon: '🧂', title: 'À vérifier dans les placards', sum: ` · ${l.base.length}`,
    body: l.base.map((b) => `<div class="item"><span class="grow"><b>${esc(b.name)}</b><span class="muted block">pour ${esc(b.dishes.join(', '))}</span></span><button class="btn sm sec2" data-a="add-item" data-id="${b.product_id}">＋ À acheter</button></div>`).join('') });
}

function filterStore(l) {
  const f = S.q.listStore;
  return f && f.listId === l.id ? storeById(f.sid) || null : null;
}

function itemsBody(l, items, order) {
  const mgr = isManager();
  const groups = order.map((cid) => [cid, items.filter((i) => i.category_id === cid)]).filter(([, is]) => is.length);
  return groups.map(([cid, is]) => {
    const n = is.filter((i) => i.status === 'bought').length;
    return acc(`lc_${cid}`, { title: catName(cid), sum: ` · ${is.length}${l.type === 'dated' ? ` · ${n} coché${n > 1 ? 's' : ''}` : ''}`, def: true, body: is.map((i) => itemRow(i, l)).join('') });
  }).join('') || `<p class="muted">Liste vide. ${mgr ? 'Ajoutez un article avec ＋.' : 'Suggérez un article avec ＋.'}</p>`;
}

export function listView() {
  const l = current, mgr = isManager(), open = l.status !== 'closed';
  const done = l.items.filter((i) => i.status === 'bought' && !i.suggestion).length;
  // Ajout : bouton flottant qui ouvre un panneau (recherche, creation de produit).
  const add = open ? `<button class="fab" data-a="add-open" title="${mgr ? 'Ajouter un article' : 'Suggérer un article'}">＋</button>` : '';
  // Filtre par magasin (liste datee) : articles retenus dans ce magasin, rayons dans son ordre.
  const fs = l.type === 'dated' && open ? filterStore(l) : null;
  let shopBtns = '';
  if (l.type === 'dated' && open && activeStores().length) {
    const st = fs && ((l.pricing && l.pricing.stores.find((x) => x.id === fs.id)) || { items: 0, itemsTotal: 0, itemsUnknown: 0 });
    shopBtns = `<div class="seg">${[{ id: '', name: 'Tous' }, ...activeStores()].map((s) => `<button class="${(fs ? fs.id : '') === s.id ? 'on' : ''}" data-a="list-store" data-sid="${s.id}">${esc(s.name)}</button>`).join('')}</div>
      ${fs ? `<div class="row wrap"><span class="grow muted">${st.items} article${st.items > 1 ? 's' : ''} · ≈ ${eur(st.itemsTotal)}${st.itemsUnknown ? ` (${st.itemsUnknown} sans prix)` : ''}</span><a class="btn sm" href="#/listes/${l.id}/magasin/${fs.id}">🛒 Mode courses</a></div>` : ''}`;
  }
  const shown = fs ? l.items.filter((i) => i.at_store_id === fs.id) : l.items;
  const items = `${l.type === 'dated' && open ? scenPanel(l) : ''}${shopBtns}${fs && !shown.length ? `<p class="muted">Aucun article prévu chez ${esc(fs.name)}.</p>` : itemsBody(l, shown, fs ? fs.categoryOrder : categoryOrder())}${l.type === 'dated' ? basePanel(l) : ''}${add}`;
  let body;
  if (l.status === 'closed') body = closedBody(l);
  else body = items;
  return {
    cols: isPc() && l.status !== 'closed', title: listTitle(l), back: '#/listes',
    sub: l.type === 'backlog' ? 'Liste permanente' : `${STATUS[l.status]}${open ? ` · ${done}/${l.items.filter((i) => !i.suggestion).length} coché${done > 1 ? 's' : ''} · ≈ ${eur(l.pricing.split)}` : ''}`,
    right: l.type === 'dated' && open && mgr ? '<button class="btn sm sec2" data-a="list-menu" title="Actions de la liste">⋯</button>' : '',
    body,
  };
}

// Mode courses : les articles du magasin dans l'ordre de ses rayons, en grand ; les
// articles coches descendent dans « Dans le caddie ».
export function storeListView(sid) {
  if (!current) return { title: 'Chargement…', body: '' };
  const l = current, s = storeById(Number(sid));
  if (!s) return { title: 'Magasin', back: `#/listes/${l.id}`, body: '<p class="muted">Magasin inactif.</p>' };
  const items = l.items.filter((i) => !i.suggestion && i.at_store_id === s.id);
  const todo = items.filter((i) => i.status !== 'bought'), done = items.filter((i) => i.status === 'bought');
  const st = (l.pricing && l.pricing.stores.find((x) => x.id === s.id)) || { itemsTotal: 0, itemsUnknown: 0 };
  const others = (S.presence || []).filter((u) => u.listId === l.id && u.id !== S.me.id).map((u) => u.name);
  const open = l.status !== 'closed';
  const groups = s.categoryOrder.map((cid) => [cid, todo.filter((i) => i.category_id === cid)]).filter(([, is]) => is.length);
  return {
    title: `En courses · ${s.name}`, back: `#/listes/${l.id}`,
    sub: `${listTitle(l)} · ${done.length}/${items.length} dans le caddie · ≈ ${eur(st.itemsTotal)}${st.itemsUnknown ? ` (${st.itemsUnknown} sans prix)` : ''}`,
    body: `<div class="shop">
      ${activeStores().length > 1 ? `<div class="seg">${activeStores().map((x) => `<a class="${x.id === s.id ? 'on' : ''}" href="#/listes/${l.id}/magasin/${x.id}">${esc(x.name)}</a>`).join('')}</div>` : ''}
      ${others.length ? `<p class="muted small">🟢 ${esc([...new Set(others)].join(', '))} ${others.length > 1 ? 'sont' : 'est'} aussi sur cette liste · synchronisé en direct</p>` : ''}
      ${groups.map(([cid, is]) => acc(`sh_${cid}`, { title: catName(cid), sum: ` · ${is.length} à prendre`, def: true, body: is.map((i) => itemRow(i, l)).join('') })).join('')
        || (items.length ? '<div class="card">🎉 Tout est dans le caddie.</div>' : '<p class="muted">Aucun article prévu dans ce magasin.</p>')}
      ${done.length ? acc('sh_done', { icon: '🛒', title: 'Dans le caddie', sum: ` · ${done.length}`, body: done.map((i) => itemRow(i, l)).join('') }) : ''}
      ${open && items.length ? `<button class="btn full" data-a="shop-end" data-sid="${s.id}">Terminer chez ${esc(s.name)}</button>` : ''}</div>`,
  };
}
on('click', 'shop-end', (el) => {
  const sid = Number(el.dataset.sid);
  const left = current.items.filter((i) => !i.suggestion && i.at_store_id === sid && i.status === 'todo');
  sheet(`<h3>Terminer chez ${esc(storeName(sid))}</h3>
    <button class="btn full" data-a="scan-start" data-lid="${current.id}" data-sid="${sid}">📷 Scanner le ticket</button>
    <p class="muted small">Lit chaque ligne sur le téléphone, met à jour les prix ${esc(storeName(sid))} et coche les articles achetés.</p>
    ${left.length ? `<p class="muted">${left.length} article${left.length > 1 ? 's' : ''} non pris. Les marquer « indisponible » ? Ils seront reportés à la clôture de la liste.</p>` : ''}
    <div class="row end">${left.length ? `<button class="btn sec2" data-a="shop-end-unav" data-sid="${sid}">Marquer indisponibles</button>` : ''}<button class="btn" data-a="shop-end-ok">Terminer</button></div>`);
});
on('click', 'shop-end-unav', async (el) => {
  const sid = Number(el.dataset.sid);
  const left = current.items.filter((i) => !i.suggestion && i.at_store_id === sid && i.status === 'todo' && !isTemp(i.id));
  closeSheet();
  await runOps(left.map((i) => newOp({ type: 'item.update', item_id: i.id, fields: { status: 'unavailable' } })), () => left.forEach((i) => { i.status = 'unavailable'; }));
  go(`#/listes/${current.id}`);
});
on('click', 'shop-end-ok', () => { closeSheet(); go(`#/listes/${current.id}`); });

// Filtre memorise par liste ; retoucher le magasin filtre le retire.
on('click', 'list-store', (el) => {
  const sid = Number(el.dataset.sid) || null, f = S.q.listStore;
  S.q.listStore = sid && !(f && f.listId === current.id && f.sid === sid) ? { listId: current.id, sid } : null;
  render();
});
on('click', 'store-cycle', async (el) => {
  const i = current.items.find((x) => x.id === Number(el.dataset.id));
  const ids = activeStores().map((s) => s.id);
  const next = ids[(ids.indexOf(i.at_store_id) + 1) % ids.length];
  // Revenir sur le magasin conseille = retour au conseil (plus de choix manuel).
  itemUpdate(i, { store_id: next === i.best_store_id ? null : next });
});
on('click', 'assign', async (el) => {
  const l = await attempt(() => post(hp(`/lists/${current.id}/assign`), { store_id: el.dataset.sid ? Number(el.dataset.sid) : null }));
  if (l) { toast(el.dataset.sid ? `Tout chez ${storeName(Number(el.dataset.sid))}` : 'Retour au conseil'); refreshList(l); }
});

// ---------- Promos ----------
let promoForm = null;
on('click', 'promo', (el) => {
  const pid = Number(el.dataset.pid);
  const i = current.items.find((x) => x.product_id === pid);
  promoForm = { pid, sid: Number(el.dataset.sid) || activeStores()[0].id };
  promoSheet(i);
});
function promoSheet(i) {
  const f = promoForm, ex = i.promos.find((p) => p.store_id === f.sid);
  const dated = current.type === 'dated';
  const until = ex && ex.valid_until ? ex.valid_until : new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const scope = ex ? (ex.list_id ? 'list' : 'until') : (dated ? 'list' : 'until');
  sheet(`<h3>🏷 Promo · ${esc(i.name)}</h3><p class="muted small">Rappel que ce produit devrait être moins cher. Le prix promo remplace la moyenne pour le conseil de magasin, sans entrer dans la moyenne.</p>
    <div class="seg">${activeStores().map((s) => `<button class="${f.sid === s.id ? 'on' : ''}" data-a="promo-store" data-sid="${s.id}">${esc(s.name)}</button>`).join('')}</div>
    <label class="muted">Prix promo (facultatif) — moyenne ${eur((S.products.find((p) => p.id === i.product_id) || { prices: {} }).prices[f.sid]?.avg)}</label>
    <input class="txt" name="price" inputmode="decimal" value="${ex && ex.price_cents != null ? (ex.price_cents / 100).toFixed(2).replace('.', ',') : ''}" placeholder="ex. 3,49">
    <div class="sec">Valable</div>
    ${dated ? `<label class="row line"><input type="radio" name="scope" value="list" ${scope === 'list' ? 'checked' : ''}><span class="grow">Uniquement pour les courses du ${esc(fmtDate(current.date, { day: 'numeric', month: 'long' }))}</span></label>` : ''}
    <label class="row line"><input type="radio" name="scope" value="until" ${scope === 'until' ? 'checked' : ''}><span class="grow">Jusqu'au</span><input class="txt w12" type="date" name="until" value="${until}"></label>
    <label class="muted" style="display:block;margin-top:8px">Note</label><input class="txt" name="note" value="${esc(ex ? ex.note || '' : '')}" placeholder="ex. 2e à -50 %, dépliant">
    <div class="row end">${ex ? `<button class="btn sec2 danger-t" data-a="promo-del" data-id="${ex.id}">Retirer la promo</button>` : ''}<button class="btn" data-a="promo-save">Enregistrer</button></div>`);
}
on('click', 'promo-store', (el) => {
  promoForm.sid = Number(el.dataset.sid);
  promoSheet(current.items.find((x) => x.product_id === promoForm.pid));
});
on('click', 'promo-save', async () => {
  const root = document.querySelector('.sheet');
  const f = formData(root);
  const scope = (root.querySelector('[name=scope]:checked') || {}).value || 'until';
  const body = { product_id: promoForm.pid, store_id: promoForm.sid, price: f.price, note: f.note, ...(scope === 'list' ? { list_id: current.id } : { valid_until: f.until }) };
  if (await attempt(() => post(hp('/promos'), body))) { closeSheet(); toast('Promo enregistrée · conseil recalculé'); refreshList(); }
});
on('click', 'promo-del', async (el) => {
  if (await attempt(() => del(hp(`/promos/${el.dataset.id}`)))) { closeSheet(); toast('Promo retirée'); refreshList(); }
});

function closedBody(l) {
  const bought = l.items.filter((i) => i.status === 'bought');
  const left = l.items.filter((i) => i.status !== 'bought');
  return `${acc('h_bought', { icon: '✅', title: 'Achetés', sum: ` · ${bought.length}`, def: true, body: bought.map((i) => itemRow(i, l)).join('') || '<p class="muted">Rien.</p>' })}
    ${acc('h_left', { icon: '↪', title: 'Non achetés', sum: ` · ${left.length}`, def: true, body: left.map((i) => itemRow(i, l)).join('') || '<p class="muted">Tout a été acheté.</p>' })}
    <div class="row wrap">${isManager() && bought.length ? '<button class="btn sec2" data-a="list-copy">⧉ Copier les articles achetés dans « À prévoir »</button>' : ''}<button class="btn sec2" data-a="scan-start" data-lid="${l.id}">📷 Scanner un ticket</button>${isManager() ? '<button class="btn sec2 danger-t" data-a="list-del">Supprimer la liste</button>' : ''}</div>`;
}

// ---------- Ajout avec recherche dans le catalogue ----------
function matches(q) {
  const n = norm(q).trim();
  if (!n) return [];
  return S.products.filter((p) => norm(p.name).includes(n)).sort((a, b) => norm(a.name).indexOf(n) - norm(b.name).indexOf(n)).slice(0, 6);
}
on('click', 'add-open', () => sheet(`<h3>${isManager() ? 'Ajouter un article' : 'Suggérer un article'}</h3>
  <div class="addbox"><input class="txt" id="add-q" autocomplete="off" placeholder="Rechercher ou créer un produit…" data-in="add-q" data-enter="add-first"><div id="add-ac"></div></div>`));
on('input', 'add-q', (el) => {
  const q = el.value.trim(), ms = matches(q);
  document.getElementById('add-ac').innerHTML = q ? `<div class="ac">${ms.map((p) => `<button data-a="add-item" data-id="${p.id}"><span class="grow">${esc(p.name)}</span><span class="muted">${esc(catName(p.category_id))}</span></button>`).join('')}
    ${ms.some((p) => norm(p.name) === norm(q)) ? '' : `<button data-a="add-new"><b>＋ Créer « ${esc(q)} » dans le catalogue</b></button>`}</div>` : '';
});
async function addItem(product_id) {
  const p = S.products.find((x) => x.id === product_id) || { name: '?' };
  await runOps([newOp({ type: 'item.add', list_id: current.id, product_id, qty: 1 })], (l) => {
    const ex = isManager() && l.items.find((i) => i.product_id === product_id && !i.suggestion);
    if (ex) { ex.qty += 1; return; }
    const sid = p.best_store_id || (activeStores()[0] || {}).id;
    l.items.push({ id: `tmp-${Date.now()}`, product_id, name: p.name, category_id: p.category_id, unit: p.unit, qty: 1, origin: 'manual', status: 'todo',
      suggestion: isManager() ? null : 'pending', suggested_by: S.me.id, suggested_by_name: S.me.name, prices: {}, promos: [], at_store_id: sid, best_store_id: sid });
  });
  toast(isManager() ? `${p.name} ajouté` : 'Suggestion envoyée au gestionnaire');
  const q = document.getElementById('add-q');
  if (q) { q.value = ''; document.getElementById('add-ac').innerHTML = ''; q.focus(); }
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
  const i = current.items.find((x) => String(x.id) === el.dataset.id);
  if (!i || isTemp(i.id)) return;
  const buying = i.status !== 'bought';
  await itemUpdate(i, { status: buying ? 'bought' : 'todo' });
  // Mode courses : prix paye facultatif (devient un releve du magasin).
  if (buying && S.route[0] === 'magasin') priceSheet(i, Number(S.route[2]));
});
function priceSheet(i, sid) {
  const avg = i.prices[sid];
  sheet(`<h3>${esc(i.name)}</h3><p class="muted">Prix payé chez ${esc(storeName(sid))} (facultatif)${avg != null ? ` — moyenne ${eur(avg)}` : ''}</p>
    <input class="txt big" name="price" inputmode="decimal" placeholder="${avg != null ? (avg / 100).toFixed(2).replace('.', ',') : '0,00'}" data-enter="price-ok" data-id="${i.id}" data-sid="${sid}">
    <label class="row line"><input type="checkbox" class="cb" name="promo"><span class="grow">Prix promo (hors moyenne)</span></label>
    <div class="row end"><button class="btn sec2" data-a="close">Passer</button><button class="btn" data-a="price-ok" data-id="${i.id}" data-sid="${sid}">Enregistrer le prix</button></div>`);
}
on('click', 'price-ok', async (el) => {
  const f = formData(document.querySelector('.sheet'));
  closeSheet();
  if (!String(f.price).trim()) return;
  const i = current.items.find((x) => String(x.id) === el.dataset.id);
  const r = await attempt(() => sync(S.me.householdId, [newOp({ type: 'record.add', product_id: i.product_id, store_id: Number(el.dataset.sid), price: f.price, promo: f.promo })]));
  toast(r === null ? 'Prix gardé, envoyé au retour du réseau' : 'Relevé enregistré · moyenne recalculée');
});
on('click', 'sugg-ok', async (el) => { const l = await attempt(() => post(hp(`/items/${el.dataset.id}/accept`))); if (l) { toast('Suggestion acceptée'); refreshList(l); } });
on('click', 'sugg-no', async (el) => { const l = await attempt(() => post(hp(`/items/${el.dataset.id}/refuse`))); if (l) { toast('Suggestion refusée'); refreshList(l); } });
on('click', 'item-del', async (el) => {
  const l = await attempt(() => del(hp(`/items/${el.dataset.id}`)));
  if (l) { closeSheet(); toast('Article retiré'); refreshList(l); }
});

// ---------- Fiche article ----------
on('click', 'item', async (el) => {
  const i = current.items.find((x) => String(x.id) === el.dataset.id);
  if (!i || isTemp(i.id)) return;
  const mgr = isManager();
  if (!summary) await loadSummary().catch(() => {});
  const others = summary ? [summary.backlog, ...summary.upcoming].filter((x) => x.id !== current.id) : [];
  const p = S.products.find((x) => x.id === i.product_id) || {};
  sheet(`<h3>${esc(i.name)}</h3><p class="muted">${esc(catName(i.category_id))} · ${esc(i.unit)}</p>
    ${i.suggestion ? `<p class="muted">Suggéré par ${esc(i.suggested_by_name || '?')}</p>` : ''}
    ${i.prices ? `<p class="muted small">${priceHint(i)}</p>` : ''}${i.promos && i.promos.length ? `<div class="pills">${promoPills(i)}</div>` : ''}
    <div class="row"><span class="grow">Quantité</span><button class="btn sm sec2" data-a="qty" data-d="-1">−</button><input class="txt w5 c" name="qty" inputmode="decimal" value="${qtyText(i.qty)}"><button class="btn sm sec2" data-a="qty" data-d="1">＋</button></div>
    <label class="muted" style="display:block;margin-top:8px">Note</label><input class="txt" name="note" value="${esc(i.note || '')}" placeholder="ex. bio, grand format">
    ${current.type === 'dated' ? `<label class="row line" style="margin-top:8px"><input type="checkbox" class="cb" name="unavailable" ${i.status === 'unavailable' ? 'checked' : ''}><span class="grow">Indisponible en magasin</span></label>` : ''}
    ${i.meal_qty > 0 ? `<div class="row line"><span class="grow">Dont ${qtyText(i.meal_qty)} pour ${esc(i.from.join(', '))}</span><button class="btn sm sec2" data-a="item-stock" data-id="${i.id}">🥫 Déjà en réserve</button></div>` : ''}
    ${i.manual_store ? `<div class="row line"><span class="grow">Magasin choisi : <b>${esc(storeName(i.at_store_id))}</b>${i.best_store_id ? ` (conseil : ${esc(storeName(i.best_store_id))})` : ''}</span><button class="btn sm sec2" data-a="store-advice" data-id="${i.id}">Revenir au conseil</button></div>` : ''}
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
  const i = current.items.find((x) => String(x.id) === el.dataset.id);
  const qty = Number(String(f.qty).replace(',', '.'));
  const body = { qty: qty > 0 ? qty : i.qty, note: f.note.trim() || null };
  if (f.unavailable !== undefined && i.status !== 'bought') body.status = f.unavailable ? 'unavailable' : 'todo';
  closeSheet();
  itemUpdate(i, body);
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
  sheet(`<h3>${esc(listTitle(l))}</h3>
    <label class="muted">Date des courses</label><input class="txt" type="date" name="date" value="${l.date}">
    <div class="row end"><button class="btn sec2" data-a="list-date">Changer la date</button></div>
    <div class="sec">Statut</div>
    <button class="btn sec2 full" data-a="list-status" data-s="${l.status === 'prep' ? 'shopping' : 'prep'}">${l.status === 'prep' ? '🛒 Commencer les courses' : '↩ Repasser en préparation'}</button>
    <button class="btn full" style="margin-top:8px" data-a="list-close">✔ Clôturer la liste</button>
    <button class="btn sec2 full danger-t" style="margin-top:8px" data-a="list-del">Supprimer la liste</button>`);
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
  const closed = current.status === 'closed';
  const n = current.items.filter((i) => !i.suggestion && i.status !== 'bought' && ['manual', 'carried'].includes(i.origin)).length;
  const b = current.items.filter((i) => i.status === 'bought').length;
  const ok = await confirmSheet({ title: 'Supprimer la liste ?', danger: true, ok: 'Supprimer',
    text: closed ? 'Elle disparaît de l’historique. Les prix relevés restent.'
      : `${n ? `${n} article${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''} à la main et non acheté${n > 1 ? 's' : ''} repart${n > 1 ? 'ent' : ''} dans « À prévoir ». ` : ''}${b ? `${b} article${b > 1 ? 's' : ''} coché${b > 1 ? 's' : ''} ${b > 1 ? 'sont oubliés' : 'est oublié'} (les prix relevés restent). ` : ''}Les récurrents et suggestions sont abandonnés.` });
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
export async function loadSuggestions() { S.suggestions = await get(hp('/suggestions')).catch(() => S.suggestions || []); }
export function suggestionsHtml() {
  const mgr = isManager();
  return (S.suggestions || []).map((s) => (s.kind === 'meal' ? `<div class="item"><div class="grow"><div class="nm">🍽 ${esc(s.dish)}</div><div class="muted">${esc(s.suggested_by_name || '?')} → ${esc(fmtDate(s.date, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${SLOT[s.slot]}</div></div>
    ${mgr ? `<button class="btn sm" data-a="msugg-ok" data-id="${s.id}">Accepter</button><button class="btn sm sec2" data-a="msugg-no" data-id="${s.id}">✕</button>` : '<span class="pill p-carrot">en attente</span>'}</div>` : `<div class="item"><div class="grow"><div class="nm">${qtyText(s.qty)} × ${esc(s.name)}</div>
    <div class="muted">${esc(s.suggested_by_name || '?')} → ${s.list_type === 'backlog' ? 'À prévoir' : 'liste du ' + esc(fmtDate(s.list_date))}</div></div>
    ${mgr ? `<button class="btn sm" data-a="fsugg-ok" data-id="${s.id}">Accepter</button><button class="btn sm sec2" data-a="fsugg-no" data-id="${s.id}">✕</button>` : '<span class="pill p-carrot">en attente</span>'}</div>`)).join('')
    || '<p class="muted">Rien en attente.</p>';
}
const afterSugg = async (msg) => { toast(msg); summary = null; await Promise.all([loadHouse(), loadSuggestions()]); render(); };
on('click', 'fsugg-ok', async (el) => { if (await attempt(() => post(hp(`/items/${el.dataset.id}/accept`)))) afterSugg('Suggestion acceptée'); });
on('click', 'fsugg-no', async (el) => { if (await attempt(() => post(hp(`/items/${el.dataset.id}/refuse`)))) afterSugg('Suggestion refusée'); });

export const listNeedsLoad = () => !summary;
export const resetLists = () => { summary = null; };

on('click', 'store-advice', (el) => {
  closeSheet();
  itemUpdate(current.items.find((x) => String(x.id) === el.dataset.id), { store_id: null });
});

on('click', 'item-stock', async (el) => {
  const l = await attempt(() => post(hp(`/items/${el.dataset.id}/in-stock`)));
  if (l) { closeSheet(); toast('Marqué en réserve pour ces repas'); refreshList(l); }
});
on('click', 'msugg-ok', async (el) => { if (await attempt(() => post(hp(`/meals/${el.dataset.id}/accept`)))) afterSugg('Plat ajouté au menu'); });
on('click', 'msugg-no', async (el) => { if (await attempt(() => del(hp(`/meals/${el.dataset.id}`)))) afterSugg('Suggestion refusée'); });
