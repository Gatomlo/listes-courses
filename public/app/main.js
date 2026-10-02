// Point d'entree : connexion (lien e-mail, invitation), navigation par #, cadre de
// l'ecran (en-tete, navigation en bas sur mobile / barre laterale sur PC).
import { esc, on, toggleAcc, isPc, toast } from './ui.js';
import { get, post, ApiError, net, outbox, onNetChange, onFlushed, flush } from './api.js';
import { S, setRenderer, render, loadHouse, loadProducts, go } from './state.js';
import { loginView, foyersView, setInvite, loadInvitation, acceptPending } from './connexion.js';
import { foyerView } from './foyer.js';
import { catalogueView, productView, loadProduct } from './catalogue.js';
import { listesView, listView, storeListView, loadSummary, loadList, loadSuggestions, listNeedsLoad, currentList } from './listes.js';

const app = document.getElementById('app');

const NAV = [
  ['listes', 'Listes', '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'],
  ['menu', 'Menu', '<rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/>'],
  ['plats', 'Plats', '<path d="M5 4.5A1.5 1.5 0 016.5 3H19v15H6.5A1.5 1.5 0 005 19.5v-15zM5 19.5A1.5 1.5 0 006.5 21H19"/>'],
  ['catalogue', 'Catalogue', '<path d="M4 7l8-4 8 4-8 4-8-4zM4 12l8 4 8-4M4 17l8 4 8-4"/>'],
  ['foyer', 'Foyer', '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 010 7M18 14.8c1.9.7 3 2.4 3.5 5.2"/>'],
];

// Ecrans des etapes suivantes.
const soon = (title, what) => () => ({
  title, sub: 'Bientôt disponible',
  body: `<div class="card"><h4>🚧 ${esc(title)} arrive à la prochaine étape</h4><p class="muted">${what}</p>
    <p class="muted">En attendant, préparez le <a href="#/catalogue">catalogue</a> et les <a href="#/foyer">magasins et rayons</a> du foyer.</p></div>`,
});

const ROUTES = {
  listes: listesView,
  liste: listView,
  magasin: () => storeListView(S.route[2]),
  menu: soon('Menu', 'Planning des repas par créneau, ingrédients ajoutés à la liste de la période, export et impression.'),
  plats: soon('Plats', 'Plats et recettes (import depuis un lien), historique des planifications.'),
  catalogue: catalogueView,
  produit: productView,
  foyer: foyerView,
  foyers: foyersView,
};

function shell(v) {
  const tab = { produit: 'catalogue', foyers: 'foyer', liste: 'listes', magasin: 'listes' }[S.route[0]] || S.route[0];
  const badge = S.house && S.house.role === 'manager' && S.house.pending ? `<span class="badge">${S.house.pending}</span>` : '';
  const nav = v.noNav ? '' : `<nav class="tabs">${isPc() ? `<div class="brand">🧺 Le Cabas<small>${esc(S.house ? S.house.household.name : '')}</small></div>` : ''}
    ${NAV.map(([k, t, svg]) => `<a href="#/${k}" class="${tab === k ? 'on' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svg}</svg><span>${t}</span>${k === 'listes' ? badge : ''}</a>`).join('')}</nav>`;
  app.className = 'shell' + (v.noNav ? ' nonav' : '');
  const pending = S.me ? outbox().length : 0;
  const hhmm = (t) => new Date(t).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
  const banner = !S.me ? '' : !net.online
    ? `<div class="net off">📴 <b>Hors-ligne</b>${net.syncedAt ? ` · données du ${hhmm(net.syncedAt)}` : ''}${pending ? ` · ${pending} modification${pending > 1 ? 's' : ''} en attente` : ''}</div>`
    : pending ? `<div class="net wait">⏳ ${pending} modification${pending > 1 ? 's' : ''} en cours d'envoi…</div>` : '';
  app.innerHTML = `<header class="top">${v.back ? `<a class="back" href="${v.back}" aria-label="Retour">‹</a>` : ''}<h2>${esc(v.title)}${v.sub ? `<small>${esc(v.sub)}</small>` : ''}</h2>${v.right || ''}</header>
    <main>${banner}<div class="${v.cols ? 'cols' : ''}">${v.body}</div></main>${nav}`;
}

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!S.me) { S.route = ['login']; shell(loginView()); return; }
  if (!S.me.householdId) { S.route = ['foyers']; shell(foyersView()); return; }
  let [name, arg] = parts;
  if (name === 'catalogue' && arg) name = 'produit';
  if (name === 'listes' && arg) name = parts[2] === 'magasin' ? 'magasin' : 'liste';
  if (!ROUTES[name]) { go('#/listes'); return; }
  S.route = [name, arg, parts[3]];
  connectEvents();
  try {
    if (!S.house) await loadHouse();
    if (name === 'catalogue' && !S.products) await loadProducts();
    if (name === 'produit') await loadProduct(arg);
    if (name === 'listes') await Promise.all([loadSummary(), loadSuggestions()]);
    if (name === 'liste' || name === 'magasin') await loadList(arg);
    shell(ROUTES[name]());
  } catch (e) {
    if (e instanceof ApiError && e.status === 404 && name === 'produit') { go('#/catalogue'); return; }
    if (e instanceof ApiError && e.status === 404 && name === 'liste') { go('#/listes'); return; }
    if (e instanceof ApiError && e.status === 401) { location.href = './'; return; }
    if (e instanceof ApiError && e.status === 0) {
      shell({ title: 'Hors-ligne', back: '#/listes', body: '<div class="card"><h4>📴 Pas de réseau</h4><p class="muted">Cette page n’a pas encore été ouverte avec du réseau sur cet appareil. Les listes à venir, elles, sont gardées dès l’ouverture de l’app.</p></div>' });
      return;
    }
    app.innerHTML = `<div class="card error">${esc(e.message)}</div>`;
  }
}

