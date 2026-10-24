// Point d'entree : connexion (lien e-mail, invitation), navigation par #, cadre de
// l'ecran (en-tete, navigation en bas sur mobile / barre laterale sur PC).
import { esc, on, toggleAcc, isPc, toast, closeSheet, localDay } from './ui.js';
import { I } from './icons.js';
import { plusView, promosView, loadPromos, topMenu } from './plus.js';
import { get, post, ApiError, net, outbox, onNetChange, onFlushed, flush } from './api.js';
import { warm } from './offline.js';
import { S, setRenderer, render, loadHouse, loadProducts, go, hp, isManager } from './state.js';
import { loginView, foyersView, setInvite, setReset, loadOptions, loadInvitation, acceptPending, resetPending } from './connexion.js';
import { foyerView } from './foyer.js';
import { magasinsView } from './magasins.js';
import './swipe.js';
import './pick.js';
import './recherche.js';
import './install.js'; // tot : retient l'invite d'installation du navigateur
import { catalogueView, productView, loadProduct } from './catalogue.js';
import { scanView } from './scan.js';
import { platsView, dishView, cookView, loadDishes, loadDish } from './plats.js';
import { menuView, exportView, publicView, loadMenu, loadExport, loadPublic } from './menu.js';
import { listesView, accueilView, listView, storeListView, loadSummary, loadList, loadSuggestions, listNeedsLoad, currentList, todayMeals, closeCount, rememberShop } from './listes.js';

const app = document.getElementById('app');

// Onglets : Accueil, Listes, ＋ (ajout rapide), Menu, Plats ; l'ancien onglet Plus est le menu ☰
// en haut a droite (telephone) ; sur PC, barre laterale avec en plus les acces directs.
const NAV = [['accueil', 'Accueil', 'home'], ['listes', 'Listes', 'basket'], ['+'], ['menu', 'Menu', 'calendar'], ['plats', 'Plats', 'bowl'], ['plus', 'Plus', 'grid']];
const TAB_SCREENS = ['accueil', 'listes', 'menu', 'plats']; // ecrans d'onglet : bouton ☰ en haut (telephone)
const MANAGER_ONLY = ['catalogue', 'magasins', 'foyer', 'promos'];
const PC_EXTRA = [['catalogue', 'Produits', 'tag'], ['magasins', 'Magasins', 'store'], ['foyer', 'Foyer', 'users']];

const ROUTES = {
  accueil: accueilView,
  listes: listesView,
  liste: listView,
  magasin: () => storeListView(S.route[2]),
  menu: menuView,
  menuexport: exportView,
  plats: platsView,
  plat: dishView,
  cuisine: cookView,
  catalogue: catalogueView,
  produit: productView,
  magasins: magasinsView,
  foyer: foyerView,
  foyers: foyersView,
  scan: scanView,
  plus: plusView,
  promos: promosView,
};

