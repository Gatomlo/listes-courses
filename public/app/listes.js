// Listes : accueil (A prevoir, prochaines courses, historique), detail d'une liste
// (articles par rayon, ajout, suggestions, fiche article, actions), creation, cloture.
import { esc, eur, fmtDate, on, acc, sheet, closeSheet, confirmSheet, toast, formData, isPc, localDay } from './ui.js';
import { get, post, put, patch, del, attempt, sync, newOp, setCached, net } from './api.js';
import { S, hp, isManager, render, go, loadHouse, loadProducts, catName, categoryOrder, activeStores, storeById } from './state.js';
import { unitOptions, catOptions, catSubOptions, subName, contField } from './catalogue.js';
import { SLOT, tile, isAwake, syncWake } from './plats.js';
import { startScan } from './scan.js';
import { I, btnI } from './icons.js';
import { multiAdd, micButton } from './multi.js';

const STATUS = { prep: 'En préparation', shopping: 'En courses', closed: 'Clôturée' };
const longDate = (d) => fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' });
const listTitle = (l) => (l.type === 'backlog' ? 'À prévoir' : `Courses du ${longDate(l.date)}`);
const shortTitle = (l) => (l.type === 'backlog' ? 'À prévoir' : fmtDate(l.date, { weekday: 'long', day: 'numeric', month: 'long' }));
const qtyText = (q) => String(q).replace('.', ',');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

let summary = null;   // GET /lists
let promos = [];      // GET /promos (accueil)
let habits = [];       // « peut-etre a racheter »
let backlogList = null; // contenu de « À prévoir » (accueil)
let nextList = null, week = null; // PC : apercu de la prochaine liste ; repas des jours a venir (7 sur PC, 2 sur telephone)
let current = null;   // liste affichee (GET /lists/:id)

