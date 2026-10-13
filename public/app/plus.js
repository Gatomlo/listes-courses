// Onglet Plus (produits, magasins, promos, foyer, compte, outils), écran Promos et
// bouton ＋ d'ajout rapide (article, repas, envie, plat, promo, ticket).
import { esc, eur, fmtDate, on, sheet, closeSheet, toast, formData, localDay } from './ui.js';
import { get, post, del, attempt } from './api.js';
import { S, hp, isManager, render, go, loadProducts, activeStores, storeById } from './state.js';
import { I } from './icons.js';
import { isInstalled } from './install.js';
import { rappelsSub } from './rappels.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const row = (href, ic, title, sub, cls = '') => `<a class="item click ${cls}" href="${href}"><span class="ico">${I(ic)}</span><span class="grow"><b>${title}</b>${sub ? `<span class="muted block">${sub}</span>` : ''}</span>${I('chev', 's chev')}</a>`;
const act = (a, ic, title, sub, cls = '') => `<button class="item click ${cls}" data-a="${a}"><span class="ico ${cls.includes('leaf') ? 'leaf' : ''}">${I(ic)}</span><span class="grow"><b>${title}</b>${sub ? `<span class="muted block">${sub}</span>` : ''}</span>${I('chev', 's chev')}</button>`;

// ---------- Onglet Plus ----------
// Gestionnaire : outils du foyer + profil ; membre : son profil seulement.
export function plusView() {
  const H = S.house, me = H.members.find((m) => m.me) || { name: S.me.name };
  return {
    title: 'Plus', sub: H.household.name, large: true,
    body: `<a class="card click row" href="#/foyers"><span class="avatar">${esc((me.name || '?')[0])}</span><span class="grow"><b>${esc(S.me.name)}</b><span class="muted block">${isManager() ? 'Gestionnaire' : 'Membre'} · ${esc(H.household.name)} · changer de foyer</span></span>${I('chev', 's chev')}</a>
      ${isManager() ? `<div class="group tiles">
        ${row('#/catalogue', 'tag', 'Produits', 'Prix moyens, relevés, magasin conseillé')}
        ${row('#/magasins', 'store', 'Magasins', 'Couleurs, magasins actifs, parcours des rayons')}
        ${row('#/promos', 'flame', 'Promos', 'Promos signalées en cours')}
        ${act('history', 'clock', 'Historique des listes', 'Listes clôturées')}
        ${row('#/foyer', 'users', 'Foyer', `${H.members.length} membre${H.members.length > 1 ? 's' : ''} · réglages · tags des plats`)}
      </div>
      <div class="group tiles">
        ${act('csv-open', 'upload', 'Importer des produits', 'Fichier CSV, avec relevés de prix')}
        ${act('dish-csv-open', 'upload', 'Importer des plats', 'Fichier CSV : repas, tags, ingrédients')}
        ${row('#/menu/export', 'link', 'Export et lien d’affichage du menu', 'A4 à imprimer, page publique en lecture seule')}
      </div>` : ''}
      <div class="group tiles">
        ${act('push-open', 'bell', 'Rappels de la veille', rappelsSub())}
        ${isInstalled() ? '' : act('install', 'phone', 'Installer l’app', 'Sur l’écran d’accueil, utilisable sans réseau', 'leaf')}
        ${act('me-password', 'lock', S.me.hasPassword ? 'Changer mon mot de passe' : 'Choisir un mot de passe', '')}
        ${isManager() || !me.id ? '' : `<button class="item click danger-t" data-a="member-del" data-id="${me.id}"><span class="ico">${I('x')}</span><span class="grow"><b>Quitter le foyer</b><span class="muted block">${esc(H.household.name)}</span></span>${I('chev', 's chev')}</button>`}
        ${act('logout', 'logout', 'Se déconnecter', '', 'danger-t')}
      </div>`,
  };
}
on('click', 'history', () => { S.q.histOpen = true; go('#/listes'); setTimeout(() => document.getElementById('history')?.scrollIntoView({ behavior: 'smooth' }), 300); });

// ---------- Promos ----------
let promos = [];
export async function loadPromos() {
  [promos] = await Promise.all([get(hp('/promos')), S.products ? null : loadProducts()]);
}
export function promosView() {
  const until = (p) => (p.list_id ? `courses du ${fmtDate(p.list_date)}` : `jusqu’au ${fmtDate(p.valid_until, { day: 'numeric', month: 'short' })}`);
  return {
    title: 'Promos', back: '#/plus', sub: 'Le prix promo remplace la moyenne pour le conseil, tant qu’il est valable',
    body: `<div class="group tiles">${promos.map((p) => { const s = storeById(p.store_id) || { name: '?', color: 'var(--muted)' };
      return `<div class="item"><span class="dot" style="background:${esc(s.color)}"></span><a class="grow" style="color:inherit;text-decoration:none" href="#/catalogue/${p.product_id}"><b>${esc(p.product)}</b>
        <span class="muted block">${esc(s.name)} · ${until(p)}${p.note ? ` · ${esc(p.note)}` : ''}</span></a>
        <b class="price" style="color:var(--carrot)">${p.price_cents != null ? eur(p.price_cents) : 'promo'}</b><button class="ib" data-a="promo-x" data-id="${p.id}" aria-label="Retirer">${I('x', 's')}</button></div>`; }).join('')
      || `<div class="empty">${I('tag', 'l')}<p>Aucune promo en cours.</p></div>`}</div>`,
    dock: `<button class="btn full" data-a="promo-new">${I('tag')} Signaler une promo</button>`,
  };
}
on('click', 'promo-x', async (el) => { const r = await attempt(() => del(hp(`/promos/${el.dataset.id}`))); if (r) { promos = r; toast('Promo retirée'); render(); } });