// Ecran : { title, sub, back, right, body, large (grand titre d'onglet), dock (barre du bas), noNav, cols, wide }.
let lastRoute = '';
function shell(v) {
  const tab = { produit: 'catalogue', foyers: 'foyer', liste: 'listes', magasin: 'listes', scan: 'listes', plat: 'plats', cuisine: 'plats', menuexport: 'menu', promos: 'plus' }[S.route[0]] || S.route[0];
  const inPlus = ['catalogue', 'magasins', 'foyer', 'plus'].includes(tab);
  const mgr = S.house && S.house.role === 'manager';
  const badge = { listes: mgr && (S.house.pending + closeCount()), menu: mgr && S.house.wishesPending };
  const link = ([k, t, ic], on) => `<a href="#/${k}" class="${on ? 'on' : ''}">${I(ic, 'l')}<span>${t}</span>${badge[k] ? `<span class="badge">${badge[k]}</span>` : ''}</a>`;
  const nav = v.noNav || !S.house ? '' : `<nav class="tabs"><div class="brand"><span class="logo">${I('basket')}</span>Le Cabas</div>
    <a class="hh" href="#/foyers">${I('users', 's')}<span class="grow">${esc(S.house.household.name)}</span>${I('down', 's')}</a>
    ${NAV.map((n) => (n[0] === '+' ? `<button class="plus" data-a="quick" aria-label="Ajouter">${I('plus', 'l')}<span>Ajouter</span></button>`
      : n[0] === 'plus' ? (isPc() ? (mgr ? PC_EXTRA.map((x) => link(x, tab === x[0])).join('') : '') + link(n, inPlus) : '')
      : link(n, tab === n[0]))).join('')}</nav>`;
  // Ecrans de l'onglet Plus : retour vers Plus (sur telephone).
  if (!v.back && !isPc() && ['catalogue', 'magasins', 'foyer'].includes(S.route[0])) v = { ...v, back: '#/plus' };
  app.className = 'shell' + (v.noNav ? ' nonav' : '') + (v.wide ? ' wide' : '') + (v.dock ? ' has-dock' : '');
  const pending = S.me ? outbox().length : 0;
  const hhmm = (t) => new Date(t).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
  const banner = !S.me ? '' : !net.online
    ? `<div class="net off">${I('wifioff')}<span><b>Hors-ligne</b>${net.syncedAt ? ` · données du ${hhmm(net.syncedAt)}` : ''}${pending ? ` · ${pending} modification${pending > 1 ? 's' : ''} en attente` : ''}</span></div>`
    : pending ? `<div class="net wait">${I('clock')}<span>${pending} modification${pending > 1 ? 's' : ''} en cours d'envoi…</span></div>` : '';
  const key = location.hash.split('?')[0];
  const enter = key !== lastRoute;
  lastRoute = key;
  app.innerHTML = `<header class="top">${v.back ? `<a class="back" href="${v.back}" aria-label="Retour">${I('back')}</a>` : ''}<h2>${esc(v.title)}${v.sub ? `<small>${esc(v.sub)}</small>` : ''}</h2><div class="acts-r">${v.right || ''}${TAB_SCREENS.includes(S.route[0]) && S.house ? `<button class="ib" data-a="gsearch" aria-label="Rechercher">${I('search')}</button>` : ''}${TAB_SCREENS.includes(S.route[0]) && !isPc() && S.house ? `<button class="ib" data-a="topmenu" aria-label="Menu : produits, magasins, foyer…">${I('menu')}</button>` : ''}</div></header>
    <main class="${enter ? 'enter' : ''}">${banner}<div class="${v.cols ? `cols ${v.cols === true ? '' : v.cols}` : ''}">${v.body}</div></main>
    ${v.dock ? `<div class="dock">${v.dock}</div>` : ''}${nav}`;
  onScroll();
}
// En-tete : bordure et petit titre une fois le grand titre passe.
function onScroll() { document.querySelector('header.top')?.classList.toggle('scrolled', window.scrollY > 30); }
window.addEventListener('scroll', onScroll, { passive: true });