export async function loadSummary() {
  [summary, promos] = await Promise.all([get(hp('/lists')), get(hp('/promos')).catch(() => promos)]);
  // PC : la place permet d'afficher le contenu de la prochaine liste et le menu de la semaine.
  const n = summary.upcoming.find((l) => !overdue(l));
  [backlogList, habits] = await Promise.all([get(hp(`/lists/${summary.backlog.id}`)).catch(() => backlogList), get(hp('/habits')).catch(() => habits)]);
  [nextList, week] = await Promise.all([n && isPc() ? get(hp(`/lists/${n.id}`)).catch(() => null) : null,
    get(hp(`/menu?from=${localDay()}&days=${isPc() ? 7 : 2}`)).catch(() => null)]);
}
export async function loadList(id, shop) {
  current = await get(hp(`/lists/${id}`));
  if (!S.products) await loadProducts();
  // Entrer dans le mode courses = partir faire les courses : la liste passe « En courses »
  // (sans reseau : tant pis, le statut n'est qu'indicatif).
  if (shop && current.type === 'dated' && current.status === 'prep') {
    current.status = 'shopping';
    patch(hp(`/lists/${id}`), { status: 'shopping' }).then(() => { summary = null; }).catch(() => {});
  }
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
const itemUpdate = (i, fields) => runOps([newOp({ type: 'item.update', item_id: i.id, fields })], () => {
  Object.assign(i, fields, fields.store_id !== undefined ? { manual_store: !!fields.store_id, at_store_id: fields.store_id || i.best_store_id || i.at_store_id } : {});
  if (fields.status) { i.bought_store_id = fields.status === 'bought' ? (fields.bought_store_id || i.bought_store_id || null) : null; i.bought_at = fields.status === 'bought' ? (i.bought_store_id || i.at_store_id) : null; }
});

// Tickets a saisir : un par magasin ou des articles ont ete pris, scannes tout de suite ou plus tard.
const ticketRows = (tickets, lid, withDate) => tickets.map((t) => `<div class="item"><span class="dot" style="background:${esc(t.color || 'var(--muted)')}"></span>
  <span class="grow"><b>${esc(t.name)}</b><span class="muted block">${plural(t.items, 'article')}${withDate && t.date ? ` · courses du ${esc(fmtDate(t.date, { day: 'numeric', month: 'long' }))}` : ''}</span></span>
  <button class="ib" data-a="ticket-skip" data-lid="${t.list_id || lid}" data-sid="${t.store_id}" aria-label="Pas de ticket" title="Pas de ticket">${I('x')}</button>
  <button class="btn sm" data-a="scan-start" data-lid="${t.list_id || lid}" data-sid="${t.store_id}" aria-label="Scanner le ticket ${esc(t.name)}">${I('camera', 's')}</button></div>`).join('');
const ticketsBox = (tickets, lid, withDate) => (tickets && tickets.length ? box('Tickets à saisir', '', ticketRows(tickets, lid, withDate), 'tickets-c') : '');
on('click', 'ticket-skip', async (el) => {
  const lid = Number(el.dataset.lid), sid = Number(el.dataset.sid);
  const r = await attempt(() => sync(S.me.householdId, [newOp({ type: 'trip.skip', list_id: lid, store_id: sid })]));
  if (r === undefined) return;
  if (summary) summary.tickets = (summary.tickets || []).filter((t) => !(t.list_id === lid && t.store_id === sid));
  if (current && current.id === lid) current.tickets = (current.tickets || []).filter((t) => t.store_id !== sid);
  toast('Ticket écarté');
  render();
});

// ---------- Accueil ----------
// Carte de la prochaine liste (progression, estimation, conseil de magasin), suggestions,
// « À prévoir », listes a venir, promos en cours, historique.
const statusPill = (l) => `<span class="pill ${l.status === 'shopping' ? 'p-leaf' : 'p-grey'}">${STATUS[l.status]}</span>`;
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
// Carte guidee par l'etape : Preparer -> En courses -> Terminee. En preparation : ce qu'il
// reste a regler (suggestions, articles sans prix) et le conseil de magasin ; deux boutons
// (preparer, partir faire les courses). En courses : progression, reprendre les courses.
function heroCard(l) {
  const a = l.advice || { stores: [] }, pct = l.items ? Math.round((l.bought / l.items) * 100) : 0;
  const mono = storeById(a.mono), shopping = l.status === 'shopping';
  const steps = `<div class="steps" aria-label="Étape : ${STATUS[l.status]}"><span class="${shopping ? 'past' : 'on'}"></span><span class="${shopping ? 'on' : ''}"></span><span></span></div>
    <div class="steps-l small"><span class="${shopping ? '' : 'on'}">Préparer</span><span class="${shopping ? 'on' : ''}">En courses</span><span>Terminée</span></div>`;
  const ok = (t) => `<div class="todo"><span class="ic ok">${I('check', 's')}</span><span class="grow">${t}</span></div>`;
  const warn = (t, attrs = '') => `<div class="todo"${attrs}><span class="ic wa">!</span><span class="grow">${t}</span></div>`;
  const storesTxt = a.stores.map((x) => `<span class="st" style="--c:${esc(x.color)}">${esc(x.name)} · ${x.items}</span>`).join(' ');
  const advice = !a.stores.length ? '' : a.stores.length < 2 ? `Tout est prévu chez ${esc(a.stores[0].name)}.`
    : a.split ? `Deux magasins font économiser <b>${eur(a.saving)}</b> par rapport à tout chez ${esc(mono ? mono.name : '?')}.`
      : `Un seul magasin suffirait : un 2e ne fait gagner que ${eur(Math.max(0, a.saving))} (seuil ${eur(a.threshold)}).`;
  const body = shopping
    ? `<div class="row small" style="margin-top:12px"><b class="grow">${l.bought} / ${l.items} dans le caddie</b>${l.estimate != null && l.items ? `<span class="price muted">≈ ${eur(l.estimate)}</span>` : ''}</div>
      <div class="prog" style="margin:8px 0 2px"><i style="width:${pct}%"></i></div>`
    : `<div class="todos">${ok(`${plural(l.items, 'article')}${l.estimate != null && l.items ? ` · ≈ <b class="price">${eur(l.estimate)}</b>` : ''}`)}
      ${a.stores.length ? ok(`${advice}<div class="row wrap" style="margin:6px 0 0">${storesTxt}</div>`) : ''}
      ${l.unknown ? warn(`${plural(l.unknown, 'article')} sans prix connu`) : ''}
      ${l.pending ? warn(`${plural(l.pending, 'suggestion')} à valider`) : ''}
      ${!l.items ? warn('Liste vide pour l’instant') : ''}</div>`;
  const prepBtn = btnI('basket', shopping ? 'Revoir la préparation' : 'Préparer la liste', `href="#/listes/${l.id}"`, 'sec2', 'a');
  const shopBtn = l.items ? btnI('cart', shopping ? 'Reprendre les courses' : 'Partir faire les courses', `data-a="shop-pick" data-id="${l.id}"`, '') : '';
  return `<section class="card box hero-c${shopping ? ' going' : ''}"><a href="#/listes/${l.id}" style="color:inherit;text-decoration:none;display:block">
    <div class="box-h"><span>Prochaines courses</span></div>
    <div class="mid" style="margin:4px 0 8px">${esc(shortTitle(l))}</div>${steps}</a>
    ${body}
    <div class="btn-row" style="margin-top:14px">${prepBtn}${shopBtn}</div></section>`;
}
// Repas du jour : midi et soir (creneaux vides masques ; a partir de 21 h, ceux de
// demain). Appui = fiche du repas ; bouton = mode cuisine pour le bon nombre de personnes.
export function todayMeals(w = week) {
  if (!w) return null;
  const late = new Date().getHours() >= 21, day = localDay(late ? 1 : 0);
  const rows = ['midi', 'soir'].map((s) => {
    const o = (w.outings || []).find((x) => x.date === day && x.slot === s);
    const m = w.meals.find((x) => x.date === day && x.slot === s && !x.suggestion);
    return o ? { slot: s, out: o } : m ? { slot: s, meal: m } : null;
  }).filter(Boolean);
  return { late, day, rows };
}
function todayCard(extra = '') {
  const t = todayMeals();
  if (!t || (!t.rows.length && !extra)) return '';
  const row = (r) => (r.out
    ? `<a class="item click" href="#/menu"><span class="ico">${I('pin')}</span><span class="grow"><span class="faint small block">${SLOT[r.slot]}</span><b>${esc(r.out.rest ? `Restes${r.out.dish ? ` · ${r.out.dish}` : ''}` : 'À l’extérieur')}</b>${r.out.note ? `<span class="muted small block">${esc(r.out.note)}</span>` : ''}</span></a>`
    : `<div class="item"><button class="tm-o" data-a="meal-open" data-id="${r.meal.id}" data-date="${r.meal.date}">${tile(r.meal.dish_name, '', 'tm', r.meal.photo)}<span class="grow"><span class="faint small block">${SLOT[r.slot]} · ${r.meal.persons} pers.</span><b>${esc(r.meal.dish)}</b></span></button>
      ${r.meal.dish_deleted ? '' : `<a class="ib" href="#/plats/${r.meal.dish_id}/cuisine/${r.meal.persons}" aria-label="Cuisiner ${esc(r.meal.dish_name)}" title="Cuisiner">${I('flame')}</a>`}</div>`);
  return box(t.late ? 'Demain au menu' : 'Aujourd’hui au menu', '<a href="#/menu">Menu</a>', t.rows.map(row).join('') + extra, 'today-c');
}
// Bloc de l'accueil : un cadre, son titre et son lien a l'interieur (meme forme partout).
const box = (title, action, content, cls = '') => `<section class="card box ${cls}"><div class="box-h"><span>${title}</span>${action || ''}</div>${content}</section>`;
// Liste datee en retard (date passee de plus d'un jour) : plus « la prochaine liste », rappel de cloture.
const overdue = (l) => l.type === 'dated' && l.status !== 'closed' && l.date < localDay(-1);
// Rappel de cloture (gestionnaire) : liste en courses dont tout est pris, ou date passee.
export function closeDue() {
  if (!summary || !isManager()) return [];
  return summary.upcoming.map((l) => ({ l, left: l.items - l.bought, allDone: l.status === 'shopping' && l.items > 0 && l.bought >= l.items }))
    .filter((x) => x.allDone || overdue(x.l));
}
const closeRows = () => closeDue().map(({ l, left, allDone }) => `<a class="item click" href="#/listes/${l.id}"><span class="ico leaf">${I('check')}</span>
  <span class="grow"><b>Clôturer les courses du ${esc(fmtDate(l.date, { day: 'numeric', month: 'long' }))}</b><span class="muted block">${allDone ? 'Tout est pris' : `date passée${left ? ` · ${plural(left, 'article')} non pris` : ''}`}</span></span>${I('chev', 's chev')}</a>`).join('');
export const closeBanner = (l) => { const x = closeDue().find((d) => d.l.id === l.id);
  return x ? `<button class="banner" data-a="list-close">${I('check')}<span class="grow" style="text-align:left">${x.allDone ? 'Tout est pris : clôturer la liste ?' : 'Courses passées : clôturer la liste ?'}</span>${I('chev', 's')}</button>` : ''; };
export const closeCount = () => closeDue().length;

// « À faire » : tout ce qui attend une action (absent s'il n'y a rien).
function todoBlock() {
  const mgr = isManager(), sug = S.house.pending || (S.suggestions || []).length;
  let html = closeRows() + ticketRows(summary.tickets || [], 0, true);
  if (mgr && sug) html += `<button class="item click" data-a="sugg-sheet"><span class="ico carrot">${I('bulb')}</span><span class="grow"><b>${plural(S.house.pending || (S.suggestions || []).length, 'suggestion')} à valider</b><span class="muted block">articles et plats proposés par les membres</span></span>${I('chev', 's chev')}</button>`;
  if (mgr && S.house.wishesPending) html += `<a class="item click" href="#/menu"><span class="ico carrot">${I('bulb')}</span><span class="grow"><b>${plural(S.house.wishesPending, 'envie')} de plat à valider</b><span class="muted block">dans le menu</span></span>${I('chev', 's chev')}</a>`;
  return html ? box('À faire', '', html, 'todo-c') : '';
}
// « À préparer à l'avance » : plats d'aujourd'hui et de demain.
function aheadRows() {
  if (!week) return '';
  return [0, 1].flatMap((n) => week.meals.filter((m) => m.date === localDay(n) && !m.suggestion).flatMap((m) => (m.ahead || []).map((a) =>
    `<div class="item"><span class="ico carrot">${I('clock')}</span><span class="grow"><b>À préparer à l’avance</b><span class="muted block">${n ? 'pour demain' : 'pour ce soir'} · ${esc(a.name)} : ${esc(a.ahead)}</span></span></div>`))).join('');
}
// « À prévoir » : pastilles + champ d'ajout rapide (plusieurs articles possibles : « lait, 2 beurre »).
function backlogBox() {
  const b = summary.backlog, items = backlogList ? backlogList.items.filter((i) => !i.suggestion && i.status !== 'bought') : [];
  return box('À prévoir', `<a href="#/listes/${b.id}">Voir</a>`, `${items.length ? `<div class="pills">${items.slice(0, 14).map((i) => `<span class="pill">${esc(i.name)}${i.qty !== 1 ? ` × ${qtyText(i.qty)}` : ''}</span>`).join('')}${items.length > 14 ? `<span class="pill">+${items.length - 14}</span>` : ''}</div>` : `<p class="muted small" style="margin:0">Rien pour l’instant.</p>`}
    <div class="row" style="margin-top:10px"><input class="txt grow" id="ap-q" placeholder="Ajouter : lait, 2 beurre, œufs…" autocomplete="off" data-enter="ap-add">${micButton('ap-q')}<button class="btn sm" data-a="ap-add" aria-label="Ajouter">${I('plus', 's')}</button></div>
    ${habits.length ? `<div class="muted small" style="margin:12px 2px 6px">Peut-être à racheter</div><div class="pills">${habits.map((x) => `<button class="pill click" data-a="habit-add" data-pid="${x.product_id}" title="Acheté tous les ${x.every_days} jours environ, dernière fois le ${esc(fmtDate(x.last_date))}">${I('plus', 's')} ${esc(x.name)}</button>`).join('')}</div>` : ''}`, 'backlog-c');
}
on('click', 'habit-add', async (el) => {
  const r = await attempt(() => sync(S.me.householdId, [newOp({ type: 'item.add', list_id: summary.backlog.id, product_id: Number(el.dataset.pid), qty: 1 })]));
  if (r === undefined) return;
  toast(isManager() ? 'Ajouté à « À prévoir »' : 'Suggestion envoyée au gestionnaire');
  await loadSummary(); render();
});
on('click', 'ap-add', async () => {
  const i = document.getElementById('ap-q');
  if (!i || !i.value.trim()) return;
  const text = i.value;
  if (await multiAdd(summary.backlog.id, text, async () => { await loadSummary(); render(); })) i.value = '';
});
// Prochaines courses en une ligne.
const nextOne = (l) => `<a class="item click" href="#/listes/${l.id}"><span class="ico ${l.status === 'shopping' ? 'leaf' : ''}">${I('basket')}</span>
  <span class="grow"><b>${esc(shortTitle(l))}</b><span class="muted block">${plural(l.items, 'article')}${l.estimate != null && l.items ? ` · ≈ ${eur(l.estimate)}` : ''}${l.advice && l.advice.stores.length ? ` · ${l.advice.stores.map((x) => esc(x.name)).join(' + ')}` : ''}</span></span>${statusPill(l)}${I('chev', 's chev')}</a>`;

// ---------- Accueil (onglet) : ce qu'il y a a faire aujourd'hui ----------
export function accueilView() {
  const s = summary, mgr = isManager(), next = s.upcoming.find((l) => !overdue(l));
  const today = todayCard(aheadRows());
  return {
    title: 'Accueil', sub: `${S.house.household.name} · ${fmtDate(localDay(), { weekday: 'long', day: 'numeric', month: 'long' })}`,
    body: `${todoBlock()}<div class="home-grid${isPc() ? ' three' : ''}"><div>${today}${backlogBox()}
      ${box('Prochaines courses', '<a href="#/listes">Listes</a>', next ? nextOne(next) : `<p class="muted small" style="margin:0">Aucune liste prévue.</p>${mgr ? '<button class="btn sm" style="margin-top:8px" data-a="list-new">＋ Nouvelle liste</button>' : ''}`)}
      </div>${isPc() ? `<div>${weekPreview()}</div>` : ''}</div>`,
  };
}

// ---------- Listes (onglet) : « À prévoir » et la prochaine liste ; le reste est replie ----------
export function listesView() {
  const s = summary, mgr = isManager();
  const dated = s.upcoming.filter((l) => !overdue(l)), [next, ...later] = dated;
  const listRow = (l) => `<a class="item click" href="#/listes/${l.id}"><span class="ico ${l.status === 'shopping' ? 'leaf' : ''}">${I(l.status === 'closed' ? 'check' : 'basket')}</span>
    <span class="grow"><b>${esc(shortTitle(l))}</b><span class="muted block">${plural(l.items, 'article')}${l.estimate != null && l.items ? ` · ≈ ${eur(l.estimate)}` : ''}${l.pending ? ` · ${plural(l.pending, 'suggestion')}` : ''}</span></span>${l.status !== 'closed' ? statusPill(l) : ''}${I('chev', 's chev')}</a>`;
  const b = s.backlog, open = S.q.otherOpen || isPc();
  const empty = (t) => `<p class="muted small" style="margin:4px 0 0">${t}</p>`;
  const sug = S.house.pending || (S.suggestions || []).length;
  return {
    title: 'Listes', sub: 'À prévoir et prochaine liste',
    body: `${sug && mgr ? `<button class="banner" data-a="sugg-sheet">${I('bulb')}<span class="grow">${plural(S.house.pending || sug, 'suggestion')} à valider</span>${I('chev', 's')}</button>` : ''}
      ${closeRows() ? box('À clôturer', '', closeRows(), 'todo-c') : ''}
      ${ticketsBox(s.tickets, 0, true)}
      <div class="home-grid${isPc() ? ' three' : ''}"><div>
      ${next ? heroCard(next) : box('Prochaines courses', '', `<p class="muted">Aucune liste de courses prévue.</p>${mgr ? '<button class="btn" data-a="list-new">＋ Nouvelle liste</button>' : ''}`, 'hero-c')}
      ${box('À prévoir', `<a href="#/listes/${b.id}">Ouvrir</a>`, `<a class="item click" href="#/listes/${b.id}"><span class="grow"><b>${plural(b.items, 'article')}</b>${b.pending ? ` <span class="pill p-carrot">${plural(b.pending, 'suggestion')}</span>` : ''}
        <span class="muted block">Sans date : à importer dans une prochaine liste${b.estimate != null && b.items ? ` · ≈ ${eur(b.estimate)}` : ''}.</span></span>${I('chev', 's chev')}</a>`)}
      </div>${isPc() ? `<div>${nextPreview()}</div>` : ''}<div>
      <button class="fold" data-a="other-toggle">${I(open ? 'up' : 'down', 's')}<span>Autres listes</span><span class="n">${later.length ? `${later.length} à venir · ` : ''}${s.closed.length} clôturée${s.closed.length > 1 ? 's' : ''}</span></button>
      ${open ? `${box('Listes à venir', mgr ? '<button data-a="list-new">＋ Nouvelle liste</button>' : '', later.map(listRow).join('') || empty('Pas d’autre liste prévue.'))}
        <div id="history">${box('Historique', '', s.closed.map(listRow).join('') || empty('Aucune liste clôturée.'))}</div>` : ''}
      </div></div>`,
  };
}
on('click', 'other-toggle', () => { S.q.otherOpen = !S.q.otherOpen; render(); });
// PC : articles a prendre de la prochaine liste, par magasin retenu.
function nextPreview() {
  const l = nextList;
  if (!l || l.id !== (summary.upcoming[0] || {}).id) return '';
  const todo = l.items.filter((i) => !i.suggestion && i.status === 'todo');
  const by = activeStores().map((st) => [st, todo.filter((i) => i.at_store_id === st.id)]).filter(([, xs]) => xs.length);
  return box('À prendre', `<a href="#/listes/${l.id}">Ouvrir</a>`, by.map(([st, xs]) => `<div class="box-part"><div class="row" style="margin-bottom:6px"><span class="st" style="--c:${esc(st.color)}">${esc(st.name)}</span><span class="grow"></span><span class="muted small">${plural(xs.length, 'article')}</span>
      <a class="ib" href="#/listes/${l.id}/magasin/${st.id}" aria-label="Mode courses ${esc(st.name)}" title="Mode courses">${I('cart', 's')}</a></div>
      <div class="pills">${xs.slice(0, 18).map((i) => `<span class="pill">${esc(i.name)}${i.qty !== 1 ? ` × ${qtyText(i.qty)}` : ''}</span>`).join('')}${xs.length > 18 ? `<span class="pill">+${xs.length - 18}</span>` : ''}</div></div>`).join('')
      || `<p class="muted small" style="margin:4px 0 0">${l.items.length ? 'Tout est dans le caddie.' : 'Liste vide pour l’instant.'}</p>`);
}
// PC : repas des 7 prochains jours.
function weekPreview() {
  if (!week) return '';
  const days = [...Array(7)].map((_, k) => localDay(k));
  const meals = week.meals.filter((m) => !m.suggestion);
  const order = ['pdj', 'midi', 'coll', 'soir'], rank = (x) => { const i = order.indexOf(x); return i < 0 ? 9 : i; };
  return box('Cette semaine au menu', '<a href="#/menu">Menu</a>', days.map((d) => {
    const ms = [...meals.filter((m) => m.date === d).map((m) => ({ slot: m.slot, html: esc(m.dish) })),
      ...(week.outings || []).filter((o) => o.date === d).map((o) => ({ slot: o.slot, html: `${I(o.rest ? 'repeat' : 'pin', 's')} ${esc(o.rest ? `Restes${o.dish ? ` · ${o.dish}` : ''}` : 'À l’extérieur')}${o.note ? ` · ${esc(o.note)}` : ''}` }))].sort((a, b) => rank(a.slot) - rank(b.slot));
    return `<div class="item"><span class="muted small" style="width:78px;flex:none">${esc(fmtDate(d, { weekday: 'short', day: 'numeric' }))}</span><span class="grow small">${ms.map((m) => `<span class="faint">${SLOT[m.slot]}</span> ${m.html}`).join(' · ') || '<span class="faint">—</span>'}</span></div>`; }).join(''));
}
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
// Une ligne par article : quantite × nom (· note), indicateurs courts, prix au magasin
// retenu, promo, etiquette du magasin. Le detail est dans la fiche. Mode courses (o.shop) :
// case a cocher, ni prix ni etiquette (magasin en indication si « Tous les magasins »).
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
    !o.shop && dated && open && i.status === 'bought' ? `<span style="color:var(--leaf)">${I('check', 's')} dans le caddie</span>` : '',
    o.shop && storeById(i.at_store_id) && (o.allStores || (o.here && i.at_store_id !== o.here)) ? `<span style="color:${esc(storeById(i.at_store_id).color)}">● ${o.allStores ? '' : 'conseillé chez '}${esc(storeById(i.at_store_id).name)}</span>` : '',
  ].join('');
  const check = o.shop && open && !i.suggestion
    ? `<button class="chk${i.status === 'bought' ? ' on' : ''}" data-a="item-check" data-id="${i.id}" aria-label="Acheté">${I('check')}</button>` : '';
  const priced = open && !i.deleted;
  const right = i.suggestion && open
    ? (mgr ? `<button class="ib" data-a="sugg-no" data-id="${i.id}" aria-label="Refuser">${I('x')}</button><button class="btn sm" data-a="sugg-ok" data-id="${i.id}" aria-label="Accepter">${I('check', 's')}</button>`
      : mine ? `<button class="ib" data-a="item-del" data-id="${i.id}" aria-label="Retirer">${I('x')}</button>` : '')
    : o.shop && open && mgr && i.status === 'todo' && !isTemp(i.id) ? ''
    : o.shop && open && i.status === 'bought' && !isTemp(i.id) ? `<button class="pill click" data-a="item-price" data-id="${i.id}" aria-label="Indiquer le prix payé">${i.paid != null ? esc(eur(i.paid)) : `${I('plus', 's')} prix`}</button>`
    : '';
  const tap = open && !i.suggestion;
  const swipe = o.shop && open && mgr && i.status === 'todo' && !i.suggestion && !isTemp(i.id);
  const html = `<div class="item line1${i.suggestion ? ' pending' : ''}${i.status === 'bought' && open ? ' done' : ''}${i.deleted ? ' gone' : ''}" id="it${i.id}">${check}
    <div class="grow nm${tap ? ' click' : ''}" ${tap ? `data-a="item" data-id="${i.id}"` : ''}><span class="t">${esc(i.name)}${i.qty !== 1 ? ` <span class="faint fw4">× ${qtyText(i.qty)}</span>` : ''}</span>
      <span class="meta">${meta || `<span>${esc(i.unit)}</span>`}</span></div>${right}</div>`;
  // Gestionnaire en courses : balayer vers la gauche pour retirer (swipe.js).
  return swipe ? `<div class="swipe"><button class="swipe-del" data-a="shop-del" data-id="${i.id}" tabindex="-1">${I('trash', 's')} Retirer</button>${html.replace('class="item line1', 'data-swipe="1" class="item line1')}</div>` : html;
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