// Nouvelle promo (tout membre) : produit, magasin, prix facultatif, fin de validite.
let pf = null;
function promoForm() {
  const n = norm(pf.q).trim();
  const ms = n ? S.products.filter((p) => norm(p.name).includes(n)).slice(0, 6) : [];
  const p = pf.pid && S.products.find((x) => x.id === pf.pid);
  sheet(`<h3>Signaler une promo</h3>
    ${p ? `<div class="item"><b class="grow">${esc(p.name)}</b><button class="btn sm sec2" data-a="pf-change">Changer</button></div>`
      : `<div class="search">${I('search')}<input class="txt" id="pf-q" placeholder="Produit…" value="${esc(pf.q)}" data-in="pf-q" autocomplete="off"></div>
        ${ms.length ? `<div class="ac">${ms.map((x) => `<button data-a="pf-pick" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>` : ''}`}
    <div class="sec">Magasin</div><div class="seg">${activeStores().map((s) => `<button class="${pf.sid === s.id ? 'on' : ''}" data-a="pf-store" data-sid="${s.id}">${esc(s.name)}</button>`).join('')}</div>
    <div class="row gap"><label class="grow"><span class="muted small">Prix promo (facultatif)</span><input class="txt" name="price" inputmode="decimal" placeholder="ex. 1,99"></label>
    <label class="grow"><span class="muted small">Jusqu’au</span><input class="txt" type="date" name="until" value="${localDay(7)}"></label></div>
    <label class="muted small" style="display:block;margin-top:8px">Note</label><input class="txt" name="note" placeholder="ex. 2e à -50 %, dépliant">
    <div class="row end"><button class="btn" data-a="pf-save" ${p ? '' : 'disabled'}>Enregistrer</button></div>`);
  if (!p) { const i = document.getElementById('pf-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
on('click', 'promo-new', async () => { if (!S.products) await loadProducts(); pf = { q: '', pid: null, sid: (activeStores()[0] || {}).id }; promoForm(); });
on('input', 'pf-q', (el) => { pf.q = el.value; promoForm(); });
on('click', 'pf-pick', (el) => { pf.pid = Number(el.dataset.id); promoForm(); });
on('click', 'pf-change', () => { pf.pid = null; promoForm(); });
on('click', 'pf-store', (el) => { pf.sid = Number(el.dataset.sid); const f = formData(document.querySelector('.sheet')); promoForm(); Object.entries(f).forEach(([k, v]) => { const x = document.querySelector(`.sheet [name=${k}]`); if (x) x.value = v; }); });
on('click', 'pf-save', async () => {
  const f = formData(document.querySelector('.sheet'));
  const r = await attempt(() => post(hp('/promos'), { product_id: pf.pid, store_id: pf.sid, price: f.price, note: f.note, valid_until: f.until }));
  if (r) { promos = r; closeSheet(); toast('Promo enregistrée · conseil recalculé'); if (S.route[0] === 'promos') render(); }
});

// ---------- Bouton ＋ : ajout rapide ----------
on('click', 'quick', () => sheet(`<h3>Ajouter</h3><p class="muted small" style="margin-top:-6px">Aussi en appui long sur l’icône de l’app.</p>
  <div class="qa">
    <button data-a="qa" data-k="article"><span class="ico leaf">${I('basket', 'l')}</span>Article</button>
    <button data-a="qa" data-k="menu"><span class="ico leaf">${I('calendar', 'l')}</span>Repas au menu</button>
    <button data-a="qa" data-k="envie"><span class="ico carrot">${I('bulb', 'l')}</span>Envie de plat</button>
    ${isManager() ? `<button data-a="qa" data-k="plat"><span class="ico plum">${I('bowl', 'l')}</span>Nouveau plat</button>` : ''}
    <button data-a="qa" data-k="promo"><span class="ico carrot">${I('tag', 'l')}</span>Promo</button>
    <button data-a="qa" data-k="ticket"><span class="ico">${I('receipt', 'l')}</span>Ticket</button>
  </div>`));
on('click', 'qa', async (el) => {
  const k = el.dataset.k;
  closeSheet();
  if (k === 'menu') go('#/menu');
  else if (k === 'promo') { if (!S.products) await loadProducts(); pf = { q: '', pid: null, sid: (activeStores()[0] || {}).id }; promoForm(); }
  else if (k === 'ticket') {
    const s = await attempt(() => get(hp('/lists')));
    const l = s && s.upcoming[0];
    sheet(`<h3>Scanner un ticket</h3><p class="muted">${l ? `Pour les courses du ${esc(fmtDate(l.date, { weekday: 'long', day: 'numeric', month: 'long' }))} : les articles du ticket y sont cochés.` : 'Les prix du ticket deviennent des relevés.'}</p>
      <div class="group">${activeStores().map((x) => `<button class="item click" data-a="scan-start" data-lid="${l ? l.id : ''}" data-sid="${x.id}"><span class="dot" style="background:${esc(x.color)}"></span><b class="grow">${esc(x.name)}</b>${I('camera')}</button>`).join('')}</div>`);
  } else go(`#/raccourci/${k}`);
});
