// Listes : accueil (A prevoir, prochaines courses, historique), detail d'une liste
// (articles par rayon, ajout, suggestions, fiche article, actions), creation, cloture.
import { esc, eur, fmtDate, on, acc, sheet, closeSheet, confirmSheet, toast, formData, isPc } from './ui.js';
import { get, post, patch, del, attempt, sync, newOp, setCached } from './api.js';
import { S, hp, isManager, render, go, loadHouse, loadProducts, catName, categoryOrder, activeStores, storeById } from './state.js';
import { unitOptions, catOptions, contField } from './catalogue.js';
import { SLOT } from './plats.js';
import { I, btnI } from './icons.js';

const STATUS = { prep: 'En préparation', shopping: 'En courses', closed: 'Clôturée' };
const longDate = (d) => fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' });
const listTitle = (l) => (l.type === 'backlog' ? 'À prévoir' : `Courses du ${longDate(l.date)}`);
const shortTitle = (l) => (l.type === 'backlog' ? 'À prévoir' : fmtDate(l.date, { weekday: 'long', day: 'numeric', month: 'long' }));
const qtyText = (q) => String(q).replace('.', ',');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

let summary = null;   // GET /lists
let promos = [];      // GET /promos (accueil)
let current = null;   // liste affichee (GET /lists/:id)

