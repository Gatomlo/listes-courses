// Catalogue commun du foyer : liste par rayon (recherche, filtres), fiche produit
// (caracteristiques, prix moyens par magasin, releves), creation, fusion, suppression.
import { esc, eur, fmtDate, on, acc, sheet, closeSheet, confirmSheet, toast, formData, isPc, localDay } from './ui.js';
import { I, btnI } from './icons.js';
import { get, post, patch, del, attempt } from './api.js';
import { S, hp, isManager, render, go, loadProducts, loadHouse, activeStores, storeById, catName, categoryOrder } from './state.js';

const REC = { 1: 'chaque liste', 2: 'toutes les 2 listes', 3: 'toutes les 3 listes' };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const stTag = (sid) => {
  const s = storeById(sid);
  return s ? `<span class="st" style="--c:${esc(s.color)}">${esc(s.name)}</span>` : '';
};

// Prix manquant : aucun prix connu dans les magasins actifs (ou dans le magasin impose).
function noPrice(p) {
  const forced = activeStores().find((s) => s.id === p.forced_store_id);
  return forced ? !p.prices[forced.id] : !activeStores().some((s) => p.prices[s.id]);
}

// Produits d'un rayon, par sous-rayon quand le rayon en a (« Sans sous-rayon » en dernier).
// Un produit « sans sous-rayon » : son rayon en a, lui n'en a pas.
const noSub = (p) => (((S.house.categories.find((c) => c.id === p.category_id) || {}).subs || []).length > 0) && !p.subcategory_id;
function subGroups(cid, ps, row) {
  const subs = (S.house.categories.find((c) => c.id === cid) || {}).subs || [];
  if (!subs.length) return ps.map(row).join('');
  const parts = [...subs.map((sb) => [sb.name, ps.filter((p) => p.subcategory_id === sb.id)]), ['Sans sous-rayon', ps.filter((p) => !subs.some((sb) => sb.id === p.subcategory_id))]].filter(([, xs]) => xs.length);
  return parts.map(([n, xs]) => `<div class="subh">${esc(n)}<span class="n">${xs.length}</span></div>${xs.map(row).join('')}`).join('');
}
export function catalogueView() {
  const q = S.q.cat || '', f = S.q.catFilter || 'all';
  const ok = (p) => (!q || norm(p.name).includes(norm(q)))
    && (f === 'all' || (f === 'rec' && p.recurrence) || (f === 'base' && p.is_base) || (f === 'noprice' && noPrice(p)) || (f === 'nosub' && noSub(p)));
  const list = S.products.filter(ok);
  const groups = categoryOrder().map((cid) => [cid, list.filter((p) => p.category_id === cid)]).filter(([, ps]) => ps.length);
  // Une ligne par produit ; sur PC, colonnes alignees a gauche (selection, produit, emballage,
  // de base, prix par magasin, conseil) et selection multiple pour modifier en masse.
  const stores = activeStores(), mgr = isManager(), pc = isPc();
  const sel = S.q.psel || (S.q.psel = new Set());
  const pills = (p) => `${p.recurrence ? `<span class="pill p-leaf">${I('repeat', 's')} ${REC[p.recurrence]}</span>` : ''}${p.is_base && !pc ? '<span class="pill p-grey">de base</span>' : ''}${p.forced_store_id ? `<span class="pill p-plum">toujours ${esc((storeById(p.forced_store_id) || {}).name)}</span>` : ''}`;
  const box = (on, a, attrs) => (mgr && pc ? `<button class="chk sq${on ? ' on' : ''}" data-a="${a}" ${attrs} aria-label="Sélectionner">${I('check')}</button>` : '');
  const row = (p) => `<div class="item click prow${mgr && pc ? ' selectable' : ''}${sel.has(p.id) ? ' sel' : ''}" style="--n:${stores.length}" data-a="go" data-to="#/catalogue/${p.id}">${box(sel.has(p.id), 'psel', `data-id="${p.id}"`)}<div class="grow nm"><span class="t">${esc(p.name)}</span>
    <span class="mob muted small block">${esc(p.unit)}${p.contenance ? ' · ' + esc(p.contenance) : ''} · ${stores.map((s) => `${esc(s.name)} ${eur(p.prices[s.id] && p.prices[s.id].avg)}`).join(' · ')}</span>
    ${pills(p) ? `<span class="pills">${pills(p)}</span>` : ''}</div>
    <span class="pc muted small">${esc(p.unit)}${p.contenance ? ' · ' + esc(p.contenance) : ''}</span>
    <span class="pc small">${p.is_base ? I('check', 's') : ''}</span>
    ${stores.map((s) => `<span class="pc price small${p.best_store_id === s.id ? ' best' : ''}" style="--c:${esc(s.color)}">${eur(p.prices[s.id] && p.prices[s.id].avg)}</span>`).join('')}
    <span class="tag">${p.best_store_id ? stTag(p.best_store_id) : '<span class="muted small">prix ?</span>'}</span></div>`;
  const head = (cid, ps) => `<div class="item prow phead pc-only${mgr && pc ? ' selectable' : ''}" style="--n:${stores.length}">${box(ps.every((p) => sel.has(p.id)), 'psel-all', `data-cid="${cid}"`)}<span class="grow">Produit</span><span class="pc">Emballage</span><span class="pc">De base</span>${stores.map((s) => `<span class="pc">${esc(s.name)}</span>`).join('')}<span class="tag">Conseil</span></div>`;
  const opts = (list, ph) => `<option value="">${ph}</option>${list}`;
  const bulk = sel.size ? `<div class="card bulk"><b>${sel.size} sélectionné${sel.size > 1 ? 's' : ''}</b>
      <select class="txt sm" data-ch="bulk" data-k="rayon" aria-label="Rayon">${opts(catSubOptions(), 'Rayon…')}</select>
      <select class="txt sm" data-ch="bulk" data-k="is_base" aria-label="De base">${opts('<option value="1">De base : oui</option><option value="0">De base : non</option>', 'De base…')}</select>
      <select class="txt sm" data-ch="bulk" data-k="forced_store_id" aria-label="Magasin imposé">${opts(`<option value="none">Magasin : conseil (aucun imposé)</option>${stores.map((s) => `<option value="${s.id}">Toujours ${esc(s.name)}</option>`).join('')}`, 'Magasin imposé…')}</select>
      ${btnI('trash', 'Supprimer', 'data-a="bulk-del"', 'sec2 danger-t sm')}${btnI('x', 'Annuler la sélection', 'data-a="bulk-clear"', 'sec2 sm')}</div>` : '';
  return {
    cols: 'wide-cols', title: 'Produits', sub: `${S.products.length} produit${S.products.length > 1 ? 's' : ''} communs au foyer${mgr && pc ? ' · cocher pour modifier en masse' : ''}`,
    right: mgr ? '<button class="btn sm sec2" data-a="csv-open">⇪ Importer</button>' : '',
    body: `<div class="search">${I('search')}<input class="txt" id="cat-q" placeholder="Rechercher un produit…" value="${esc(q)}" data-in="cat-q"></div>
      <div class="opt">${[['all', 'Tous'], ['rec', `${I('repeat', 's')} Récurrents`], ['base', 'De base'], ['noprice', 'Prix manquant'], ['nosub', 'Sans sous-rayon']].map(([k, t]) => `<button class="${f === k ? 'on' : ''}" data-a="cat-filter" data-f="${k}">${t}</button>`).join('')}</div>
      ${bulk}
      ${groups.map(([cid, ps]) => acc('cc_' + cid, { title: catName(cid), sum: ` · ${ps.length} produit${ps.length > 1 ? 's' : ''}`, def: !!(q || f !== 'all'), body: head(cid, ps) + subGroups(cid, ps, row) })).join('')
        || `<p class="muted">Aucun produit.</p>${q ? `<button class="btn" data-a="prod-new" data-name="${esc(q)}">＋ Créer « ${esc(q)} »</button>` : ''}`}`,
    dock: `<button class="addbar" data-a="prod-new">${I('plus')}<span class="grow">Nouveau produit</span></button>`,
  };
}