// Raccourcis de l'icone (appui long, manifest.json) : ouvre l'ecran puis declenche l'action.
let pendingClick = null;
async function shortcut(kind) {
  let to = '#/listes';
  try {
    if (!S.house) await loadHouse();
    if (kind === 'article') {
      const s = await get(hp('/lists'));
      const l = s.upcoming[0] || s.backlog; // prochaine liste datee en cours, sinon « À prevoir »
      if (l) { to = `#/listes/${l.id}`; pendingClick = 'add-open'; } else toast('Aucune liste en cours');
    } else if (kind === 'plat' && isManager()) to = '#/plats/nouveau';
    else if (kind === 'envie' || kind === 'plat') { to = '#/menu'; pendingClick = 'wish-add'; }
    else if (kind === 'repas') {
      // Repas du jour : mode cuisine du soir (a partir de 14 h), sinon du midi, sinon du
      // repas restant ; rien de prevu = menu.
      const t = todayMeals(await get(hp(`/menu?from=${localDay()}&days=2`)));
      const ms = t.rows.filter((r) => r.meal && !r.meal.dish_deleted);
      const m = (new Date().getHours() >= 14 && ms.find((r) => r.slot === 'soir')) || ms[0];
      if (m) to = `#/plats/${m.meal.dish_id}/cuisine/${m.meal.persons}`;
      else { to = '#/menu'; toast(t.late ? 'Rien de prévu demain' : 'Rien de prévu aujourd’hui'); }
    }
  } catch { /* hors-ligne : ecran des listes */ }
  history.replaceState(null, '', location.pathname + location.search + to); // le raccourci ne reste pas dans l'historique
  return route();
}

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  // Affichage public du menu : sans connexion.
  if (parts[0] === 'affichage' && parts[1]) {
    S.route = ['affichage', parts[1]];
    await loadPublic(parts[1]);
    shell(publicView());
    return;
  }
  if (!S.me || resetPending()) { S.route = ['login']; shell(loginView()); return; }
  if (!S.me.householdId) { S.route = ['foyers']; shell(foyersView()); return; }
  let [name, arg] = parts;
  if (name === 'catalogue' && arg) name = 'produit';
  if (name === 'listes' && arg) name = parts[2] === 'magasin' ? 'magasin' : 'liste';
  if (name === 'plats' && arg) name = parts[2] === 'cuisine' ? 'cuisine' : 'plat';
  if (name === 'menu' && arg === 'export') name = 'menuexport';
  if (name === 'raccourci') return shortcut(arg);
  if (!name) { go('#/accueil'); return; }
  if (!ROUTES[name]) { go('#/accueil'); return; }
  // Ecrans de gestion (onglet Plus) : gestionnaires seulement ; un membre est renvoye vers
  // son profil. Le serveur refuse de toute facon les modifications (garde `manager`).
  if (S.house && S.house.role !== 'manager' && MANAGER_ONLY.includes(name)) { go('#/plus'); return; }
  S.route = [name, arg, parts[3]];
  connectEvents();
  try {
    if (!S.house) await loadHouse();
    if (S.house.role !== 'manager' && MANAGER_ONLY.includes(name)) { go('#/plus'); return; }
    if (name === 'catalogue' && !S.products) await loadProducts();
    if (name === 'produit') await loadProduct(arg);
    if (name === 'listes' || name === 'accueil') await Promise.all([loadSummary(), loadSuggestions()]);
    if (name === 'liste' || name === 'magasin') await loadList(arg, name === 'magasin');
    if (name === 'magasin') rememberShop(parts[3]);
    if (name === 'plats') { S.dishReturn = null; await loadDishes(); }
    if (name === 'plat' || name === 'cuisine') await loadDish(arg);
    if (name === 'promos') await loadPromos();
    if (name === 'menu') await loadMenu();
    if (name === 'menuexport') await loadExport();
    shell(ROUTES[name]());
    prefetch(); // limite : au plus toutes les 20 min (offline.js)
    if (pendingClick) { const a = pendingClick; pendingClick = null; document.querySelector(`[data-a="${a}"]`)?.click(); }
  } catch (e) {
    if (e instanceof ApiError && e.status === 404 && name === 'produit') { go('#/catalogue'); return; }
    if (e instanceof ApiError && e.status === 404 && name === 'liste') { go('#/listes'); return; }
    if (e instanceof ApiError && e.status === 404 && name === 'plat') { go('#/plats'); return; }
    if (e instanceof ApiError && e.status === 401) { location.href = './'; return; }
    if (e instanceof ApiError && e.status === 0) {
      shell({ title: 'Hors-ligne', back: '#/listes', body: '<div class="card"><h4>Pas de réseau</h4><p class="muted">Cette page n’a pas encore été ouverte avec du réseau sur cet appareil. Les listes à venir, elles, sont gardées dès l’ouverture de l’app.</p></div>' });
      return;
    }
    app.innerHTML = `<div class="card error">${esc(e.message)}</div>`;
  }
}