// Preparer (liste datee en cours) : suggestions a valider, puis un bloc par magasin retenu
// (nombre d'articles, sous-total), articles dans l'ordre des rayons du magasin, sans coche.
// Sous-rayons : intitule sous le rayon (« Autres » pour les articles sans sous-rayon), dans l'ordre du magasin.
const subsOf = (cid) => ((S.house.categories.find((c) => c.id === cid) || {}).subs || []);
const subRank = (i, store) => {
  const subs = subsOf(i.category_id);
  if (!subs.length || !i.subcategory_id) return subs.length ? 1e6 : 0;
  const k = [...((store && store.subOrder) || []), ...subs.map((x) => x.id)].indexOf(i.subcategory_id);
  return k < 0 ? 1e6 : k;
};
function rowsWithSubs(its, store, rowFn) {
  let last = null, out = '';
  for (const i of its) {
    const subs = subsOf(i.category_id);
    if (subs.length) {
      const key = `${i.category_id}:${i.subcategory_id || 0}`;
      if (key !== last) { out += `<div class="subh">${esc((subs.find((x) => x.id === i.subcategory_id) || {}).name || 'Autres')}</div>`; last = key; }
    } else last = null;
    out += rowFn(i);
  }
  return out;
}
function prepBody(l) {
  const sugg = l.items.filter((i) => i.suggestion);
  const rest = l.items.filter((i) => !i.suggestion && i.status !== 'unavailable'), unav = l.items.filter((i) => !i.suggestion && i.status === 'unavailable');
  const st = (id) => (l.pricing && l.pricing.stores.find((x) => x.id === id)) || null;
  const stores = [...activeStores(), ...[...new Set(rest.map((i) => i.at_store_id))].filter((id) => !activeStores().some((x) => x.id === id)).map((id) => storeById(id) || { id, name: '?', color: 'var(--muted)', categoryOrder: [] })];
  const blocks = stores.map((s) => {
    const its = rest.filter((i) => i.at_store_id === s.id);
    if (!its.length) return '';
    const ord = [...(s.categoryOrder || []), ...categoryOrder()], rank = (i) => { const k = ord.indexOf(i.category_id); return k < 0 ? 1e6 : k; };
    its.sort((a, b) => rank(a) - rank(b) || subRank(a, s) - subRank(b, s) || a.name.localeCompare(b.name, 'fr'));
    const p = st(s.id);
    return `<div class="rayon"><span class="dot" style="background:${esc(s.color)}"></span><b style="color:var(--ink)">${esc(s.name)}</b><span class="n">${plural(its.length, 'article')}${p ? ` · ${eur(p.itemsTotal)}` : ''}</span></div>
      <div class="group">${rowsWithSubs(its, s, (i) => itemRow(i, l))}</div>`;
  }).join('');
  return `${sugg.length ? `<div class="rayon" style="color:var(--carrot)">${I('bulb', 's')} Suggestions à valider<span class="n">${sugg.length}</span></div><div class="group">${sugg.map((i) => itemRow(i, l)).join('')}</div>` : ''}
    ${blocks}
    ${!l.items.length ? `<div class="empty">${I('basket', 'l')}<p>Liste vide. ${isManager() ? 'Ajoutez un article ci-dessous.' : 'Suggérez un article ci-dessous.'}</p></div>` : ''}
    ${unav.length ? `<div class="rayon">Indisponibles<span class="n">${unav.length}</span></div><div class="group">${unav.map((i) => itemRow(i, l)).join('')}</div>` : ''}`;
}