// ---------- Selection multiple (PC, gestionnaire) ----------
const visible = () => { const q = S.q.cat || ''; return S.products.filter((p) => !q || norm(p.name).includes(norm(q))); };
on('click', 'psel', (el) => { const id = Number(el.dataset.id), s = S.q.psel; if (s.has(id)) s.delete(id); else s.add(id); render(); });
on('click', 'psel-all', (el) => {
  const ids = visible().filter((p) => p.category_id === Number(el.dataset.cid)).map((p) => p.id), s = S.q.psel;
  if (ids.every((id) => s.has(id))) ids.forEach((id) => s.delete(id)); else ids.forEach((id) => s.add(id));
  render();
});
on('click', 'bulk-clear', () => { S.q.psel.clear(); render(); });
on('change', 'bulk', async (el) => {
  if (!el.value) return;
  const k = el.dataset.k, v = el.value === 'none' ? null : k === 'is_base' ? el.value === '1' : k === 'rayon' ? el.value : Number(el.value);
  const n = S.q.psel.size;
  const r = await attempt(() => post(hp('/products/bulk'), { ids: [...S.q.psel], set: { [k]: v } }));
  if (r) { S.q.psel.clear(); await loadProducts(); toast(`${n} produit${n > 1 ? 's' : ''} modifié${n > 1 ? 's' : ''}`); render(); }
});
on('click', 'bulk-del', async () => {
  const n = S.q.psel.size;
  const ok = await confirmSheet({ title: `Supprimer ${n} produit${n > 1 ? 's' : ''} ?`, ok: 'Supprimer', danger: true,
    text: 'Ils sont retirés des listes en cours et des plats, leurs relevés de prix sont effacés. Ceux qui figurent dans l’historique y restent, barrés.' });
  if (!ok) return;
  const r = await attempt(() => post(hp('/products/bulk'), { ids: [...S.q.psel], delete: true }));
  if (r) { S.q.psel.clear(); await loadProducts(); toast(`${n} produit${n > 1 ? 's' : ''} supprimé${n > 1 ? 's' : ''}`); render(); }
});

