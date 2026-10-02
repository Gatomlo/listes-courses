// Catalogue commun du foyer : liste par rayon (recherche, filtres), fiche produit
// (caracteristiques, prix moyens par magasin, releves), creation, fusion, suppression.
import { esc, eur, fmtDate, on, acc, sheet, closeSheet, confirmSheet, toast, formData } from './ui.js';
import { get, post, patch, del, attempt } from './api.js';
import { S, hp, isManager, render, go, loadProducts, loadHouse, activeStores, storeById, catName, categoryOrder } from './state.js';

const REC = { 1: 'chaque liste', 2: 'toutes les 2 listes', 3: 'toutes les 3 listes' };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const stTag = (sid) => {
  const s = storeById(sid);
  return s ? `<span class="st" style="--c:${esc(s.color)}">${esc(s.name)}</span>` : '';
};

export function catalogueView() {
  const q = S.q.cat || '', f = S.q.catFilter || 'all';
  const ok = (p) => (!q || norm(p.name).includes(norm(q)))
    && (f === 'all' || (f === 'rec' && p.recurrence) || (f === 'base' && p.is_base) || (f === 'noprice' && activeStores().some((s) => !p.prices[s.id])));
  const list = S.products.filter(ok);
  const groups = categoryOrder().map((cid) => [cid, list.filter((p) => p.category_id === cid)]).filter(([, ps]) => ps.length);
  const row = (p) => `<div class="item click" data-a="go" data-to="#/catalogue/${p.id}"><div class="grow"><div class="nm">${esc(p.name)}</div>
    <div class="muted">${esc(p.unit)}${p.contenance ? ' · ' + esc(p.contenance) : ''} · ${activeStores().map((s) => `${esc(s.name)} ${eur(p.prices[s.id] && p.prices[s.id].avg)}`).join(' · ')}</div>
    <div class="pills">${p.recurrence ? `<span class="pill p-leaf">🔁 ${REC[p.recurrence]}</span>` : ''}${p.is_base ? '<span class="pill p-grey">de base</span>' : ''}${p.forced_store_id ? `<span class="pill p-plum">toujours ${esc((storeById(p.forced_store_id) || {}).name)}</span>` : ''}</div></div>
    ${p.best_store_id ? stTag(p.best_store_id) : '<span class="muted small">prix ?</span>'}</div>`;
  return {
    cols: true, title: 'Catalogue', sub: `${S.products.length} produit${S.products.length > 1 ? 's' : ''} communs au foyer`,
    right: isManager() ? '<button class="btn sm sec2" data-a="csv-open">⇪ Importer</button>' : '',
    body: `<input class="txt" id="cat-q" placeholder="🔍 Rechercher un produit…" value="${esc(q)}" data-in="cat-q">
      <div class="opt">${[['all', 'Tous'], ['rec', '🔁 Récurrents'], ['base', 'De base'], ['noprice', 'Prix manquant']].map(([k, t]) => `<button class="${f === k ? 'on' : ''}" data-a="cat-filter" data-f="${k}">${t}</button>`).join('')}</div>
      ${groups.map(([cid, ps]) => acc('cc_' + cid, { title: catName(cid), sum: ` · ${ps.length} produit${ps.length > 1 ? 's' : ''}`, def: !!(q || f !== 'all'), body: ps.map(row).join('') })).join('')
        || `<p class="muted">Aucun produit.</p>${q ? `<button class="btn" data-a="prod-new" data-name="${esc(q)}">＋ Créer « ${esc(q)} »</button>` : ''}`}
      <button class="fab" data-a="prod-new" title="Nouveau produit">＋</button>`,
  };
}

on('input', 'cat-q', (el) => {
  S.q.cat = el.value;
  render();
  const i = document.getElementById('cat-q');
  i.focus(); i.setSelectionRange(i.value.length, i.value.length);
});
on('click', 'cat-filter', (el) => { S.q.catFilter = el.dataset.f; render(); });

// ---------- Creation ----------
export const unitOptions = (cur) => S.house.units.map((u) => `<option ${u === cur ? 'selected' : ''}>${esc(u)}</option>`).join('');
export const catOptions = (cur) => categoryOrder().map((cid) => `<option value="${cid}" ${cid === cur ? 'selected' : ''}>${esc(catName(cid))}</option>`).join('');