// Articles par rayon (ordre donne) ; coches replies dans « Dans le caddie ».
function itemsBody(l, items, order, o = {}) {
  const open = l.status !== 'closed', dated = l.type === 'dated';
  const todo = items.filter((i) => !(dated && open && i.status === 'bought') && i.status !== 'unavailable');
  const unav = items.filter((i) => i.status === 'unavailable'), cart = dated && open ? items.filter((i) => i.status === 'bought') : [];
  const known = new Set(order);
  const groups = [...order, ...new Set(todo.map((i) => i.category_id).filter((c) => !known.has(c)))].map((cid) => [cid, todo.filter((i) => i.category_id === cid)]).filter(([, is]) => is.length);
  const key = `cart${l.id}`;
  return `${groups.map(([cid, is]) => `<div class="rayon">${esc(catName(cid))}<span class="n">${is.length}</span></div><div class="group">${rowsWithSubs([...is].sort((a, b) => subRank(a, o.store) - subRank(b, o.store)), o.store, (i) => itemRow(i, l, o))}</div>`).join('')}
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

// Liste datee en cours = « Preparer » (decider quoi, ou, a quel prix) ; le mode courses
// (storeListView) sert a acheter. « A prevoir » : par rayon ; liste close : lecture seule.
export function listView() {
  const l = current, mgr = isManager(), open = l.status !== 'closed', dated = l.type === 'dated';
  const real = l.items.filter((i) => !i.suggestion), done = real.filter((i) => i.status === 'bought').length;
  const meals = dated && l.meals && l.meals.length ? `<div class="sec">Repas couverts <a href="#/menu">Menu</a></div>
    <div class="hscroll">${l.meals.map((m) => `<button class="card click" style="width:150px;padding:12px" data-a="meal-open" data-id="${m.id}" data-date="${m.date}"><span class="muted small">${esc(fmtDate(m.date, { weekday: 'short', day: 'numeric' }))} · ${SLOT[m.slot]}</span><div style="font-weight:650;line-height:1.25;margin-top:2px">${esc(m.dish)}</div></button>`).join('')}</div>` : '';
  const body = !open ? `${ticketsBox(l.tickets, l.id)}${closedBody(l)}` : `${presenceLine(l)}${closeBanner(l)}${ticketsBox(l.tickets, l.id)}<div class="split"><div>
      ${dated ? prepBody(l) : itemsBody(l, l.items, categoryOrder())}</div>
      <div class="side">${dated ? scenCard(l) : ''}${meals}${dated ? basePanel(l) : ''}</div></div>`;
  const shopLbl = l.status === 'shopping' ? 'Reprendre les courses' : 'Partir faire les courses';
  return {
    title: !dated ? 'À prévoir' : open ? 'Préparer' : shortTitle(l), back: '#/listes',
    sub: !dated ? 'Liste permanente, sans date' : open ? `${shortTitle(l)} · ${STATUS[l.status]}${done ? ` · ${done}/${real.length} dans le caddie` : ''}` : STATUS[l.status],
    right: dated && mgr ? `<button class="ib" data-a="list-menu" aria-label="Actions de la liste">${I('more')}</button>` : '',
    body,
    dock: open ? `<button class="addbar" data-a="add-open">${I('plus')}<span class="grow">${mgr ? 'Ajouter un article' : 'Suggérer un article'}</span>${I('search', 's')}</button>
      ${dated && real.length ? `<button class="btn" data-a="shop-pick" data-id="${l.id}" aria-label="${shopLbl}" title="${shopLbl}">${I('cart')}</button>` : ''}` : null,
  };
}

// Mode courses : « Où fais-tu les courses ? ». Un magasin : toute la liste dans l'ordre de ses
// rayons (les articles conseilles ailleurs portent une mention, filtrables) ; « plusieurs
// magasins » : chaque article chez son magasin retenu, sans separation.
// Dernier magasin utilise (memorise sur l'appareil) : « Partir faire les courses » y va directement ;
// le changement se fait par l'icone magasin de l'en-tete.
const lastShop = () => { try { return localStorage.getItem('cabas-last-shop') || ''; } catch { return ''; } };
export function rememberShop(sid) { try { localStorage.setItem('cabas-last-shop', String(sid)); } catch { /* stockage indisponible */ } }
on('click', 'shop-pick', async (el) => {
  const id = Number(el.dataset.id);
  const last = lastShop();
  if (last && (last === 'tous' || (storeById(Number(last)) || {}).active)) { go(`#/listes/${id}/magasin/${last}`); return; }
  const l = current && current.id === id ? current : await attempt(() => get(hp(`/lists/${id}`)));
  if (l) shopPickSheet(l);
});
function shopPickSheet(l, exclude) {
  const left = (sid) => l.items.filter((i) => !i.suggestion && i.status === 'todo' && (!sid || i.at_store_id === sid)).length;
  const all = left();
  sheet(`<h3>Où fais-tu les courses ?</h3><p class="muted small">Tous les articles restants sont affichés ; ceux conseillés ailleurs portent une mention. Fonctionne sans réseau.</p>
    <div class="group">${activeStores().filter((x) => x.id !== exclude).map((x) => `<a class="item click" href="#/listes/${l.id}/magasin/${x.id}" data-a="close-go"><span class="dot" style="background:${esc(x.color)}"></span><span class="grow"><b>${esc(x.name)}</b><span class="muted block">${plural(all, 'article')} à prendre · dont ${left(x.id)} conseillé${left(x.id) > 1 ? 's' : ''} ici</span></span>${I('arrowR')}</a>`).join('')}
    ${exclude ? '' : `<a class="item click" href="#/listes/${l.id}/magasin/tous" data-a="close-go"><span class="ico leaf">${I('cart')}</span><span class="grow"><b>Plusieurs magasins</b><span class="muted block">Chaque article chez son magasin conseillé · choix du magasin au cochage</span></span>${I('arrowR')}</a>`}</div>`);
}
on('click', 'close-go', (el) => { closeSheet(); go(el.getAttribute('href')); });