setRenderer(() => {
  // Re-rendu sans recharger (sauf changement d'adresse) : on garde le defilement.
  const y = window.scrollY;
  const [name, arg] = S.route;
  if (!S.me) shell(loginView());
  else if (!S.me.householdId) shell(foyersView());
  else if ((name === 'catalogue' && !S.products) || (name === 'listes' && listNeedsLoad())) { route(); return; }
  else if (ROUTES[name]) shell(ROUTES[name](arg));
  window.scrollTo(0, y);
});

window.addEventListener('hashchange', () => { route().then(() => window.scrollTo(0, 0)); });
// Passage mobile <-> PC : la mise en page et l'etat des accordeons changent.
window.matchMedia('(min-width: 900px)').addEventListener('change', () => render());

on('click', 'acc', (el) => { toggleAcc(el.dataset.id, !!el.dataset.def); render(); });

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
    else if (name === 'listes') await Promise.all([loadSummary(), loadSuggestions()]);
    await loadHouse();
    if (!document.querySelector('.sheet-bg')) render();
  } catch { /* hors-ligne : on garde l'affichage */ }
}
onNetChange(() => { connectEvents(); if (S.me) render(); });
onFlushed(() => reloadView());

// Listes a venir gardees sur l'appareil a l'ouverture (magasins sans reseau).
async function prefetch() {
  if (!net.online || !S.me || !S.me.householdId) return;
  try {
    const s = await get(`h/${S.me.householdId}/lists`);
    for (const l of [s.backlog, ...s.upcoming]) await get(`h/${S.me.householdId}/lists/${l.id}`);
    await get(`h/${S.me.householdId}/products`);
  } catch { /* sans importance */ }
}

// Application installable et utilisable sans reseau (voir sw.js).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
on('click', 'go', (el) => go(el.dataset.to));

// ---------- Demarrage ----------
async function boot() {
  const params = new URLSearchParams(location.search);
  const login = params.get('login');
  if (params.get('invite')) setInvite(params.get('invite'));
  if (login || params.get('invite')) history.replaceState(null, '', location.pathname + location.hash);
  let loginError = null;
  if (login) {
    try { S.me = await post('auth/verify', { token: login }); } catch (e) { loginError = e.message; }
  }
  if (!S.me) S.me = await get('me').catch(() => null);
  await loadInvitation();
  await route();
  if (loginError && !S.me) toast(loginError, true);
  if (S.me) await acceptPending();
  flush();
  prefetch();
}
boot();