on('input', 'cat-q', (el) => {
  S.q.cat = el.value;
  render();
  const i = document.getElementById('cat-q');
  i.focus(); i.setSelectionRange(i.value.length, i.value.length);
});
on('click', 'cat-filter', (el) => { S.q.catFilter = el.dataset.f; render(); });

// ---------- Creation ----------
export const unitOptions = (cur) => S.house.units.map((u) => `<option ${u === cur ? 'selected' : ''}>${esc(u)}</option>`).join('');
// Contenance : nombre + unite ; une ancienne valeur en texte libre est gardee (champ
// cache) tant qu'elle n'est pas ressaisie.
const CONT_UNITS = ['g', 'kg', 'ml', 'cl', 'L', 'pièces'];
export function contField(cur = '', dis = '') {
  const c = String(cur || '').trim();
  let m = c.match(/^(\d+(?:[.,]\d+)?)\s*(g|kg|ml|cl|l|pi[eè]ces?)$/i);
  if (!m && /^[x×]\s*\d+$/i.test(c)) m = [c, c.replace(/\D/g, ''), 'pièces'];
  const u = m ? CONT_UNITS.find((x) => x.toLowerCase() === m[2].toLowerCase().replace(/^pi[eè]ce$/, 'pièces')) || 'pièces' : 'g';
  return `<label class="muted">Contenance d'un emballage (facultatif)</label>
    <div class="row gap"><input class="txt w5 c" name="cont_n" inputmode="decimal" value="${m ? esc(m[1]) : ''}" placeholder="ex. 500" ${dis}>
    <select class="txt w6" name="cont_u" ${dis}>${CONT_UNITS.map((x) => `<option ${x === u ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
    ${!m && c ? `<input type="hidden" name="contenance" value="${esc(c)}"><p class="muted small">⚠ Ancienne valeur « ${esc(c)} » : à ressaisir en nombre + unité.</p>` : ''}`;
}
// Emballage et contenance : facultatifs, replies (details natif : les champs restent dans le formulaire).
export const packBlock = (unitHtml, contHtml, open = false) => `<details class="pack"${open ? ' open' : ''}><summary><b>Emballage et contenance</b> <span class="muted small">facultatif : pour comparer les prix et convertir les recettes</span></summary>${unitHtml}${contHtml}</details>`;
// Liste unique « Rayon » / « Rayon › Sous-rayon » (valeur « cid » ou « cid:sid »).
export const catSubOptions = (cur, curSub) => categoryOrder().map((cid) => {
  const c = S.house.categories.find((x) => x.id === cid) || { subs: [] };
  return `<option value="${cid}" ${cid === cur && !curSub ? 'selected' : ''}>${esc(catName(cid))}</option>${(c.subs || []).map((sb) => `<option value="${cid}:${sb.id}" ${sb.id === curSub ? 'selected' : ''}>${esc(catName(cid))} › ${esc(sb.name)}</option>`).join('')}`;
}).join('');
export const subName = (id) => { for (const c of S.house.categories) { const x = (c.subs || []).find((y) => y.id === id); if (x) return x.name; } return ''; };
export const catOptions = (cur) => categoryOrder().map((cid) => `<option value="${cid}" ${cid === cur ? 'selected' : ''}>${esc(catName(cid))}</option>`).join('');

on('click', 'prod-new', (el) => {
  sheet(`<h3>Nouveau produit</h3><p class="muted small">Ajouté aux produits communs du foyer.</p>
    <label class="muted">Nom</label><input class="txt" name="name" value="${esc(el.dataset.name || '')}" placeholder="ex. Beurre doux 250 g">
    <label class="muted">Rayon</label><select class="txt" name="rayon">${catSubOptions()}</select>
    ${packBlock(`<label class="muted">Emballage</label><select class="txt" name="unit">${unitOptions('paquet')}</select>`, contField())}
    <label class="row" style="margin-top:8px"><input type="checkbox" class="cb" name="is_base"><span class="grow">Ingrédient de base (sel, huile, épices…)</span></label>
    <p class="muted small">Prix inconnus jusqu'aux premiers relevés.</p>
    <div class="row end"><button class="btn" data-a="prod-create">Créer</button></div>`);
});
on('click', 'prod-create', async () => {
  const f = formData(document.querySelector('.sheet'));
  const p = await attempt(() => post(hp('/products'), f));
  if (p) { closeSheet(); await Promise.all([loadProducts(), loadHouse()]); S.q.cat = ''; toast(`${p.name} ajouté aux produits`); go(`#/catalogue/${p.id}`); }
});