// Magasins dont les articles sont masques en mode courses (par liste, sur l'appareil).
const hiddenStores = (l) => S.q[`shopf${l.id}`] || [];
on('click', 'shop-switch', () => shopPickSheet(current));
function shopFilterSheet() {
  const l = current, sid = Number(S.route[2]), real = l.items.filter((i) => !i.suggestion);
  const others = activeStores().filter((x) => x.id !== sid && real.some((i) => i.at_store_id === x.id && i.status !== 'bought'));
  const hid = hiddenStores(l);
  sheet(`<h3>Articles conseillés ailleurs</h3><p class="muted small">Cochez les magasins dont vous voulez voir les articles pendant les courses chez ${esc(storeName(sid))}.</p>
    <div class="group">${others.map((x) => { const n = real.filter((i) => i.at_store_id === x.id && i.status === 'todo').length; const on = !hid.includes(x.id);
      return `<button class="item click" data-a="shop-filter" data-sid="${x.id}"><span class="dot" style="background:${esc(x.color)}"></span><span class="grow">${esc(x.name)}</span><span class="muted small">${plural(n, 'article')}</span><span class="chk${on ? ' on' : ''}" aria-hidden="true">${on ? I('check') : ''}</span></button>`; }).join('')}</div>
    <div class="row gap" style="margin-top:12px"><button class="btn sec2 grow" data-a="shop-filter-all" data-v="none">Seulement ici</button><button class="btn sec2 grow" data-a="shop-filter-all" data-v="all">Tout afficher</button></div>
    <div class="row end"><button class="btn" data-a="close">OK</button></div>`);
}
on('click', 'shop-filters', () => shopFilterSheet());
on('click', 'shop-filter', (el) => {
  const k = `shopf${current.id}`, id = Number(el.dataset.sid), cur = hiddenStores(current);
  S.q[k] = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  render(); shopFilterSheet();
});
on('click', 'shop-filter-all', (el) => {
  S.q[`shopf${current.id}`] = el.dataset.v === 'none' ? activeStores().map((x) => x.id) : [];
  render(); shopFilterSheet();
});

