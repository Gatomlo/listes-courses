// Recherche globale (loupe de l'en-tete) : produits, plats (nom, tags, ingredients) et listes.
import { esc, fmtDate, on, topSheet, closeSheet } from './ui.js';
import { get } from './api.js';
import { S, hp, loadProducts } from './state.js';
import { loadDishes } from './plats.js';
import { I } from './icons.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
let lists = [];

function results(q) {
  const n = norm(q);
  if (!n) return '<p class="muted small" style="padding:6px 4px">Produits, plats, ingrédients et listes.</p>';
  const prods = (S.products || []).filter((p) => norm(p.name).includes(n)).slice(0, 6);
  const dishes = (S.dishes || []).filter((d) => norm(d.name).includes(n) || (d.tags || []).some((t) => norm(t).includes(n)) || (d.ingredient_names || []).some((x) => norm(x).includes(n))).slice(0, 8);
  const ls = lists.filter((l) => norm(l.type === 'backlog' ? 'à prévoir' : `courses du ${fmtDate(l.date, { weekday: 'long', day: 'numeric', month: 'long' })}`).includes(n)).slice(0, 4);
  const row = (href, ic, t, sub) => `<a class="item click" href="${href}"><span class="ico">${I(ic)}</span><span class="grow"><b>${esc(t)}</b>${sub ? `<span class="muted block small">${esc(sub)}</span>` : ''}</span>${I('chev', 's chev')}</a>`;
  const sec = (t, rows) => (rows.length ? `<div class="sec">${t}</div><div class="group">${rows.join('')}</div>` : '');
  const html = sec('Produits', prods.map((p) => row(`#/catalogue/${p.id}`, 'tag', p.name, (S.house.categories.find((c) => c.id === p.category_id) || {}).name)))
    + sec('Plats', dishes.map((d) => { const hit = !norm(d.name).includes(n) && (d.ingredient_names || []).filter((x) => norm(x).includes(n)); return row(`#/plats/${d.id}`, 'bowl', d.name, hit && hit.length ? `contient ${hit.join(', ')}` : ''); }))
    + sec('Listes', ls.map((l) => row(`#/listes/${l.id}`, 'basket', l.type === 'backlog' ? 'À prévoir' : `Courses du ${fmtDate(l.date, { weekday: 'long', day: 'numeric', month: 'long' })}`, l.status === 'closed' ? 'clôturée' : '')));
  return html || '<p class="muted" style="padding:6px 4px">Rien trouvé.</p>';
}
on('click', 'gsearch', async () => {
  topSheet(`<div class="search" style="margin:0 40px 8px 0">${I('search')}<input class="txt" id="gs-q" placeholder="Rechercher partout…" data-in="gs-q" autocomplete="off"></div><div id="gs-res">${results('')}</div>`);
  document.getElementById('gs-q').focus();
  try {
    await Promise.all([S.products ? null : loadProducts(), S.dishes ? null : loadDishes(),
      get(hp('/lists')).then((s) => { lists = [s.backlog, ...s.upcoming, ...s.closed].filter(Boolean); })]);
  } catch { /* hors-ligne : ce qui est deja charge */ }
  const i = document.getElementById('gs-q'); if (i && i.value) document.getElementById('gs-res').innerHTML = results(i.value);
});
on('input', 'gs-q', (el) => { const r = document.getElementById('gs-res'); if (r) r.innerHTML = results(el.value); });
// Un lien du resultat ferme le panneau (hashchange).
export const closeSearch = closeSheet;