// ---------- Import CSV (gestionnaire) : apercu puis import ----------
const CSV_HEAD = 'nom;rayon;emballage;contenance;magasin;prix;promo;prix normal;date';
let csvText = '';
on('click', 'csv-open', () => {
  csvText = '';
  sheet(`<h3>⇪ Importer des produits</h3>
    <p class="muted small">Fichier CSV (séparateur « ; » ou « , »), une ligne d'en-tête puis un produit par ligne :<br><code>${CSV_HEAD}</code></p>
    <p class="muted small">Seul <b>nom</b> est obligatoire. Produit déjà connu : seuls ses prix sont ajoutés. Rayon inconnu : créé. Prix : par emballage, avec le magasin ; <b>promo</b> = oui (hors moyenne) ; <b>prix normal</b> = prix hors promo s'il est connu ; date AAAA-MM-JJ ou JJ/MM/AAAA (défaut : aujourd'hui). Réimporter le même fichier ne double rien.</p>
    <button class="btn sec2 sm" data-a="csv-model">Télécharger un modèle</button>
    <label class="muted" style="display:block;margin-top:10px">Fichier</label><input class="txt" type="file" accept=".csv,text/csv,text/plain" data-ch="csv-file">
    <div id="csv-res"></div>`);
});
on('click', 'csv-model', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + CSV_HEAD + '\r\nBeurre doux;Frais;pièce;250 g;Colruyt;1,89;;;\r\nChips paprika;Épicerie;sachet;125 g;Colruyt;0,93;oui;1,39;\r\n'], { type: 'text/csv' }));
  a.download = 'modele-produits.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