export function storeListView(sid) {
  if (!current) return { title: 'Chargement…', body: '' };
  setTimeout(syncWake); // ecran allume pendant les courses (si le navigateur le permet)
  const l = current, all = sid === 'tous', s = all ? { id: 'tous', name: 'Plusieurs magasins', color: 'var(--leaf)', categoryOrder: categoryOrder() } : storeById(Number(sid));
  if (!s) return { title: 'Magasin', back: `#/listes/${l.id}`, body: '<p class="muted">Magasin inactif.</p>' };
  const real = l.items.filter((i) => !i.suggestion);
  // Dans un magasin : tout ce qui reste, plus ce qui y a ete pris (les articles pris ailleurs
  // lors d'un passage precedent ne s'affichent plus) ; les magasins decoches sont masques.
  const hidden = all ? [] : hiddenStores(l);
  const items = real.filter((i) => (all || i.status !== 'bought' || i.bought_at === s.id) && !(hidden.includes(i.at_store_id) && i.at_store_id !== s.id && i.status !== 'bought'));
  const done = items.filter((i) => i.status === 'bought');
  const priceHere = (i) => (all ? i.prices[i.at_store_id] : (i.prices[s.id] ?? i.prices[i.best_store_id]));
  const sum = (arr) => arr.reduce((t, i) => t + (priceHere(i) != null ? priceHere(i) * i.qty : 0), 0);
  const cartTotal = sum(done), cartUnknown = done.filter((i) => priceHere(i) == null).length;
  const total = sum(items.filter((i) => i.status !== 'unavailable'));
  const open = l.status !== 'closed';
  const pct = items.length ? Math.round((done.length / items.length) * 100) : 0;
  const stores = activeStores();
  // Autres magasins : un seul controle compact (resume + panneau), quel que soit leur nombre.
  const other = all ? [] : stores.filter((x) => x.id !== s.id && real.some((i) => i.at_store_id === x.id && i.status !== 'bought'));
  const shown = other.filter((x) => !hidden.includes(x.id));
  const hiddenN = real.filter((i) => i.status !== 'bought' && hidden.includes(i.at_store_id) && i.at_store_id !== s.id).length;
  const filt = other.length ? `<button class="fbar" data-a="shop-filters"><span class="dots">${shown.slice(0, 4).map((x) => `<span class="dot" style="background:${esc(x.color)}"></span>`).join('')}</span>
    <span class="grow">${!hidden.length ? 'Articles des autres magasins affichés' : shown.length ? `${shown.length} autre${shown.length > 1 ? 's' : ''} magasin${shown.length > 1 ? 's' : ''} affiché${shown.length > 1 ? 's' : ''} · ${hiddenN} masqué${hiddenN > 1 ? 's' : ''}` : `Seulement ce magasin · ${hiddenN} masqué${hiddenN > 1 ? 's' : ''}`}</span>${I('down', 's')}</button>` : '';
  const endLbl = all ? 'Terminer les courses' : `Terminer chez ${s.name}`;
  return {
    title: s.name, back: `#/listes/${l.id}`, noNav: true, sub: `Courses du ${shortTitle(l)}${isAwake() ? ' · écran allumé' : ''}`,
    right: stores.length > 1 ? `<button class="ib" data-a="shop-switch" aria-label="Changer de magasin" title="Changer de magasin">${I('store')}</button>` : '',
    body: `<div class="shop">
      <div class="shopbar2" style="--c:${esc(s.color)}"><b>${done.length}/${items.length}</b><div class="prog"><i style="width:${pct}%"></i></div><span class="price muted small">≈ ${eur(total)}</span>
        ${others(l).length ? `<span class="avatar sm" style="--c:var(--plum)" title="${esc(others(l).join(', '))} ${others(l).length > 1 ? 'sont' : 'est'} aussi sur cette liste">${esc(others(l)[0][0])}</span>` : ''}</div>
      ${filt}
      ${itemsBody(l, items, s.categoryOrder, { shop: true, store: all ? null : s, allStores: all, here: all ? null : s.id, empty: 'Aucun article à prendre.' })}</div>`,
    dock: open ? `<div class="btn-row">${btnI('plus', isManager() ? 'Ajouter un oubli' : 'Suggérer un article', 'data-a="add-open"')}${real.length ? btnI('check', esc(endLbl), `data-a="shop-end" data-sid="${all ? '' : s.id}" style="flex-grow:3;background:${esc(s.color)}"`, '') : ''}</div>` : null,
  };
}

// Fin d'un passage. Articles non pris : continuer dans un autre magasin (la liste reste
// « En courses »), reporter (cloture de la liste), ou indisponibles. Le ticket se scanne
// tout de suite ou plus tard (« Tickets à saisir »).
on('click', 'shop-end', (el) => {
  const sid = Number(el.dataset.sid) || null;
  const real = current.items.filter((i) => !i.suggestion);
  const left = real.filter((i) => i.status === 'todo');
  const bought = real.filter((i) => i.status === 'bought' && (!sid || i.bought_at === sid));
  const elsewhere = sid ? activeStores().filter((x) => x.id !== sid) : [];
  const awayLeft = left.some((i) => i.at_store_id !== sid);
  const mgr = isManager();
  // Tout est pris : pas de fenetre, le passage se termine ; le ticket se scanne depuis la notification.
  if (!left.length && bought.length) { finishDirect(sid); return; }
  const def = !left.length ? '' : elsewhere.length && (awayLeft || !mgr) ? 'continue' : mgr ? 'report' : 'continue';
  const opt = (v, t, d) => `<label class="row line"><input type="radio" class="cb" name="fate" value="${v}" ${def === v ? 'checked' : ''}><span class="grow">${t}<span class="muted block small">${d}</span></span></label>`;
  sheet(`<h3>${sid ? `Terminer chez ${esc(storeName(sid))}` : 'Terminer les courses'}</h3>
    <p class="muted">${plural(bought.length, 'article')} pris${sid ? ' ici' : ''}.${bought.length ? ' Le ticket peut être scanné maintenant ou plus tard, à la maison.' : ''}</p>
    ${left.length ? `<div class="sec">${plural(left.length, 'article')} non pris</div>
      ${elsewhere.length ? opt('continue', 'Continuer dans un autre magasin', 'La liste reste ouverte ; ils restent à prendre.') : ''}
      ${!sid ? opt('keep', 'Laisser sur la liste', 'La liste reste ouverte pour une autre sortie.') : ''}
      ${mgr ? opt('report', 'Reporter et clôturer la liste', 'Choix par article à l’étape suivante.') : ''}
      ${opt('unav', 'Marquer indisponibles', 'Ils seront reportés à la clôture de la liste.')}` : ''}
    <div class="row end wide">${bought.length ? `<button class="btn sec2" data-a="shop-end-go" data-sid="${sid || ''}" data-scan="1">${I('camera', 's')} Scanner le ticket</button>` : ''}<button class="btn" data-a="shop-end-go" data-sid="${sid || ''}">${bought.length ? 'Ticket plus tard' : 'Terminer'}</button></div>`);
});
// Parcours appris : ordre dans lequel les rayons ont ete parcourus pendant ce passage.
async function routeAsk(sid, lid) {
  if (!sid || !isManager() || !net.online) return;
  const r = await get(hp(`/stores/${sid}/route?list=${lid}`)).catch(() => null);
  if (!r || !r.changed) return;
  const nm = (id) => esc(catName(id));
  sheet(`<h3>Parcours de ${esc(storeName(sid))}</h3><p class="muted">Vous avez parcouru les rayons dans un autre ordre que celui enregistré. Mettre à jour le parcours du magasin ?</p>
    <div class="row gap" style="align-items:flex-start"><div class="grow"><div class="muted small">Actuel</div>${r.current.map((id, k) => `<div class="small">${k + 1}. ${nm(id)}</div>`).join('')}</div>
      <div class="grow"><div class="muted small">Parcouru</div>${r.order.map((id, k) => `<div class="small"${id !== r.current[k] ? ' style="font-weight:700;color:var(--leaf)"' : ''}>${k + 1}. ${nm(id)}</div>`).join('')}</div></div>
    <div class="row end" style="margin-top:14px"><button class="btn sec2" data-a="close">Plus tard</button><button class="btn" data-a="route-ok" data-sid="${sid}" data-order="${r.order.join(',')}">Mettre à jour</button></div>`);
}
on('click', 'route-ok', async (el) => {
  const sid = Number(el.dataset.sid);
  const r = await attempt(() => put(hp(`/stores/${sid}/order`), { categoryIds: el.dataset.order.split(',').map(Number) }));
  if (r === undefined) return;
  closeSheet(); await loadHouse(); toast('Parcours mis à jour'); render();
});
function finishDirect(sid) {
  const l = current, real = l.items.filter((i) => !i.suggestion);
  const stores = [...new Set(real.filter((i) => i.status === 'bought' && (!sid || i.bought_at === sid)).map((i) => i.bought_at).filter(Boolean))];
  runOps(stores.map((x) => newOp({ type: 'trip.finish', list_id: l.id, store_id: x })), () => {
    l.tickets = l.tickets || [];
    for (const x of stores) if (!l.tickets.some((t) => t.store_id === x)) {
      const st = storeById(x) || {};
      l.tickets.push({ store_id: x, name: st.name, color: st.color, items: real.filter((i) => i.status === 'bought' && i.bought_at === x).length });
    }
  }).then(() => {
    go(`#/listes/${l.id}`);
    toast('Courses terminées', false, { label: 'Scanner le ticket', a: 'scan-start', id: '' });
    const t = document.querySelector('.toast'); if (t) { t.dataset.lid = l.id; t.dataset.sid = stores[0] || ''; }
    routeAsk(sid, l.id);
  });
}
on('click', 'shop-end-go', (el) => {
  const sid = Number(el.dataset.sid) || null, scanNow = !!el.dataset.scan;
  const fate = (document.querySelector('.sheet [name=fate]:checked') || {}).value || '';
  const l = current;
  const real = l.items.filter((i) => !i.suggestion);
  const left = real.filter((i) => i.status === 'todo' && !isTemp(i.id));
  // Magasins ou des articles ont ete pris pendant ce passage.
  const stores = [...new Set(real.filter((i) => i.status === 'bought' && (!sid || i.bought_at === sid)).map((i) => i.bought_at).filter(Boolean))];
  const ops = stores.map((x) => newOp({ type: 'trip.finish', list_id: l.id, store_id: x }));
  if (fate === 'unav') ops.push(...left.map((i) => newOp({ type: 'item.update', item_id: i.id, fields: { status: 'unavailable' } })));
  const done = ops.length ? runOps(ops, () => {
    if (fate === 'unav') left.forEach((i) => { i.status = 'unavailable'; });
    l.tickets = l.tickets || [];
    for (const x of stores) if (!l.tickets.some((t) => t.store_id === x)) {
      const st = storeById(x) || {};
      l.tickets.push({ store_id: x, name: st.name, color: st.color, items: real.filter((i) => i.status === 'bought' && i.bought_at === x).length });
    }
  }) : Promise.resolve();
  // Le choix de la photo doit partir directement du clic.
  if (scanNow) { startScan(l.id, sid || stores[0]); return; }
  closeSheet();
  done.then(() => {
    if (fate !== 'continue') routeAsk(sid, l.id);
    if (fate === 'continue') shopPickSheet(current, sid);
    else if (fate === 'report' || (!left.length && isManager())) closeListSheet();
    else go(`#/listes/${l.id}`);
  });
});