on('click', 'prod-new', (el) => {
  sheet(`<h3>Nouveau produit</h3><p class="muted small">Ajouté au catalogue commun du foyer.</p>
    <label class="muted">Nom</label><input class="txt" name="name" value="${esc(el.dataset.name || '')}" placeholder="ex. Beurre doux 250 g">
    <div class="row gap"><label class="grow"><span class="muted">Rayon</span><select class="txt" name="category_id">${catOptions()}</select></label>
    <label class="grow"><span class="muted">Emballage</span><select class="txt" name="unit">${unitOptions('paquet')}</select></label></div>
    <label class="row" style="margin-top:8px"><input type="checkbox" class="cb" name="is_base"><span class="grow">Ingrédient de base (sel, huile, épices…)</span></label>
    <p class="muted small">Prix inconnus jusqu'aux premiers relevés.</p>
    <div class="row end"><button class="btn" data-a="prod-create">Créer</button></div>`);
});
on('click', 'prod-create', async () => {
  const f = formData(document.querySelector('.sheet'));
  const p = await attempt(() => post(hp('/products'), f));
  if (p) { closeSheet(); await Promise.all([loadProducts(), loadHouse()]); S.q.cat = ''; toast(`${p.name} ajouté au catalogue`); go(`#/catalogue/${p.id}`); }
});