const csvSummary = (r) => `<div class="card" style="margin-top:10px">
  <p><b>${r.created.length}</b> produit${r.created.length > 1 ? 's' : ''} ${r.dry ? 'à créer' : 'créé' + (r.created.length > 1 ? 's' : '')} · <b>${r.existing}</b> déjà connu${r.existing > 1 ? 's' : ''} · <b>${r.records}</b> relevé${r.records > 1 ? 's' : ''} de prix${r.skipped ? ` · ${r.skipped} déjà connu${r.skipped > 1 ? 's' : ''}` : ''}</p>
  ${r.categories.length ? `<p class="small">Nouveaux rayons : ${r.categories.map(esc).join(', ')}</p>` : ''}
  ${r.created.length ? `<p class="muted small">${r.created.map(esc).join(' · ')}</p>` : ''}
  ${r.errors.length ? `<p class="small" style="color:var(--danger)">${r.errors.length} ligne${r.errors.length > 1 ? 's' : ''} ignorée${r.errors.length > 1 ? 's' : ''} :<br>${r.errors.map((e) => `ligne ${e.line} : ${esc(e.msg)}`).join('<br>')}</p>` : ''}</div>`;
on('change', 'csv-file', async (el) => {
  const file = el.files && el.files[0];
  const box = document.getElementById('csv-res');
  if (!file) return;
  csvText = await file.text();
  const r = await attempt(() => post(hp('/products/import'), { csv: csvText, dry: true }));
  if (!r) return;
  box.innerHTML = csvSummary(r) + (r.created.length || r.records
    ? '<div class="row end" style="margin-top:10px"><button class="btn" data-a="csv-go">Importer</button></div>'
    : '<p class="muted small">Rien à importer.</p>');
});
on('click', 'csv-go', async () => {
  const r = await attempt(() => post(hp('/products/import'), { csv: csvText }));
  if (!r) return;
  await Promise.all([loadProducts(), loadHouse()]);
  render();
  document.getElementById('csv-res').innerHTML = csvSummary(r);
  toast(`${r.created.length} produit${r.created.length > 1 ? 's' : ''} importé${r.created.length > 1 ? 's' : ''}, ${r.records} relevé${r.records > 1 ? 's' : ''}`);
});

// ---------- Fiche produit ----------
let current = null; // produit affiche (avec ses releves)
export async function loadProduct(id) { current = await get(hp(`/products/${id}`)); }

const SRC = { check: 'coché en magasin', manual: 'saisie manuelle', ocr: 'ticket scanné' };