setRenderer(() => {
  // Re-rendu sans recharger (sauf changement d'adresse) : on garde le defilement.
  const y = window.scrollY;
  const [name, arg] = S.route;
  if (!S.me || resetPending()) shell(loginView());
  else if (!S.me.householdId) shell(foyersView());
  else if (name === 'affichage') shell(publicView());
  else if ((name === 'catalogue' && !S.products) || ((name === 'listes' || name === 'accueil') && listNeedsLoad()) || (name === 'plats' && !S.dishes)) { route(); return; }
  else if (ROUTES[name]) shell(ROUTES[name](arg));
  window.scrollTo(0, y);
});

// Changement d'ecran : un panneau ouvert se ferme (retour du navigateur compris).
// Nouvel ecran : en haut ; menu sur telephone : sur aujourd'hui (sous l'en-tete).
function scrollStart() {
  const d = S.route?.[0] === 'menu' && !isPc() && document.querySelector('.agenda .day.today');
  window.scrollTo(0, d ? d.getBoundingClientRect().top + window.scrollY - 70 : 0);
}
window.addEventListener('hashchange', () => { closeSheet(); route().then(scrollStart); });
// Passage mobile <-> PC : la mise en page et l'etat des accordeons changent.
window.matchMedia('(min-width: 900px)').addEventListener('change', () => render());

on('click', 'acc', (el) => { toggleAcc(el.dataset.id, el.dataset.def === 'closed' ? 'closed' : !!el.dataset.def); render(); });

// ---------- Temps reel (SSE) ----------
let es = null, esKey = '', reloadTimer = null;
function connectEvents() {
  const hid = S.me && S.me.householdId;
  const listId = ['liste', 'magasin'].includes(S.route[0]) ? S.route[1] : '';
  const key = hid && net.online ? `${hid}:${listId}` : '';
  if (key === esKey) return;
  if (es) es.close();
  es = null; esKey = key;
  if (!key) return;
  es = new EventSource(`api/h/${hid}/events?list=${listId}`);
  es.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.type === 'presence') { S.presence = d.users; if (S.route[0] === 'magasin' && currentList()) render(); return; }
    if (d.type === 'change' && d.by !== S.me.id) {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(reloadView, 300); // plusieurs changements rapproches : un seul rechargement
    }
  };
}
// Recharge l'ecran courant apres un changement fait par quelqu'un d'autre.
async function reloadView() {
  try {
    const [name, arg] = S.route;
    if ((name === 'liste' || name === 'magasin') && currentList()) await loadList(arg);
    else if (name === 'listes' || name === 'accueil') await Promise.all([loadSummary(), loadSuggestions()]);
    await loadHouse();
    if (!document.querySelector('.sheet-bg')) render();
  } catch { /* hors-ligne : on garde l'affichage */ }
}
onNetChange(() => { connectEvents(); if (S.me) { render(); if (net.online) prefetch(); } });
onFlushed(() => reloadView());

// Ecrans utiles en magasin gardes sur l'appareil (voir offline.js) : au demarrage et au
// retour du reseau.
const prefetch = () => warm(S.me && S.me.householdId);

// Application installable et utilisable sans reseau (voir sw.js).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // Appui sur un rappel quand l'app est deja ouverte : ecran indique par la notification.
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && typeof e.data.go === 'string' && e.data.go.startsWith('#/')) go(e.data.go); });
}
on('click', 'go', (el) => go(el.dataset.to));
on('click', 'topmenu', () => topMenu());

// ---------- Demarrage ----------
async function boot() {
  const params = new URLSearchParams(location.search);
  const login = params.get('login');
  if (params.get('invite')) setInvite(params.get('invite'));
  if (params.get('reset')) setReset(params.get('reset'));
  if (login || params.get('invite') || params.get('reset')) history.replaceState(null, '', location.pathname + location.hash);
  await loadOptions();
  let loginError = null;
  if (login) {
    try { S.me = await post('auth/verify', { token: login }); } catch (e) { loginError = e.message; }
  }
  if (!S.me) S.me = await get('me').catch(() => null);
  await loadInvitation();
  await route();
  scrollStart();
  if (loginError && !S.me) toast(loginError, true);
  if (S.me) await acceptPending();
  flush();
  prefetch();
}
boot();
