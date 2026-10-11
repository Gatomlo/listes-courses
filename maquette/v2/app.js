// Le Cabas · maquette v2 : cadre (navigation par pile, onglets, panneaux, toasts, icônes).
const PATHS = {
  basket: 'M3 9h18l-1.6 9.2a2 2 0 0 1-2 1.8H6.6a2 2 0 0 1-2-1.8L3 9zM8 9l3-5M16 9l-3-5M9 13v3M15 13v3',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  bowl: 'M3 11h18a9 9 0 0 1-18 0zM9 7c0-2 2-2 2-4M14 7c0-2 2-2 2-4',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
  back: 'M15 5l-7 7 7 7', chev: 'M9 5l7 7-7 7', down: 'M6 9l6 6 6-6', up: 'M6 15l6-6 6 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  check: 'M5 12.5l4.5 4.5L19 7', x: 'M6 6l12 12M18 6L6 18',
  store: 'M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M10 20v-5h4v5',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 7.5h.01',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-5-6.7',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  wifioff: 'M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18',
  share: 'M12 3v12M7 8l5-5 5 5M5 13v7h14v-7',
  doc: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  move: 'M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  book: 'M4 19V5a2 2 0 0 1 2-2h13v14H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h13v-4',
  puzzle: 'M10 4a2 2 0 1 1 4 0v2h4v4h-2a2 2 0 1 0 0 4h2v4h-4v-2a2 2 0 1 0-4 0v2H6v-4h2a2 2 0 1 0 0-4H6V6h4z',
  cart: 'M3 4h2l2.5 11h11L21 7H6.2M9 20h.01M18 20h.01',
  receipt: 'M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21zM9 8h6M9 12h6M9 16h4',
  repeat: 'M4 11a8 8 0 0 1 13.7-4.7L20 9M20 4v5h-5M20 13a8 8 0 0 1-13.7 4.7L4 15M4 20v-5h5',
  note: 'M5 4h14v11l-5 5H5zM14 20v-5h5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  phone: 'M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  ban: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  merge: 'M6 3v6a6 6 0 0 0 6 6h0a6 6 0 0 1 6 6M18 3v6M6 21v-6',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  people: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  arrowR: 'M5 12h14M13 6l6 6-6 6',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  flame: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z',
};
const I = (n, c = '') => `<svg class="i ${c}" viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[n]}"${n === 'more' || n === 'grip' ? ' stroke-width="3"' : ''}/></svg>`;
const sp = (st, label) => `<span class="sp" style="--c:${STORES[st].c};--cs:${STORES[st].cs}">${label ?? STORES[st].n}</span>`;
const dotS = (st) => `<span class="dot" style="--c:${STORES[st].c}"></span>`;
const avatar = (m, s = '') => `<span class="avatar ${s}" style="--c:${m.c}">${m.n[0]}</span>`;
const member = (n) => MEMBERS.find((m) => m.n === n) || MEMBERS[0];
const plural = (n, w, ws = w + 's') => `${n} ${n > 1 ? ws : w}`;

// ---------- Etat ----------
const S = { role: 'manager', online: true, queue: 0, format: 'phone', stack: [{ v: 'home' }], tab: 'home', q: {} };
const isM = () => S.role === 'manager';
const topV = () => S.stack[S.stack.length - 1];
const A = {}, IN = {}, CH = {}, VIEWS = {};
const TABS = [['home', 'Courses', 'basket'], ['menu', 'Menu', 'calendar'], ['fab'], ['dishes', 'Plats', 'bowl'], ['more', 'Plus', 'grid']];
const badge = { home: () => LISTS.reduce((n, l) => n + l.items.filter((i) => i.sugg).length, 0), menu: () => WISHES.filter((w) => w.status === 'pending').length + MEALS.filter((m) => m.sugg).length };

function go(v, params = {}) { S.stack.push({ v, ...params }); render('f'); }
function back() { if (S.stack.length > 1) { S.stack.pop(); render('b'); } }
function tab(t) { S.tab = t; S.stack = [{ v: t }]; render('f'); }
function replace(v, params = {}) { S.stack[S.stack.length - 1] = { v, ...params }; render(); }