export function productView() {
  const p = current, mgr = isManager(), dis = mgr ? '' : 'disabled';
  const stores = activeStores();
  return {
    cols: true, title: p.name, sub: `${catName(p.category_id)} · prix par ${p.unit}`, back: isManager() ? '#/catalogue' : '#/listes',
    body: `${acc('p_prix', { icon: `${I('tag', 's')} `, title: 'Prix moyen', sum: ` · par ${esc(p.unit)}, ${S.house.household.avg_records} derniers relevés`, def: true,
        body: `<div class="pad">${stores.map((s) => {
          const pr = p.prices[s.id];
          return `<div class="row line">${stTag(s.id)}<span class="grow muted">${pr ? `${pr.n} relevé${pr.n > 1 ? 's' : ''} · dernier le ${fmtDate(pr.last)}` : 'aucun relevé'}</span><span class="price">${eur(pr && pr.avg)}</span>${p.best_store_id === s.id ? `<span class="pill p-leaf">${p.forced_store_id ? 'imposé' : 'conseillé'}</span>` : ''}</div>`;
        }).join('')}<p class="muted small">Moyenne hors promotions, relevés de moins de 6 mois.</p>
        ${p.promos.length ? `<div class="pills">${p.promos.map((x) => `<span class="pill p-carrot">${I('tag', 's')} ${esc((storeById(x.store_id) || {}).name || '')} ${x.price_cents != null ? eur(x.price_cents) : 'promo'} · ${x.list_id ? `courses du ${esc(fmtDate(x.list_date))}` : `jusqu'au ${esc(fmtDate(x.valid_until))}`}${x.note ? ' · ' + esc(x.note) : ''}</span>`).join('')}</div>` : ''}</div>` })}
      ${acc('p_fiche', { icon: `${I('tag', 's')} `, title: 'Caractéristiques', sum: ` · ${esc(catName(p.category_id))}, ${esc(p.unit)}${p.recurrence ? `, ${I('repeat', 's')} ` + REC[p.recurrence] : ''}`,
        body: `<div class="form" id="prod-form">
          <label class="muted">Nom</label><input class="txt" name="name" value="${esc(p.name)}" ${dis}>
          <label class="muted">Rayon</label><select class="txt" name="rayon" ${dis}>${catSubOptions(p.category_id, p.subcategory_id)}</select>
          ${packBlock(`<label class="muted">Emballage</label><select class="txt" name="unit" ${dis}>${unitOptions(p.unit)}</select>`, contField(p.contenance, dis), !!p.contenance)}
          <p class="muted small">${p.size ? `1 ${esc(p.unit)} = <b>${esc(sizeText(p.size))}</b>. ` : ''}Sert à convertir les quantités des recettes (g, ml, pièces) en emballages.</p>
          <label class="row"><span class="grow"><b>Poids d'une pièce</b><span class="muted block">Facultatif, en g (ou ml) : relie « 2 oignons » à un filet au kg</span></span><input class="txt w5 c" name="piece_qty" inputmode="decimal" value="${p.piece_qty != null ? String(p.piece_qty).replace('.', ',') : ''}" placeholder="g" ${dis}></label>
          <label class="row"><span class="grow"><b>${I('repeat', 's')} Récurrent</b><span class="muted block">Ajouté aux nouvelles listes datées</span></span><select class="txt w12" name="recurrence" ${dis}>
            <option value="">non</option>${[1, 2, 3].map((n) => `<option value="${n}" ${p.recurrence === n ? 'selected' : ''}>${REC[n]}</option>`).join('')}</select></label>
          <label class="row"><span class="grow"><b>Ingrédient de base</b><span class="muted block">Proposé « à vérifier », jamais ajouté d'office</span></span><input type="checkbox" class="cb" name="is_base" ${p.is_base ? 'checked' : ''} ${dis}></label>
          <label class="row"><span class="grow"><b>Magasin imposé</b><span class="muted block">Ignore le conseil prix (qualité, habitude)</span></span><select class="txt w12" name="forced_store_id" ${dis}>
            <option value="">aucun</option>${stores.map((s) => `<option value="${s.id}" ${p.forced_store_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
          ${mgr ? '<div class="row end"><button class="btn" data-a="prod-save">Enregistrer</button></div>' : ''}</div>` })}
      ${acc('p_hist', { icon: `${I('receipt', 's')} `, title: 'Derniers relevés', sum: ` · ${p.records.length}`,
        body: `${p.records.map((r) => `<div class="item"><span class="muted w5">${fmtDate(r.date)}</span>${stTag(r.store_id)}<span class="grow muted">${SRC[r.source]}${r.promo ? ` · ${I('tag', 's')} promo` : ''}${r.user ? ' · ' + esc(r.user) : ''}</span><span class="price">${eur(r.price_cents)}</span>${mgr ? `<button class="ic" title="Supprimer ce relevé" data-a="rec-del" data-id="${r.id}">✕</button>` : ''}</div>`).join('') || '<p class="muted">Aucun relevé.</p>'}
          <button class="btn sec2 full" style="margin:8px 0" data-a="rec-add">＋ Ajouter un relevé</button>` })}
      ${mgr ? `<div class="btn-row wide" style="margin-top:12px">${btnI('merge', 'Fusionner avec…', 'data-a="prod-merge"')}${btnI('trash', 'Supprimer', 'data-a="prod-del"', 'sec2 danger-t')}</div>` : ''}`,
  };
}

const sizeText = ({ n, u }) => (u === 'pc' ? `${n} pièce${n > 1 ? 's' : ''}` : n >= 1000 ? `${String(n / 1000).replace('.', ',')} ${u === 'g' ? 'kg' : 'L'}` : `${String(n).replace('.', ',')} ${u}`);

on('click', 'prod-save', async () => {
  const f = formData(document.getElementById('prod-form'));
  const p = await attempt(() => patch(hp(`/products/${current.id}`), f));
  if (p) { current = p; S.products = null; await loadHouse(); toast('Produit enregistré'); render(); }
});

on('click', 'rec-add', () => {
  sheet(`<h3>Nouveau relevé</h3><p class="muted">${esc(current.name)} · prix par ${esc(current.unit)}</p>
    <label class="muted">Magasin</label><select class="txt" name="store_id">${activeStores().map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
    <div class="row gap"><label class="grow"><span class="muted">Prix (€)</span><input class="txt" name="price" inputmode="decimal" placeholder="0,00"></label>
    <label class="grow"><span class="muted">Date</span><input class="txt" type="date" name="date" value="${localDay()}"></label></div>
    <label class="row" style="margin-top:8px"><input type="checkbox" class="cb" name="promo"><span class="grow">Prix en promo (exclu de la moyenne)</span></label>
    <div class="row end"><button class="btn" data-a="rec-add-ok">Enregistrer</button></div>`);
});
on('click', 'rec-add-ok', async () => {
  const f = formData(document.querySelector('.sheet'));
  const p = await attempt(() => post(hp(`/products/${current.id}/records`), { ...f, source: 'manual' }));
  if (p) { current = p; S.products = null; closeSheet(); toast(f.promo ? 'Relevé promo enregistré (hors moyenne)' : 'Relevé enregistré · moyenne recalculée'); render(); }
});
on('click', 'rec-del', async (el) => {
  if (!(await confirmSheet({ title: 'Supprimer ce relevé ?', text: 'La moyenne sera recalculée.', ok: 'Supprimer', danger: true }))) return;
  const p = await attempt(() => del(hp(`/products/${current.id}/records/${el.dataset.id}`)));
  if (p) { current = p; S.products = null; render(); }
});

on('click', 'prod-merge', async () => {
  if (!S.products) await loadProducts();
  const others = S.products.filter((x) => x.id !== current.id);
  sheet(`<h3>Fusionner « ${esc(current.name)} »</h3><p class="muted">Pour supprimer un doublon : ses relevés de prix sont transférés vers le produit choisi, puis il est supprimé.</p>
    <select class="txt" name="into">${others.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
    <div class="row end" style="margin-top:10px"><button class="btn" data-a="prod-merge-ok">Fusionner</button></div>`);
});
on('click', 'prod-merge-ok', async () => {
  const into = Number(document.querySelector('.sheet [name=into]').value);
  const name = current.name;
  const p = await attempt(() => post(hp(`/products/${current.id}/merge`), { into }));
  if (p) { current = p; S.products = null; await loadHouse(); closeSheet(); toast(`« ${name} » fusionné dans « ${p.name} »`); go(`#/catalogue/${p.id}`); }
});
on('click', 'prod-del', async () => {
  const ok = await confirmSheet({ title: `Supprimer « ${current.name} » ?`, text: 'Il est retiré des listes en cours et ses relevés de prix sont supprimés. Les listes clôturées gardent son nom, barré.', ok: 'Supprimer', danger: true });
  if (!ok) return;
  if (await attempt(() => del(hp(`/products/${current.id}`)))) { S.products = null; await loadHouse(); toast('Produit supprimé'); go('#/catalogue'); }
});