on('click', 'store-cycle', async (el) => {
  const i = current.items.find((x) => x.id === Number(el.dataset.id));
  const ids = activeStores().map((s) => s.id);
  const next = ids[(ids.indexOf(i.at_store_id) + 1) % ids.length];
  // Revenir sur le magasin conseille = retour au conseil (plus de choix manuel).
  const inSheet = !!el.closest('.sheet');
  await itemUpdate(i, { store_id: next === i.best_store_id ? null : next });
  if (inSheet) document.querySelector(`[data-a=item][data-id="${i.id}"]`)?.click(); // la fiche se rouvre a jour
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
  const until = ex && ex.valid_until ? ex.valid_until : localDay(7);
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
  <div class="addbox"><div class="row"><input class="txt grow" id="add-q" autocomplete="off" autofocus placeholder="Rechercher un produit ou en saisir plusieurs : lait, 2 beurre…" data-in="add-q" data-enter="add-first">${micButton('add-q')}</div><div id="add-ac"></div></div>
  <div class="row" style="margin-top:10px"><span class="grow">Quantité</span><button class="btn sm sec2" data-a="qty" data-d="-1" aria-label="Moins">−</button><input class="txt w5 c" name="qty" inputmode="decimal" value="1"><button class="btn sm sec2" data-a="qty" data-d="1" aria-label="Plus">＋</button></div>`));
on('input', 'add-q', (el) => {
  const q = el.value.trim(), ms = q.includes(',') ? [] : matches(q);
  if (q.includes(',')) { const n = q.split(',').filter((x) => x.trim()).length; document.getElementById('add-ac').innerHTML = `<div class="ac"><button data-a="add-first"><b>Ajouter ${n} article${n > 1 ? 's' : ''}</b></button></div>`; return; }
  document.getElementById('add-ac').innerHTML = q ? `<div class="ac">${ms.map((p) => `<button data-a="add-item" data-id="${p.id}"><span class="grow">${esc(p.name)}</span><span class="muted">${esc(catName(p.category_id))}</span></button>`).join('')}
    ${ms.some((p) => norm(p.name) === norm(q)) ? '' : `<button data-a="add-new"><b>＋ Créer « ${esc(q)} » dans les produits</b></button>`}</div>` : '';
});
let newQty = 1;
const wantedQty = () => {
  const el = document.querySelector('.sheet [name=qty]');
  const v = el ? Number(String(el.value).replace(',', '.')) : newQty;
  return v > 0 ? v : 1;
};
async function addItem(product_id, qty = wantedQty()) {
  const p = S.products.find((x) => x.id === product_id) || { name: '?' };
  await runOps([newOp({ type: 'item.add', list_id: current.id, product_id, qty })], (l) => {
    const ex = isManager() && l.items.find((i) => i.product_id === product_id && !i.suggestion);
    if (ex) { ex.qty += qty; return; }
    const sid = p.best_store_id || (activeStores()[0] || {}).id;
    l.items.push({ id: `tmp-${Date.now()}`, product_id, name: p.name, category_id: p.category_id, unit: p.unit, qty, origin: 'manual', status: 'todo',
      suggestion: isManager() ? null : 'pending', suggested_by: S.me.id, suggested_by_name: S.me.name, prices: {}, promos: [], at_store_id: sid, best_store_id: sid });
  });
  toast(isManager() ? `${p.name} ajouté` : 'Suggestion envoyée au gestionnaire');
  const q = document.getElementById('add-q');
  if (q) { q.value = ''; document.getElementById('add-ac').innerHTML = ''; document.querySelector('.sheet [name=qty]').value = '1'; q.focus(); }
}
on('click', 'add-item', (el) => addItem(Number(el.dataset.id)));
on('click', 'add-first', () => {
  const q = document.getElementById('add-q').value.trim();
  // Plusieurs articles d'un coup (virgules) : apercu puis ajout.
  if (q.includes(',')) { closeSheet(); multiAdd(current.id, q, () => refreshList()); return; }
  const ms = matches(q);
  if (ms.length) addItem(ms[0].id); else if (q) document.querySelector('[data-a=add-new]')?.click();
});
on('click', 'add-new', () => {
  newQty = wantedQty();
  const q = document.getElementById('add-q').value.trim();
  sheet(`<h3>Nouveau produit</h3><p class="muted small">Ajouté aux produits du foyer, puis à la liste.</p>
    <label class="muted">Nom</label><input class="txt" name="name" value="${esc(q)}">
    <div class="row gap"><label class="grow"><span class="muted">Rayon</span><select class="txt" name="rayon">${catSubOptions()}</select></label>
    <label class="grow"><span class="muted">Emballage</span><select class="txt" name="unit">${unitOptions('paquet')}</select></label></div>
    ${contField()}
    <div class="row end"><button class="btn" data-a="add-new-ok">Créer et ajouter</button></div>`);
});
on('click', 'add-new-ok', async () => {
  const f = formData(document.querySelector('.sheet'));
  const name = f.name.trim();
  if (!name) return;
  closeSheet();
  const known = S.products.find((p) => norm(p.name) === norm(name));
  if (known) { await addItem(known.id, newQty); return; }
  // Un seul envoi : le serveur cree le produit puis l'ajoute a la liste (marche aussi sans reseau).
  const tmpId = `tmp-p${Date.now()}`, qty = newQty, [catS, subS] = String(f.rayon).split(':'), cat = Number(catS), sub = subS ? Number(subS) : null;
  await runOps([newOp({ type: 'product.add', name, rayon: f.rayon, unit: f.unit, cont_n: f.cont_n, cont_u: f.cont_u, list_id: current.id, qty })], (l) => {
    S.products.push({ id: tmpId, name, category_id: cat, subcategory_id: sub, unit: f.unit, prices: {}, best_store_id: null });
    const sid = (activeStores()[0] || {}).id;
    l.items.push({ id: `tmp-${Date.now()}`, product_id: tmpId, name, category_id: cat, subcategory_id: sub, unit: f.unit, qty, origin: 'manual', status: 'todo',
      suggestion: isManager() ? null : 'pending', suggested_by: S.me.id, suggested_by_name: S.me.name, prices: {}, promos: [], at_store_id: sid, best_store_id: null });
  });
  toast(isManager() ? `${name} créé et ajouté` : 'Suggestion envoyée au gestionnaire');
  if (net.online) loadProducts().catch(() => {}); // sans reseau : le produit temporaire reste dans la liste locale
});

// ---------- Coche, suggestions ----------
on('click', 'item-check', async (el) => {
  const i = current.items.find((x) => String(x.id) === el.dataset.id);
  if (!i || isTemp(i.id)) return;
  const buying = i.status !== 'bought';
  // Magasin ou on est (mode « plusieurs magasins » : celui de l'article, modifiable au prix).
  const here = S.route[2] === 'tous' ? i.at_store_id : Number(S.route[2]);
  // Un seul appui : l'article est dans le caddie. Le prix paye reste facultatif : bouton « ＋ prix » sur la ligne.
  if (navigator.vibrate) navigator.vibrate(buying ? 15 : [10, 40, 10]);
  await itemUpdate(i, buying ? { status: 'bought', bought_store_id: here } : { status: 'todo' });
  if (!buying) delete i.paid;
  else if (S.route[0] === 'magasin') toast(`${i.name} dans le caddie`, false, { label: '＋ prix', a: 'item-price', id: i.id });
});
// Retirer un article depuis le mode courses (gestionnaire) : marche hors-ligne, « Annuler » le remet.
on('click', 'shop-del', async (el) => {
  const i = current.items.find((x) => String(x.id) === el.dataset.id);
  if (!i || isTemp(i.id)) return;
  const back = { product_id: i.product_id, qty: i.manual_qty || i.qty, name: i.name };
  await runOps([newOp({ type: 'item.remove', item_id: i.id })], (l) => { l.items = l.items.filter((x) => x.id !== i.id); });
  lastRemoved = back;
  toast(`${i.name} retiré de la liste`, false, { label: 'Annuler', a: 'shop-del-undo' });
});
let lastRemoved = null;
on('click', 'shop-del-undo', async () => {
  document.querySelector('.toast')?.remove();
  if (!lastRemoved) return;
  const b = lastRemoved; lastRemoved = null;
  await runOps([newOp({ type: 'item.add', list_id: current.id, product_id: b.product_id, qty: b.qty })], () => {});
  toast(`${b.name} remis dans la liste`);
});
on('click', 'item-price', (el) => {
  document.querySelector('.toast')?.remove();
  const i = current.items.find((x) => String(x.id) === el.dataset.id);
  if (i && !isTemp(i.id)) priceSheet(i, i.bought_at || i.at_store_id);
});
function priceSheet(i, sid) {
  const avg = i.prices[sid];
  const stores = activeStores();
  sheet(`<h3>${esc(i.name)}</h3><p class="muted">Prix payé (facultatif)${avg != null ? ` — moyenne ${eur(avg)} chez ${esc(storeName(sid))}` : ''}</p>
    <input class="txt big" name="price" inputmode="decimal" placeholder="${avg != null ? (avg / 100).toFixed(2).replace('.', ',') : '0,00'}" data-enter="price-ok" data-id="${i.id}">
    ${stores.length > 1 ? `<label class="row line"><span class="grow">Magasin</span><select class="txt w12" name="store_id">${stores.map((x) => `<option value="${x.id}" ${x.id === sid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : `<input type="hidden" name="store_id" value="${sid}">`}
    <label class="row line"><input type="checkbox" class="cb" name="promo"><span class="grow">Prix promo (hors moyenne)</span></label>
    <div class="row end"><button class="btn sec2" data-a="close">Passer</button><button class="btn" data-a="price-ok" data-id="${i.id}">Enregistrer le prix</button></div>`);
}
on('click', 'price-ok', async (el) => {
  const f = formData(document.querySelector('.sheet'));
  closeSheet();
  const i = current.items.find((x) => String(x.id) === el.dataset.id);
  const sid = Number(f.store_id);
  // Le magasin choisi est aussi celui ou l'article a ete pris.
  if (sid && sid !== (i.bought_at || i.at_store_id)) await itemUpdate(i, { status: 'bought', bought_store_id: sid });
  if (!String(f.price).trim()) return;
  const cents = Math.round(parseFloat(String(f.price).replace(',', '.')) * 100);
  if (cents > 0) { i.paid = cents; render(); }
  const r = await attempt(() => sync(S.me.householdId, [newOp({ type: 'record.add', product_id: i.product_id, store_id: sid, price: f.price, promo: f.promo })]));
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
    ${current.type === 'dated' && current.status !== 'closed' && !i.suggestion && i.at_store_id ? `<div class="row line"><span class="grow"><b>Magasin</b><span class="muted block">${i.prices && i.prices[i.at_store_id] != null ? `≈ ${eur(i.prices[i.at_store_id] * i.qty)}` : 'prix inconnu'} · touchez pour changer</span></span>${storeButton(i)}</div>` : ''}
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
on('click', 'list-close', () => closeListSheet());
function closeListSheet() {
  const left = current.items.filter((i) => i.status !== 'bought' && !i.suggestion);
  const next = current.next;
  const opts = (i) => `<select class="txt w12" data-fate="${i.id}">${next ? `<option value="next">Liste du ${esc(fmtDate(next.date))}</option>` : ''}<option value="backlog">À prévoir</option><option value="drop">Abandonner</option></select>`;
  sheet(`<h3>Clôturer la liste</h3>
    ${left.length ? `<p class="muted">${left.length} article${left.length > 1 ? 's' : ''} non acheté${left.length > 1 ? 's' : ''}. Où ${left.length > 1 ? 'les' : 'le'} reporter ?</p>
    ${left.map((i) => `<div class="row line"><span class="grow">${qtyText(i.qty)} × ${esc(i.name)}</span>${opts(i)}</div>`).join('')}` : '<p class="muted">Tout a été acheté : la liste passe dans l’historique.</p>'}
    ${current.items.some((i) => i.suggestion) ? '<p class="muted small">Les suggestions en attente seront abandonnées.</p>' : ''}
    <div class="row end"><button class="btn sec2" data-a="close">Annuler</button><button class="btn" data-a="list-close-ok">Clôturer</button></div>`);
}
on('click', 'list-close-ok', async () => {
  const fates = {};
  document.querySelectorAll('.sheet [data-fate]').forEach((s) => { fates[s.dataset.fate] = s.value; });
  const r = await attempt(() => post(hp(`/lists/${current.id}/close`), { fates }));
  if (r) { closeSheet(); summary = null; toast('Liste clôturée'); await refreshList(); if (S.route[0] === 'magasin') go(`#/listes/${current.id}`); }
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

export const listNeedsLoad = () => !summary || !backlogList;
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