const $ = (id) => document.getElementById(id);
function render(dir) {
  const t = topV(), v = VIEWS[t.v](t);
  const view = $('view'), prev = $('scroll');
  const keep = !dir && prev && prev.dataset.v === t.v ? prev.scrollTop : 0;
  const sub = S.stack.length > 1;
  view.innerHTML = `<header class="bar${sub ? ' sub' : ''}" id="bar">
      <div class="side">${sub ? `<button class="ib" data-a="back" aria-label="Retour">${I('back')}</button>` : ''}</div>
      <div class="t">${v.title}</div><div class="side r">${v.actions || ''}</div></header>
    <div class="scroll${dir ? ' anim-' + dir : ''}${v.cls ? ' ' + v.cls : ''}" id="scroll" data-v="${t.v}">
      ${v.large ? `<h1 class="ltitle">${v.title}</h1>${v.sub ? `<p class="lsub root">${v.sub}</p>` : ''}` : v.sub ? `<p class="lsub">${v.sub}</p>` : ''}
      ${!S.online ? `<div class="banner off">${I('wifioff')}<span class="grow">Hors-ligne${S.queue ? ` · ${plural(S.queue, 'modification')} en attente` : ''}</span><span class="xs">envoi au retour du réseau</span></div>` : ''}
      ${v.body}</div>
    ${v.dock ? `<div class="dock">${v.dock}</div>` : ''}`;
  $('nav').innerHTML = navHtml();
  $('nav').hidden = !!v.noTabs;
  const sc = $('scroll');
  sc.scrollTop = keep;
  const bar = $('bar');
  const onS = () => bar.classList.toggle('scrolled', sc.scrollTop > 30);
  sc.addEventListener('scroll', onS, { passive: true });
  onS();
  panelHtml();
}
function navHtml() {
  return `<div class="brand"><span class="logo">${I('basket')}</span>Le Cabas</div>
    <button class="hh" data-a="house-switch">${avatar({ n: 'F', c: 'var(--accent)' }, 's')}<span class="grow ellip">${HOUSE.name}</span>${I('down', 's')}</button>
    ${TABS.map(([k, n, ic]) => (k === 'fab' ? `<button class="fab" data-a="quick" aria-label="Ajouter">${I('plus', 'l')}<span>Ajouter</span></button>`
      : `<button class="tab${S.tab === k ? ' on' : ''}" data-a="tab" data-t="${k}">${I(ic, 'l')}<span>${n}</span>${badge[k] && badge[k]() ? `<span class="bd">${badge[k]()}</span>` : ''}</button>`)).join('')}`;
}