export async function loadSummary() { [summary, promos] = await Promise.all([get(hp('/lists')), get(hp('/promos')).catch(() => promos)]); }
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
// Carte de la prochaine liste (progression, estimation, conseil de magasin), suggestions,
// « À prévoir », listes a venir, promos en cours, historique.
const statusPill = (l) => `<span class="pill ${l.status === 'shopping' ? 'p-leaf' : 'p-grey'}">${STATUS[l.status]}</span>`;
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
function heroCard(l) {
  const a = l.advice || { stores: [] }, pct = l.items ? Math.round((l.bought / l.items) * 100) : 0;
  const mono = storeById(a.mono);
  const advice = !a.stores.length ? '' : `<div class="card flat" style="margin:0">
    <div class="row wrap" style="margin:0">${a.stores.map((x) => `<span class="st" style="--c:${esc(x.color)}">${esc(x.name)} · ${x.items}</span>`).join('')}</div>
    <div class="small" style="margin-top:6px">${a.stores.length < 2 ? `Tout est prévu chez ${esc(a.stores[0].name)}.`
      : a.split ? `Faire les ${a.stores.length} magasins fait économiser <b>${eur(a.saving)}</b> par rapport à tout chez ${esc(mono ? mono.name : '?')}.`
        : `L’économie d’un 2e magasin (${eur(Math.max(0, a.saving))}) reste sous le seuil de ${eur(a.threshold)}.`}</div></div>`;
  return `<div class="card hero-c"><a href="#/listes/${l.id}" style="color:inherit;text-decoration:none;display:block">
    <div class="row"><span class="grow muted small">Prochaines courses</span>${statusPill(l)}</div>
    <div class="mid" style="margin:4px 0 12px">${esc(shortTitle(l))}</div>
    <div class="row small"><span class="grow muted">${l.bought} / ${l.items} dans le caddie${l.pending ? ` · ${plural(l.pending, 'suggestion')}` : ''}</span>${l.estimate != null && l.items ? `<b class="price">≈ ${eur(l.estimate)}</b>` : ''}</div>
    <div class="prog" style="margin:6px 0 14px"><i style="width:${pct}%"></i></div></a>
    ${advice}
    <div class="btn-row" style="margin-top:14px">${btnI('basket', 'Ouvrir la liste', `href="#/listes/${l.id}"`, 'sec2', 'a')}${btnI('plus', isManager() ? 'Ajouter un article' : 'Suggérer un article', 'href="#/raccourci/article"', 'sec2', 'a')}${l.items ? btnI('cart', 'Mode courses', `data-a="shop-pick" data-id="${l.id}"`, '') : ''}</div></div>`;
}
export function listesView() {
  const s = summary, mgr = isManager(), [next, ...later] = s.upcoming;
  const sug = S.house.pending || (S.suggestions || []).length;
  const listRow = (l) => `<a class="item click" href="#/listes/${l.id}"><span class="ico ${l.status === 'shopping' ? 'leaf' : ''}">${I(l.status === 'closed' ? 'check' : 'basket')}</span>
    <span class="grow"><b>${esc(shortTitle(l))}</b><span class="muted block">${plural(l.items, 'article')}${l.estimate != null && l.items ? ` · ≈ ${eur(l.estimate)}` : ''}${l.pending ? ` · ${plural(l.pending, 'suggestion')}` : ''}</span></span>${l.status !== 'closed' ? statusPill(l) : ''}${I('chev', 's chev')}</a>`;
  const b = s.backlog;
  return {
    title: 'Courses', sub: S.house.household.name, large: true,
    body: `${sug && mgr ? `<button class="banner" data-a="sugg-sheet">${I('bulb')}<span class="grow">${plural(S.house.pending, 'suggestion')} à valider</span>${I('chev', 's')}</button>` : ''}
      <div class="home-grid"><div>
      ${next ? heroCard(next) : `<div class="card hero-c c"><p class="muted">Aucune liste de courses prévue.</p>${mgr ? '<button class="btn" data-a="list-new">＋ Nouvelle liste</button>' : ''}</div>`}
      <div class="sec">À prévoir <a href="#/listes/${b.id}">Voir</a></div>
      <a class="card click" href="#/listes/${b.id}"><b>${plural(b.items, 'article')}</b>${b.pending ? ` <span class="pill p-carrot">${plural(b.pending, 'suggestion')}</span>` : ''}
        <span class="muted block">Sans date : à importer dans une prochaine liste${b.estimate != null && b.items ? ` · ≈ ${eur(b.estimate)}` : ''}.</span></a>
      </div><div>
      <div class="sec">Listes à venir ${mgr ? '<button data-a="list-new">＋ Nouvelle liste</button>' : ''}</div>
      <div class="group">${later.map(listRow).join('') || `<p class="muted small" style="padding:12px 14px;margin:0">${next ? 'Pas d’autre liste prévue.' : 'Aucune.'}</p>`}</div>
      <div class="sec">Promos en cours <a href="#/promos">Toutes</a></div>
      <div class="hscroll">${promos.slice(0, 12).map((p) => { const st = storeById(p.store_id) || { name: '?', color: 'var(--muted)' };
        return `<a class="card click" style="width:170px" href="#/catalogue/${p.product_id}"><span class="st" style="--c:${esc(st.color)}">${esc(st.name)}</span>
          <div style="font-weight:650;margin:8px 0 2px">${esc(p.product)}</div><b class="price" style="color:var(--carrot)">${p.price_cents != null ? eur(p.price_cents) : 'promo'}</b>
          <span class="muted block">${p.list_id ? 'ces courses' : `jusqu’au ${esc(fmtDate(p.valid_until))}`}</span></a>`; }).join('')}
        <button class="card click c" style="width:140px;display:grid;place-items:center;gap:6px;color:var(--leaf)" data-a="promo-new">${I('tag', 'l')}<b class="small">Signaler une promo</b></button></div>
      <div class="sec" id="history">Historique <button data-a="hist-toggle">${S.q.histOpen ? 'Masquer' : `Voir (${s.closed.length})`}</button></div>
      ${S.q.histOpen ? `<div class="group">${s.closed.map(listRow).join('') || '<p class="muted small" style="padding:12px 14px;margin:0">Aucune liste clôturée.</p>'}</div>` : ''}
      </div></div>`,
  };
}
on('click', 'hist-toggle', () => { S.q.histOpen = !S.q.histOpen; render(); });
on('click', 'sugg-sheet', () => sheet(`<h3>Suggestions à valider</h3><p class="muted small">Proposées par les membres du foyer.</p>${suggestionsHtml()}`));

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
function itemRow(i, l, o = {}) {
  const mgr = isManager(), open = l.status !== 'closed', dated = l.type === 'dated';
  const mine = i.suggestion && i.suggested_by === S.me.id;
  const meta = [
    i.from && i.from.length ? `<span>${I('bowl', 's')} ${esc(i.from.length > 1 ? `${i.from[0]} +${i.from.length - 1}` : i.from[0])}</span>` : '',
    i.need ? `<span>${esc(i.need)}</span>` : '',
    i.note ? `<span>${I('note', 's')} ${esc(i.note)}</span>` : '',
    i.origin === 'recurring' ? `<span>${I('repeat', 's')} récurrent</span>` : '',
    i.origin === 'carried' ? '<span>↪ reporté</span>' : '',
    i.suggestion ? `<span style="color:var(--carrot)">${I('bulb', 's')} ${esc(i.suggested_by_name || '?')}</span>` : '',
    i.status === 'unavailable' ? `<span>${I('ban', 's')} indisponible</span>` : '',
    i.promos && i.promos.length && open ? `<span style="color:var(--carrot)">${I('tag', 's')} promo</span>` : '',
    i.carried_label ? `<span>→ ${i.carried_label === 'À prévoir' ? 'À prévoir' : esc(fmtDate(i.carried_label))}</span>` : '',
  ].join('');
  const check = dated && open && !i.suggestion
    ? `<button class="chk${i.status === 'bought' ? ' on' : ''}" data-a="item-check" data-id="${i.id}" aria-label="Acheté">${I('check')}</button>` : '';
  const priced = open && !i.deleted;
  const price = priced && !i.suggestion && dated ? (i.prices[i.at_store_id] != null ? eur(i.prices[i.at_store_id] * i.qty) : '<span class="muted">?</span>') : '';
  const right = i.suggestion && open
    ? (mgr ? `<button class="ib" data-a="sugg-no" data-id="${i.id}" aria-label="Refuser">${I('x')}</button><button class="btn sm" data-a="sugg-ok" data-id="${i.id}" aria-label="Accepter">${I('check', 's')}</button>`
      : mine ? `<button class="ib" data-a="item-del" data-id="${i.id}" aria-label="Retirer">${I('x')}</button>` : '')
    : priced && dated && !o.noStore ? `<span class="px">${price ? `<span class="price small">${price}</span>` : ''}${storeButton(i)}</span>` : '';
  const tap = open && !i.suggestion;
  return `<div class="item line1${i.suggestion ? ' pending' : ''}${i.status === 'bought' && open ? ' done' : ''}${i.deleted ? ' gone' : ''}" id="it${i.id}">${check}
    <div class="grow nm${tap ? ' click' : ''}" ${tap ? `data-a="item" data-id="${i.id}"` : ''}><span class="t">${esc(i.name)}${i.qty !== 1 ? ` <span class="faint fw4">× ${qtyText(i.qty)}</span>` : ''}</span>
      <span class="meta">${meta || `<span>${esc(i.unit)}</span>`}</span></div>${right}</div>`;
}
on('click', 'meals-menu', () => { closeSheet(); go('#/menu'); });
on('click', 'item-meals', (el) => {
  const i = current.items.find((x) => String(x.id) === el.dataset.id);
  if (!i) return;
  sheet(`<h3>${esc(i.name)}</h3><p class="muted">Nécessaire pour :</p>${i.from.map((d) => `<div class="item">${I('bowl', 's')} ${esc(d)}</div>`).join('')}
    ${i.meal_qty > 0 ? `<p class="muted small">Dont ${qtyText(i.meal_qty)} ${esc(i.unit)} pour les repas${i.need ? ` (${esc(i.need)} au total)` : ''}.</p>` : ''}
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
  return i.promos.map((p) => `<span class="pill p-carrot click" data-a="promo" data-pid="${i.product_id}" data-sid="${p.store_id}">${I('tag', 's')} ${esc(storeName(p.store_id))} ${p.price_cents != null ? eur(p.price_cents) : 'promo'} · ${p.list_id ? 'ces courses' : `jusqu'au ${esc(fmtDate(p.valid_until))}`}</span>`).join('');
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
  return `${banner}<div class="scen">${p.stores.map((s) => `<div><span>Tout chez ${esc(s.name)}${s.unknown ? ` <span class="pill p-carrot">${s.unknown} prix inconnu${s.unknown > 1 ? 's' : ''}</span>` : ''}</span>${bar(s.total, s.color)}</div><b class="price">${eur(s.total)}</b>`).join('')}
      <div><b>Répartition actuelle</b>${bar(p.split, 'var(--leaf)')}</div><b class="price">${eur(p.split)}</b></div>
      ${p.noPrice ? `<p class="muted small">${p.noPrice} article${p.noPrice > 1 ? 's' : ''} sans aucun prix connu (non estimé${p.noPrice > 1 ? 's' : ''}).</p>` : ''}
      ${mgr && p.stores.length > 1 ? `<div class="row wrap">${p.stores.map((s) => `<button class="btn sm sec2" data-a="assign" data-sid="${s.id}">Tout ${esc(s.name)}</button>`).join('')}<button class="btn sm sec2" data-a="assign" data-sid="">Conseil</button></div>` : ''}
      <p class="muted small">Touchez l'étiquette d'un magasin sur un article pour le déplacer ; les choix manuels sont en pointillé.</p>`;
}

function basePanel(l) {
  if (!l.base || !l.base.length) return '';
  return acc('lc_base', { icon: I('box'), title: 'À vérifier dans les placards', sum: ` · ${l.base.length}`,
    body: l.base.map((b) => `<div class="item"><span class="grow"><b>${esc(b.name)}</b><span class="muted block">pour ${esc(b.dishes.join(', '))}</span></span><button class="btn sm sec2" data-a="add-item" data-id="${b.product_id}">＋ À acheter</button></div>`).join('') });
}

function filterStore(l) {
  const f = S.q.listStore;
  return f && f.listId === l.id ? storeById(f.sid) || null : null;
}

// Articles par rayon (ordre donne) ; coches replies dans « Dans le caddie ».
function itemsBody(l, items, order, o = {}) {
  const open = l.status !== 'closed', dated = l.type === 'dated';
  const todo = items.filter((i) => !(dated && open && i.status === 'bought') && i.status !== 'unavailable');
  const unav = items.filter((i) => i.status === 'unavailable'), cart = dated && open ? items.filter((i) => i.status === 'bought') : [];
  const known = new Set(order);
  const groups = [...order, ...new Set(todo.map((i) => i.category_id).filter((c) => !known.has(c)))].map((cid) => [cid, todo.filter((i) => i.category_id === cid)]).filter(([, is]) => is.length);
  const key = `cart${l.id}`;
  return `${groups.map(([cid, is]) => `<div class="rayon">${esc(catName(cid))}<span class="n">${is.length}</span></div><div class="group">${is.map((i) => itemRow(i, l, o)).join('')}</div>`).join('')}
    ${!items.length ? `<div class="empty">${I('basket', 'l')}<p>${o.empty || `Liste vide. ${isManager() ? 'Ajoutez un article ci-dessous.' : 'Suggérez un article ci-dessous.'}`}</p></div>`
      : !todo.length && cart.length ? `<div class="empty">${I('check', 'l')}<p><b>Tout est dans le caddie.</b></p></div>` : ''}
    ${unav.length ? `<div class="rayon">Indisponibles<span class="n">${unav.length}</span></div><div class="group">${unav.map((i) => itemRow(i, l, o)).join('')}</div>` : ''}
    ${cart.length ? `<button class="rayon" data-a="cart-toggle" data-k="${key}">${I('cart', 's')} Dans le caddie<span class="n">${cart.length} ${I(S.q[key] ? 'up' : 'down', 's')}</span></button>
      ${S.q[key] ? `<div class="group">${cart.map((i) => itemRow(i, l, o)).join('')}</div>` : ''}` : ''}`;
}
on('click', 'cart-toggle', (el) => { S.q[el.dataset.k] = !S.q[el.dataset.k]; render(); });
const others = (l) => [...new Set((S.presence || []).filter((u) => u.listId === l.id && u.id !== S.me.id).map((u) => u.name))];
const presenceLine = (l) => { const o = others(l); return o.length ? `<p class="row small muted" style="margin:0 2px 10px"><span class="avatar" style="--c:var(--plum)">${esc(o[0][0])}</span>${esc(o.join(', '))} ${o.length > 1 ? 'sont' : 'est'} aussi sur cette liste</p>` : ''; };

// Encadre « estimation » : total, ecart avec un seul magasin, barres par magasin (detail en panneau).
function scenCard(l) {
  const p = l.pricing;
  if (!p || !p.stores.length) return '';
  const max = Math.max(1, ...p.stores.map((x) => x.total));
  return `<button class="card click" data-a="scen" style="margin-bottom:6px">
    <div class="row"><span class="grow muted small">Estimation · ${p.recommendSplit ? 'conseil : plusieurs magasins' : 'conseil : un magasin'}</span>${I('chev', 's chev')}</div>
    <div class="row" style="margin-top:4px"><span class="big price grow">${eur(p.split)}</span>${p.stores.length > 1 && p.saving ? `<span class="pill ${p.recommendSplit ? 'p-leaf' : ''}">${p.saving >= 0 ? '−' : '+'}${eur(Math.abs(p.saving))} vs ${esc((p.stores.find((x) => x.id === p.monoStoreId) || {}).name || '')}</span>` : ''}</div>
    ${p.stores.map((x) => `<div class="row small" style="margin-top:8px"><span style="width:96px" class="muted">${esc(x.name)}</span><div class="bar grow" style="margin:0"><i style="width:${Math.round((x.total / max) * 100)}%;background:${esc(x.color)}"></i></div><b class="price">${eur(x.total)}</b></div>`).join('')}</button>`;
}
on('click', 'scen', () => sheet(`<h3>Scénarios comparés</h3>${scenPanel(current)}`));

export function listView() {
  const l = current, mgr = isManager(), open = l.status !== 'closed', dated = l.type === 'dated';
  const done = l.items.filter((i) => i.status === 'bought' && !i.suggestion).length;
  const fs = dated && open ? filterStore(l) : null;
  const chips = dated && open && activeStores().length > 1 ? `<div class="opt sticky">${[{ id: '', name: 'Tous', n: l.items.length }, ...activeStores().map((x) => ({ ...x, n: l.items.filter((i) => i.at_store_id === x.id).length }))]
    .map((x) => `<button class="${(fs ? fs.id : '') === x.id ? 'on' : ''}" data-a="list-store" data-sid="${x.id}">${x.color ? `<span class="dot" style="background:${esc(x.color)}"></span>` : ''}${esc(x.name)} <span class="n">${x.n}</span></button>`).join('')}</div>` : '';
  const shown = fs ? l.items.filter((i) => i.at_store_id === fs.id) : l.items;
  const meals = dated && l.meals && l.meals.length ? `<div class="sec">Repas couverts <a href="#/menu">Menu</a></div>
    <div class="hscroll">${l.meals.map((m) => `<button class="card click" style="width:150px;padding:12px" data-a="meal-open" data-id="${m.id}" data-date="${m.date}"><span class="muted small">${esc(fmtDate(m.date, { weekday: 'short', day: 'numeric' }))} · ${SLOT[m.slot]}</span><div style="font-weight:650;line-height:1.25;margin-top:2px">${esc(m.dish)}</div></button>`).join('')}</div>` : '';
  const body = !open ? closedBody(l) : `${presenceLine(l)}<div class="split"><div>${chips}
      ${itemsBody(l, shown, fs ? fs.categoryOrder : categoryOrder(), fs ? { empty: `Aucun article prévu chez ${esc(fs.name)}.` } : {})}</div>
      <div class="side">${dated ? scenCard(l) : ''}${meals}${dated ? basePanel(l) : ''}</div></div>`;
  return {
    title: l.type === 'backlog' ? 'À prévoir' : shortTitle(l), back: '#/listes',
    sub: l.type === 'backlog' ? 'Liste permanente, sans date' : `${STATUS[l.status]}${open ? ` · ${done}/${l.items.filter((i) => !i.suggestion).length} dans le caddie` : ''}`,
    right: dated && mgr ? `<button class="ib" data-a="list-menu" aria-label="Actions de la liste">${I('more')}</button>` : '',
    body,
    dock: open ? `<button class="addbar" data-a="add-open">${I('plus')}<span class="grow">${mgr ? 'Ajouter un article' : 'Suggérer un article'}</span>${I('search', 's')}</button>
      ${dated && l.items.length ? `<button class="btn" data-a="shop-pick" data-id="${l.id}" aria-label="Mode courses">${I('cart')}</button>` : ''}` : null,
  };
}

// Mode courses : un magasin (ses articles, dans l'ordre de ses rayons) ou tous ensemble
// (« tous » : toute la liste, ordre des rayons de reference, magasin indique par article).
on('click', 'shop-pick', async (el) => {
  const id = Number(el.dataset.id);
  const l = current && current.id === id ? current : await attempt(() => get(hp(`/lists/${id}`)));
  if (!l) return;
  const left = (sid) => l.items.filter((i) => !i.suggestion && i.status === 'todo' && (!sid || i.at_store_id === sid)).length;
  sheet(`<h3>Mode courses</h3><p class="muted small">Un magasin à la fois, ou toute la liste sans séparation. Fonctionne sans réseau.</p>
    <div class="group"><a class="item click" href="#/listes/${l.id}/magasin/tous" data-a="close-go"><span class="ico leaf">${I('cart')}</span><span class="grow"><b>Tous les magasins</b><span class="muted block">${plural(left(), 'article')} à prendre · sans séparation</span></span>${I('arrowR')}</a>
    ${activeStores().map((x) => `<a class="item click" href="#/listes/${l.id}/magasin/${x.id}" data-a="close-go"><span class="dot" style="background:${esc(x.color)}"></span><span class="grow"><b>${esc(x.name)}</b><span class="muted block">${plural(left(x.id), 'article')} à prendre</span></span>${I('arrowR')}</a>`).join('')}</div>`);
});
on('click', 'close-go', (el) => { closeSheet(); go(el.getAttribute('href')); });
export function storeListView(sid) {
  if (!current) return { title: 'Chargement…', body: '' };
  const l = current, all = sid === 'tous', s = all ? { id: 'tous', name: 'Tous les magasins', color: 'var(--leaf)', categoryOrder: categoryOrder() } : storeById(Number(sid));
  if (!s) return { title: 'Magasin', back: `#/listes/${l.id}`, body: '<p class="muted">Magasin inactif.</p>' };
  const items = l.items.filter((i) => !i.suggestion && (all || i.at_store_id === s.id));
  const done = items.filter((i) => i.status === 'bought');
  const st = all ? { itemsTotal: l.pricing ? l.pricing.split : 0, itemsUnknown: 0 } : (l.pricing && l.pricing.stores.find((x) => x.id === s.id)) || { itemsTotal: 0, itemsUnknown: 0 };
  const open = l.status !== 'closed';
  const pct = items.length ? Math.round((done.length / items.length) * 100) : 0;
  const tabs = activeStores().length > 1 ? `<div class="seg">${[{ id: 'tous', name: 'Tous' }, ...activeStores()].map((x) => `<a class="${String(x.id) === String(s.id) ? 'on' : ''}" href="#/listes/${l.id}/magasin/${x.id}">${esc(x.name)}</a>`).join('')}</div>` : '';
  return {
    title: s.name, back: `#/listes/${l.id}`, noNav: true, sub: shortTitle(l),
    body: `<div class="shop">${tabs}
      <div class="card" style="--c:${esc(s.color)};padding:0;overflow:hidden"><div class="shopbar"></div><div style="padding:14px 16px">
        <div class="row"><span class="mid grow">${done.length} / ${items.length}</span><span class="price muted">≈ ${eur(st.itemsTotal)}${st.itemsUnknown ? ` (${st.itemsUnknown} sans prix)` : ''}</span></div>
        <div class="prog" style="margin-top:10px"><i style="width:${pct}%;background:${esc(s.color)}"></i></div>
        ${others(l).length ? `<p class="row small muted" style="margin:10px 0 0">${I('users', 's')} ${esc(others(l).join(', '))} ${others(l).length > 1 ? 'sont' : 'est'} aussi sur cette liste · en direct</p>` : ''}</div></div>
      ${itemsBody(l, items, s.categoryOrder, { noStore: !all, empty: all ? 'Aucun article à prendre.' : `Aucun article prévu chez ${esc(s.name)}.` })}</div>`,
    dock: open && items.length ? `<button class="btn full" style="background:${esc(s.color)}" data-a="shop-end" data-sid="${all ? '' : s.id}">${all ? 'Terminer les courses' : `Terminer chez ${esc(s.name)}`}</button>` : null,
  };
}
on('click', 'shop-end', (el) => {
  const sid = Number(el.dataset.sid) || null;
  const left = current.items.filter((i) => !i.suggestion && (!sid || i.at_store_id === sid) && i.status === 'todo');
  const scans = sid ? [storeById(sid)] : activeStores();
  sheet(`<h3>${sid ? `Terminer chez ${esc(storeName(sid))}` : 'Terminer les courses'}</h3>
    <div class="group">${scans.map((x) => `<button class="item click" data-a="scan-start" data-lid="${current.id}" data-sid="${x.id}"><span class="ico leaf">${I('camera')}</span><span class="grow"><b>Scanner le ticket${sid ? '' : ` ${esc(x.name)}`}</b><span class="muted block">Met à jour les prix et coche les articles achetés</span></span>${I('chev', 's chev')}</button>`).join('')}</div>
    ${left.length ? `<p class="muted">${plural(left.length, 'article')} non pris. Les marquer « indisponible » ? Ils seront reportés à la clôture de la liste.</p>` : ''}
    <div class="row end">${left.length ? `<button class="btn sec2" data-a="shop-end-unav" data-sid="${sid || ''}">Marquer indisponibles</button>` : ''}<button class="btn" data-a="shop-end-ok">Terminer</button></div>`);
});
on('click', 'shop-end-unav', async (el) => {
  const sid = Number(el.dataset.sid) || null;
  const left = current.items.filter((i) => !i.suggestion && (!sid || i.at_store_id === sid) && i.status === 'todo' && !isTemp(i.id));
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
  sheet(`<h3>Promo · ${esc(i.name)}</h3><p class="muted small">Rappel que ce produit devrait être moins cher. Le prix promo remplace la moyenne pour le conseil de magasin, sans entrer dans la moyenne.</p>
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
  return `${acc('h_bought', { icon: I('check'), title: 'Achetés', sum: ` · ${bought.length}`, def: true, body: bought.map((i) => itemRow(i, l)).join('') || '<p class="muted">Rien.</p>' })}
    ${acc('h_left', { icon: I('repeat'), title: 'Non achetés', sum: ` · ${left.length}`, def: true, body: left.map((i) => itemRow(i, l)).join('') || '<p class="muted">Tout a été acheté.</p>' })}
    <div class="btn-row">${isManager() && bought.length ? btnI('repeat', 'Copier les achetés dans « À prévoir »', 'data-a="list-copy"') : ''}${btnI('camera', 'Scanner un ticket', `data-a="scan-start" data-lid="${l.id}"`)}${isManager() ? btnI('trash', 'Supprimer la liste', 'data-a="list-del"', 'sec2 danger-t') : ''}</div>`;
}

// ---------- Ajout avec recherche dans le catalogue ----------
function matches(q) {
  const n = norm(q).trim();
  if (!n) return [];
  return S.products.filter((p) => norm(p.name).includes(n)).sort((a, b) => norm(a.name).indexOf(n) - norm(b.name).indexOf(n)).slice(0, 6);
}
on('click', 'add-open', () => sheet(`<h3>${isManager() ? 'Ajouter un article' : 'Suggérer un article'}</h3>
  <div class="addbox"><input class="txt" id="add-q" autocomplete="off" autofocus placeholder="Rechercher ou créer un produit…" data-in="add-q" data-enter="add-first"><div id="add-ac"></div></div>`));
on('input', 'add-q', (el) => {
  const q = el.value.trim(), ms = matches(q);
  document.getElementById('add-ac').innerHTML = q ? `<div class="ac">${ms.map((p) => `<button data-a="add-item" data-id="${p.id}"><span class="grow">${esc(p.name)}</span><span class="muted">${esc(catName(p.category_id))}</span></button>`).join('')}
    ${ms.some((p) => norm(p.name) === norm(q)) ? '' : `<button data-a="add-new"><b>＋ Créer « ${esc(q)} » dans les produits</b></button>`}</div>` : '';
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
  sheet(`<h3>Nouveau produit</h3><p class="muted small">Ajouté aux produits du foyer, puis à la liste.</p>
    <label class="muted">Nom</label><input class="txt" name="name" value="${esc(q)}">
    <div class="row gap"><label class="grow"><span class="muted">Rayon</span><select class="txt" name="category_id">${catOptions()}</select></label>
    <label class="grow"><span class="muted">Emballage</span><select class="txt" name="unit">${unitOptions('paquet')}</select></label></div>
    ${contField()}
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
  if (buying && S.route[0] === 'magasin') priceSheet(i, S.route[2] === 'tous' ? i.at_store_id : Number(S.route[2]));
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
    ${i.meal_qty > 0 ? `<div class="row line"><span class="grow">Dont ${qtyText(i.meal_qty)}${i.need ? ` (${esc(i.need)})` : ''} pour ${esc(i.from.join(', '))}</span><button class="btn sm sec2" data-a="item-stock" data-id="${i.id}">${I('box', 's')} Déjà en réserve</button></div>` : ''}
    ${i.manual_store ? `<div class="row line"><span class="grow">Magasin choisi : <b>${esc(storeName(i.at_store_id))}</b>${i.best_store_id ? ` (conseil : ${esc(storeName(i.best_store_id))})` : ''}</span><button class="btn sm sec2" data-a="store-advice" data-id="${i.id}">Revenir au conseil</button></div>` : ''}
    ${mgr && others.length ? `<div class="sec">Déplacer vers</div><div class="opt">${others.map((o) => `<button data-a="item-move" data-id="${i.id}" data-to="${o.id}">${o.type === 'backlog' ? 'À prévoir' : 'Liste du ' + esc(fmtDate(o.date))}</button>`).join('')}</div>` : ''}
    ${mgr ? `<div class="row line"><span class="grow"><b>Récurrent</b><span class="muted block">${p.recurrence ? 'Revient automatiquement' : 'Non'}</span></span><button class="btn sm sec2" data-a="item-rec" data-pid="${i.product_id}" data-rec="${p.recurrence ? '' : 1}">${p.recurrence ? 'Arrêter' : 'Rendre récurrent'}</button></div>` : ''}
    <div class="btn-row" style="margin-top:14px">${btnI('doc', 'Fiche produit', `data-a="go-product" data-pid="${i.product_id}"`)}${current.type === 'dated' ? btnI('tag', 'Promo', `data-a="promo" data-pid="${i.product_id}" data-sid="${i.promos && i.promos[0] ? i.promos[0].store_id : i.at_store_id || ''}"`) : ''}${mgr ? btnI('trash', 'Retirer', `data-a="item-del" data-id="${i.id}"`, 'sec2 danger-t') : ''}${btnI('check', 'Enregistrer', `data-a="item-save" data-id="${i.id}"`, '')}</div>`);
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
    <button class="btn sec2 full" data-a="list-status" data-s="${l.status === 'prep' ? 'shopping' : 'prep'}">${l.status === 'prep' ? 'Commencer les courses' : 'Repasser en préparation'}</button>
    <button class="btn full" style="margin-top:8px" data-a="list-close">Clôturer la liste</button>
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
  return (S.suggestions || []).map((s) => (s.kind === 'meal' ? `<div class="item"><div class="grow"><div class="nm">${I('bowl', 's')} ${esc(s.dish)}</div><div class="muted">${esc(s.suggested_by_name || '?')} → ${esc(fmtDate(s.date, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${SLOT[s.slot]}</div></div>
    ${mgr ? `<button class="btn sm" data-a="msugg-ok" data-id="${s.id}">Accepter</button><button class="btn sm sec2" data-a="msugg-no" data-id="${s.id}" aria-label="Refuser">${I('x', 's')}</button>` : '<span class="pill p-carrot">en attente</span>'}</div>` : `<div class="item"><div class="grow"><div class="nm">${qtyText(s.qty)} × ${esc(s.name)}</div>
    <div class="muted">${esc(s.suggested_by_name || '?')} → ${s.list_type === 'backlog' ? 'À prévoir' : 'liste du ' + esc(fmtDate(s.list_date))}</div></div>
    ${mgr ? `<button class="btn sm" data-a="fsugg-ok" data-id="${s.id}">Accepter</button><button class="btn sm sec2" data-a="fsugg-no" data-id="${s.id}" aria-label="Refuser">${I('x', 's')}</button>` : '<span class="pill p-carrot">en attente</span>'}</div>`)).join('')
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