// ---------- Import CSV (gestionnaire) : apercu puis import ----------
const CSV_HEAD = 'nom;rayon;emballage;contenance;magasin;prix;promo;prix normal;date';
let csvText = '';
on('click', 'csv-open', () => {
  csvText = '';
  sheet(`<h3>⇪ Importer des produits</h3>
    <p class="muted small">Fichier CSV (séparateur « ; » ou « , »), une ligne d'en-tête puis un produit par ligne :<br><code>${CSV_HEAD}</code></p>
    <p class="muted small">Seul <b>nom</b> est obligatoire. Produit déjà au catalogue : seuls ses prix sont ajoutés. Rayon inconnu : créé. Prix : par emballage, avec le magasin ; <b>promo</b> = oui (hors moyenne) ; <b>prix normal</b> = prix hors promo s'il est connu ; date AAAA-MM-JJ ou JJ/MM/AAAA (défaut : aujourd'hui). Réimporter le même fichier ne double rien.</p>
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
  <p><b>${r.created.length}</b> produit${r.created.length > 1 ? 's' : ''} ${r.dry ? 'à créer' : 'créé' + (r.created.length > 1 ? 's' : '')} · <b>${r.existing}</b> déjà au catalogue · <b>${r.records}</b> relevé${r.records > 1 ? 's' : ''} de prix${r.skipped ? ` · ${r.skipped} déjà connu${r.skipped > 1 ? 's' : ''}` : ''}</p>
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
    cols: true, title: p.name, sub: `${catName(p.category_id)} · prix par ${p.unit}`, back: '#/catalogue',
    body: `${acc('p_prix', { icon: '💶', title: 'Prix moyen', sum: ` · par ${esc(p.unit)}, ${S.house.household.avg_records} derniers relevés`, def: true,
        body: `<div class="pad">${stores.map((s) => {
          const pr = p.prices[s.id];
          return `<div class="row line">${stTag(s.id)}<span class="grow muted">${pr ? `${pr.n} relevé${pr.n > 1 ? 's' : ''} · dernier le ${fmtDate(pr.last)}` : 'aucun relevé'}</span><span class="price">${eur(pr && pr.avg)}</span>${p.best_store_id === s.id ? `<span class="pill p-leaf">${p.forced_store_id ? 'imposé' : 'conseillé'}</span>` : ''}</div>`;
        }).join('')}<p class="muted small">Moyenne hors promotions, relevés de moins de 6 mois.</p>
        ${p.promos.length ? `<div class="pills">${p.promos.map((x) => `<span class="pill p-carrot">🏷 ${esc((storeById(x.store_id) || {}).name || '')} ${x.price_cents != null ? eur(x.price_cents) : 'promo'} · ${x.list_id ? `courses du ${esc(fmtDate(x.list_date))}` : `jusqu'au ${esc(fmtDate(x.valid_until))}`}${x.note ? ' · ' + esc(x.note) : ''}</span>`).join('')}</div>` : ''}</div>` })}
      ${acc('p_fiche', { icon: '🏷', title: 'Caractéristiques', sum: ` · ${esc(catName(p.category_id))}, ${esc(p.unit)}${p.recurrence ? ', 🔁 ' + REC[p.recurrence] : ''}`,
        body: `<div class="form" id="prod-form">
          <label class="muted">Nom</label><input class="txt" name="name" value="${esc(p.name)}" ${dis}>
          <div class="row gap"><label class="grow"><span class="muted">Rayon</span><select class="txt" name="category_id" ${dis}>${catOptions(p.category_id)}</select></label>
          <label class="grow"><span class="muted">Emballage</span><select class="txt" name="unit" ${dis}>${unitOptions(p.unit)}</select></label></div>
          <label class="muted">Contenance (facultatif)</label><input class="txt" name="contenance" value="${esc(p.contenance || '')}" placeholder="ex. 1 L, 500 g, x12" ${dis}>
          <p class="muted small">Les prix se comparent par emballage ; la contenance signale un emballage différent d'un magasin à l'autre.</p>
          <label class="row"><span class="grow"><b>🔁 Récurrent</b><span class="muted block">Ajouté aux nouvelles listes datées</span></span><select class="txt w12" name="recurrence" ${dis}>
            <option value="">non</option>${[1, 2, 3].map((n) => `<option value="${n}" ${p.recurrence === n ? 'selected' : ''}>${REC[n]}</option>`).join('')}</select></label>
          <label class="row"><span class="grow"><b>Ingrédient de base</b><span class="muted block">Proposé « à vérifier », jamais ajouté d'office</span></span><input type="checkbox" class="cb" name="is_base" ${p.is_base ? 'checked' : ''} ${dis}></label>
          <label class="row"><span class="grow"><b>Magasin imposé</b><span class="muted block">Ignore le conseil prix (qualité, habitude)</span></span><select class="txt w12" name="forced_store_id" ${dis}>
            <option value="">aucun</option>${stores.map((s) => `<option value="${s.id}" ${p.forced_store_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
          ${mgr ? '<div class="row end"><button class="btn" data-a="prod-save">Enregistrer</button></div>' : ''}</div>` })}
      ${acc('p_hist', { icon: '🧾', title: 'Derniers relevés', sum: ` · ${p.records.length}`,
        body: `${p.records.map((r) => `<div class="item"><span class="muted w5">${fmtDate(r.date)}</span>${stTag(r.store_id)}<span class="grow muted">${SRC[r.source]}${r.promo ? ' · 🏷 promo' : ''}${r.user ? ' · ' + esc(r.user) : ''}</span><span class="price">${eur(r.price_cents)}</span>${mgr ? `<button class="ic" title="Supprimer ce relevé" data-a="rec-del" data-id="${r.id}">✕</button>` : ''}</div>`).join('') || '<p class="muted">Aucun relevé.</p>'}
          <button class="btn sec2 full" style="margin:8px 0" data-a="rec-add">＋ Ajouter un relevé</button>` })}
      ${mgr ? `<div class="row end wide"><button class="btn sec2" data-a="prod-merge">⇄ Fusionner avec…</button><button class="btn sec2 danger-t" data-a="prod-del">Supprimer</button></div>` : ''}`,
  };
}

on('click', 'prod-save', async () => {
  const f = formData(document.getElementById('prod-form'));
  const p = await attempt(() => patch(hp(`/products/${current.id}`), f));
  if (p) { current = p; S.products = null; await loadHouse(); toast('Produit enregistré'); render(); }
});

on('click', 'rec-add', () => {
  sheet(`<h3>Nouveau relevé</h3><p class="muted">${esc(current.name)} · prix par ${esc(current.unit)}</p>
    <label class="muted">Magasin</label><select class="txt" name="store_id">${activeStores().map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
    <div class="row gap"><label class="grow"><span class="muted">Prix (€)</span><input class="txt" name="price" inputmode="decimal" placeholder="0,00"></label>
    <label class="grow"><span class="muted">Date</span><input class="txt" type="date" name="date" value="${new Date().toISOString().slice(0, 10)}"></label></div>
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