// ---------- Panneaux et toasts ----------
let sheetFn = null;
function sheet(html, o = {}) {
  const old = document.querySelector('.sheet'), y = o.keep && old ? old.scrollTop : 0;
  $('layer').innerHTML = `<div class="scrim" data-a="close"></div><div class="sheet${o.full ? ' full' : ''}${o.keep ? ' noanim' : ''}" role="dialog" aria-modal="true">
    <div class="grab"></div><button class="ib x" data-a="close" aria-label="Fermer">${I('x')}</button>${html}</div>`;
  document.querySelector('.sheet').scrollTop = y;
}
// Panneau redessine a chaque changement (fn renvoie le HTML).
function live(fn, o = {}) { sheetFn = () => sheet(fn(), { ...o, keep: true }); sheet(fn(), o); }
const refresh = () => sheetFn && sheetFn();
function closeSheet() { $('layer').innerHTML = ''; sheetFn = null; }
let toastT;
function toast(msg, undo) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span>${msg}</span>${undo ? '<button data-a="undo">Annuler</button>' : ''}`;
  $('layer').appendChild(t);
  A.undo = () => { t.remove(); undo && undo(); };
  clearTimeout(toastT);
  toastT = setTimeout(() => t.remove(), 2800);
}
function confirmSheet(title, text, ok, fn, danger = true) {
  sheet(`<h3>${title}</h3><p class="lead">${text}</p><div class="foot"><button class="btn sec" data-a="close">Annuler</button><button class="btn ${danger ? 'danger' : ''}" data-a="confirm-ok">${ok}</button></div>`);
  A['confirm-ok'] = () => { closeSheet(); fn(); };
}
// Hors-ligne : seules les actions du mode courses passent (file d'operations).
function needNet() { if (S.online) return true; toast('Pas de réseau : disponible au retour de la connexion'); return false; }
function queued() { if (!S.online) { S.queue++; } }

// ---------- Delegation ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const fn = A[el.dataset.a];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('input', (e) => { const el = e.target.closest('[data-in]'); if (el && IN[el.dataset.in]) IN[el.dataset.in](el); });
document.addEventListener('change', (e) => { const el = e.target.closest('[data-ch]'); if (el && CH[el.dataset.ch]) CH[el.dataset.ch](el); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
  const el = e.target.closest('[data-enter]');
  if (e.key === 'Enter' && el && A[el.dataset.enter]) { e.preventDefault(); A[el.dataset.enter](el); }
});
A.back = back;
A.close = closeSheet;
A.tab = (el) => tab(el.dataset.t);
A.go = (el) => { closeSheet(); go(el.dataset.v, { ...el.dataset, v: el.dataset.v }); };
A.noop = () => toast('Dans l’app : action réelle');

// ---------- Panneau de maquette ----------
const JUMPS = [
  ['Accueil courses', () => tab('home')], ['Liste en cours', () => { tab('home'); go('list', { id: 'l13' }); }],
  ['Mode courses', () => { tab('home'); go('list', { id: 'l13' }); go('shop', { id: 'l13', st: 'co' }); }],
  ['Scan du ticket', () => { tab('home'); go('scan', { id: 'l13', st: 'co' }); }],
  ['Menu', () => tab('menu')], ['Fiche repas (Mezze)', () => { tab('menu'); A['meal-open']({ dataset: { id: MEALS.find((m) => m.dish === 'mez').id } }); }],
  ['Plats', () => tab('dishes')], ['Plat composé', () => { tab('dishes'); go('dish', { id: 'mez' }); }], ['Plat à variantes', () => { tab('dishes'); go('dish', { id: 'sto' }); }],
  ['Mode cuisine', () => { tab('dishes'); go('cook', { id: 'mez', p: 8 }); }],
  ['Produits', () => { tab('more'); go('products'); }], ['Fiche produit', () => { tab('more'); go('products'); go('product', { id: 'poi' }); }],
  ['Magasins', () => { tab('more'); go('stores'); }], ['Foyer', () => { tab('more'); go('house'); }], ['Promos', () => { tab('more'); go('promos'); }],
  ['Connexion', () => go('auth', { k: 'login' })], ['Premier compte', () => go('auth', { k: 'setup' })], ['Invitation', () => go('auth', { k: 'invite' })],
  ['Mot de passe oublié', () => go('auth', { k: 'reset' })], ['Affichage public', () => go('display')], ['Export A4', () => { tab('menu'); go('export'); }],
];
function panelHtml() {
  const seg = (k, opts) => `<div class="pseg">${opts.map(([v, t]) => `<button class="${S[k] === v ? 'on' : ''}" data-a="demo" data-k="${k}" data-v="${v}">${t}</button>`).join('')}</div>`;
  $('panel').innerHTML = `<h1>Le Cabas</h1><p>Maquette v2 : interface refondue, pensée d’abord pour le téléphone. Toutes les fonctions de l’app, données d’exemple.</p>
    <h3>Rôle simulé</h3>${seg('role', [['manager', 'Gestionnaire'], ['member', 'Membre']])}
    <h3>Réseau</h3>${seg('online', [[true, 'En ligne'], [false, 'Hors-ligne']])}
    <h3>Format</h3>${seg('format', [['phone', 'Téléphone'], ['pc', 'PC']])}
    <h3>Thème</h3>${seg('theme', [['auto', 'Système'], ['light', 'Clair'], ['dark', 'Sombre']])}
    <h3>Aller à</h3><div class="jump">${JUMPS.map(([t], k) => `<button data-a="jump" data-k="${k}">${t}</button>`).join('')}</div>
    <h3>Ce qui change</h3><ul>
      <li>4 onglets + bouton ＋ central : article, envie, plat, promo, ticket.</li>
      <li>Accueil « Courses » : la liste du moment, son conseil de magasin et sa progression d’un coup d’œil.</li>
      <li>Liste : barre d’ajout en bas, filtre par magasin collant, caddie replié, suggestions en ligne.</li>
      <li>Panneaux qui montent du bas (dialogues sur PC), titres qui se replient au défilement.</li>
      <li>Menu en agenda (téléphone) ou grille semaine (PC), envies en carrousel.</li>
      <li>Plats en mosaïque ; fiche à onglets Ingrédients / Recette / Composition / Historique ; mode cuisine plein écran.</li>
      <li>Icônes dessinées à la place des émojis, une seule couleur d’action, magasins repérés par leur couleur.</li>
    </ul>`;
  S.theme = S.theme || 'auto';
}
A.jump = (el) => { closeSheet(); $('panel').classList.remove('open'); JUMPS[Number(el.dataset.k)][1](); };
A.demo = (el) => {
  const k = el.dataset.k; let v = el.dataset.v;
  if (k === 'online') { v = v === 'true'; if (v) { if (S.queue) toast(`${plural(S.queue, 'modification')} envoyée${S.queue > 1 ? 's' : ''}`); S.queue = 0; } }
  S[k] = v;
  if (k === 'theme') { if (v === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = v; }
  if (k === 'format') $('device').classList.toggle('pc', v === 'pc');
  if (k === 'role') toast(v === 'manager' ? 'Vous êtes gestionnaire du foyer' : 'Vous êtes membre : ajouts en suggestion');
  render();
};
A['demo-panel'] = () => $('panel').classList.toggle('open');
A['house-switch'] = () => sheet(`<h3>Foyers</h3><p class="lead">Un compte peut appartenir à plusieurs foyers.</p>
  <div class="group">${HOUSES.map((h, k) => `<button class="row tap" data-a="close">${avatar({ n: h.name, c: k ? 'var(--plum)' : 'var(--accent)' })}<span class="grow"><b>${h.name}</b><span class="sub" style="display:block">${h.role}</span></span>${k ? '' : `<span class="pill acc">${I('check', 's')} actif</span>`}</button>`).join('')}</div>
  <div class="foot"><button class="btn sec" data-a="noop">${I('plus')} Nouveau foyer</button></div>`);
