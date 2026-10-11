// Ecran Magasins : magasins (nom, couleur, actif) et ordre des rayons de chacun ; rayons
// communs (ajout, renommage, suppression).
import { esc, on, acc, sheet, closeSheet, toast, formData } from './ui.js';
import { I, btnI } from './icons.js';
import { patch, post, put, del, attempt } from './api.js';
import { S, hp, isManager, render, loadHouse } from './state.js';

const COLORS = ['#c8313b', '#e08a12', '#2f7d4f', '#5b4bb7', '#1f6fb2', '#8a5a2b'];
const dot = (c) => `<span class="dot" style="background:${esc(c)}"></span>`;
const refresh = async () => { await loadHouse(); render(); };

export function magasinsView() {
  const H = S.house, mgr = isManager();
  const cats = Object.fromEntries(H.categories.map((c) => [c.id, c]));
  const pl = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
  // Chaque magasin a ses propres rayons (parcours) ; un rayon peut servir a plusieurs magasins.
  const order = (s) => `<div class="muted small" style="margin:8px 0 4px">Rayons dans l'ordre du parcours</div>
    ${s.categoryOrder.map((cid, i) => `<div class="ord"><span class="muted n">${i + 1}</span><span class="grow">${esc(cats[cid].name)} <span class="muted">· ${pl(cats[cid].products, 'produit')}</span></span>
      ${mgr ? `<button class="ic" title="Monter" data-a="cat-move" data-s="${s.id}" data-i="${i}" data-d="-1">${I('up', 's')}</button><button class="ic" title="Descendre" data-a="cat-move" data-s="${s.id}" data-i="${i}" data-d="1">${I('down', 's')}</button>
      <button class="ic" title="Renommer" data-a="cat-rename" data-id="${cid}">${I('edit', 's')}</button><button class="ic" title="Retirer ou supprimer" data-a="cat-x" data-s="${s.id}" data-id="${cid}">${I('x', 's')}</button>` : ''}</div>`).join('')
      || '<p class="muted small">Aucun rayon : ajoutez-en ou copiez ceux d’un autre magasin.</p>'}
    ${mgr ? `<div class="btn-row" style="margin:8px 0">${btnI('plus', 'Ajouter un rayon', `data-a="cat-add" data-s="${s.id}"`)}${H.stores.length > 1 ? btnI('repeat', 'Copier d’un autre magasin', `data-a="cat-copy" data-s="${s.id}"`) : ''}</div>` : ''}`;
  const stores = H.stores.map((s) => acc('st_' + s.id, {
    icon: dot(s.color), title: s.name + (s.active ? '' : ' (inactif)'),
    sum: s.active ? ` · ${pl(s.categoryOrder.length, 'rayon')}` : ' · masqué des listes et conseils',
    body: `${mgr ? `<button class="btn sec2 full" style="margin-top:8px" data-a="store-edit" data-id="${s.id}">${I('edit', 's')} Nom, couleur, actif / inactif</button>` : ''}${s.active ? order(s) : ''}`,
  })).join('');
  const used = new Set(H.stores.flatMap((s) => s.categoryOrder));
  const orphans = H.categories.filter((c) => !used.has(c.id));
  const n = H.stores.filter((s) => s.active).length;
  return {
    cols: true, title: 'Magasins', sub: `${n} actif${n > 1 ? 's' : ''} · chaque magasin a ses rayons, dans l'ordre du parcours`,
    body: `${stores || '<p class="muted">Aucun magasin.</p>'}
      ${orphans.length ? acc('st_orph', { icon: I('box'), title: 'Rayons sans magasin', sum: ` · ${orphans.length}`, def: true,
        body: orphans.map((c) => `<div class="ord"><span class="grow">${esc(c.name)} <span class="muted">· ${pl(c.products, 'produit')}</span></span>${mgr ? `<button class="ic" title="Supprimer" data-a="cat-del" data-id="${c.id}">${I('trash', 's')}</button>` : ''}</div>`).join('')
          + '<p class="muted small">Utilisés par aucun magasin : ajoutez-les à un magasin (« Ajouter un rayon ») ou supprimez-les.</p>' }) : ''}`,
    dock: mgr ? `<button class="addbar" data-a="store-edit">${I('plus')}<span class="grow">Nouveau magasin</span></button>` : null,
  };
}

// ---------- Magasins ----------
on('click', 'store-edit', (el) => {
  const s = el.dataset.id ? S.house.stores.find((x) => x.id === Number(el.dataset.id)) : { name: '', color: '#5b4bb7', active: true };
  sheet(`<h3>${s.id ? 'Modifier le magasin' : 'Nouveau magasin'}</h3>
    <label class="muted">Nom</label><input class="txt" name="name" value="${esc(s.name)}" placeholder="ex. Aldi Jambes">
    <div class="sec">Couleur</div><div class="swatches">${COLORS.map((c) => `<label><input type="radio" name="color" value="${c}" ${s.color === c ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div>
    ${s.id ? `<label class="row" style="margin-top:10px"><span class="grow"><b>Actif</b><span class="muted block">Inactif : masqué des conseils et listes, prix conservés</span></span><input type="checkbox" class="cb" name="active" ${s.active ? 'checked' : ''}></label>`
    : `<label class="muted" style="display:block;margin-top:10px">Rayons de départ</label><select class="txt" name="copy_from">${S.house.stores.map((x, k) => `<option value="${x.id}" ${k ? '' : 'selected'}>Comme ${esc(x.name)}</option>`).join('')}<option value="none">Aucun (ex. pharmacie : rayons à créer)</option></select>
      <p class="muted small">Modifiables ensuite : ajouter, retirer, réordonner. Prix inconnus jusqu'aux premiers relevés.</p>`}
    <div class="row end"><button class="btn" data-a="store-save" data-id="${s.id || ''}">Enregistrer</button></div>`);
});
on('click', 'store-save', async (el) => {
  const root = document.querySelector('.sheet');
  const f = formData(root);
  const color = (root.querySelector('[name=color]:checked') || {}).value;
  const body = { name: f.name, color, ...(el.dataset.id ? { active: f.active } : { copy_from: f.copy_from }) };
  const r = await attempt(() => (el.dataset.id ? patch(hp(`/stores/${el.dataset.id}`), body) : post(hp('/stores'), body)));
  if (r) { closeSheet(); toast('Magasin enregistré'); await refresh(); }
});

// ---------- Rayons ----------
on('click', 'cat-move', async (el) => {
  const s = S.house.stores.find((x) => x.id === Number(el.dataset.s));
  const o = [...s.categoryOrder], i = Number(el.dataset.i), j = i + Number(el.dataset.d);
  if (j < 0 || j >= o.length) return;
  [o[i], o[j]] = [o[j], o[i]];
  s.categoryOrder = o; render();
  const r = await attempt(() => put(hp(`/stores/${s.id}/order`), { categoryIds: o }));
  if (r) S.house.stores = r; else await refresh();
});
// Ajout d'un rayon a un magasin : un rayon existant (d'un autre magasin) ou un nouveau.
on('click', 'cat-add', (el) => {
  const s = S.house.stores.find((x) => x.id === Number(el.dataset.s));
  const others = S.house.categories.filter((c) => !s.categoryOrder.includes(c.id));
  sheet(`<h3>Rayon pour ${esc(s.name)}</h3>
    ${others.length ? `<div class="sec">Rayon existant</div><div class="opt">${others.map((c) => `<button data-a="cat-pick" data-s="${s.id}" data-id="${c.id}">${I('plus', 's')} ${esc(c.name)}</button>`).join('')}</div>` : ''}
    <div class="sec">Nouveau rayon</div><input class="txt" name="name" placeholder="ex. Médicaments" data-enter="cat-add-ok" data-s="${s.id}">
    <label class="row line" style="margin-top:8px"><input type="checkbox" class="cb" name="all"><span class="grow">Aussi dans les autres magasins</span></label>
    <p class="muted small">Ajouté en fin de parcours ; à replacer avec ↑ ↓.</p>
    <div class="row end"><button class="btn" data-a="cat-add-ok" data-s="${s.id}">Créer le rayon</button></div>`);
});
on('click', 'cat-pick', async (el) => {
  const s = S.house.stores.find((x) => x.id === Number(el.dataset.s));
  const r = await attempt(() => put(hp(`/stores/${s.id}/order`), { categoryIds: [...s.categoryOrder, Number(el.dataset.id)] }));
  if (r) { closeSheet(); toast('Rayon ajouté au magasin'); await refresh(); }
});
on('click', 'cat-add-ok', async (el) => {
  const f = formData(document.querySelector('.sheet'));
  const body = { name: f.name, ...(f.all ? {} : { store_ids: [Number(el.dataset.s)] }) };
  if (await attempt(() => post(hp('/categories'), body))) { closeSheet(); toast('Rayon ajouté'); await refresh(); }
});
// Copie des rayons d'un autre magasin : ajouter ceux qui manquent, ou reprendre son parcours.
on('click', 'cat-copy', (el) => {
  const s = S.house.stores.find((x) => x.id === Number(el.dataset.s));
  sheet(`<h3>Copier des rayons vers ${esc(s.name)}</h3><p class="muted small">« Ajouter » garde les rayons et l'ordre de ${esc(s.name)} et ajoute à la fin ceux qui lui manquent ; « Remplacer » reprend exactement les rayons et l'ordre de l'autre magasin.</p>
    <div class="group">${S.house.stores.filter((x) => x.id !== s.id).map((x) => { const add = x.categoryOrder.filter((c) => !s.categoryOrder.includes(c)).length;
      return `<div class="item"><span class="dot" style="background:${esc(x.color)}"></span><span class="grow"><b>${esc(x.name)}</b><span class="muted block">${x.categoryOrder.length} rayons · ${add} manquant${add > 1 ? 's' : ''} ici</span></span>
        <button class="btn sm sec2" data-a="cat-copy-ok" data-s="${s.id}" data-from="${x.id}" data-mode="add" ${add ? '' : 'disabled'}>Ajouter</button><button class="btn sm sec2" data-a="cat-copy-ok" data-s="${s.id}" data-from="${x.id}" data-mode="replace">Remplacer</button></div>`; }).join('')}</div>`);
});
on('click', 'cat-copy-ok', async (el) => {
  const s = S.house.stores.find((x) => x.id === Number(el.dataset.s)), from = S.house.stores.find((x) => x.id === Number(el.dataset.from));
  const ids = el.dataset.mode === 'replace' ? [...from.categoryOrder] : [...s.categoryOrder, ...from.categoryOrder.filter((c) => !s.categoryOrder.includes(c))];
  const r = await attempt(() => put(hp(`/stores/${s.id}/order`), { categoryIds: ids }));
  if (r) { closeSheet(); toast(`Rayons de ${from.name} copiés`); await refresh(); }
});
// Retirer un rayon d'un magasin (il reste ailleurs) ou le supprimer partout.
on('click', 'cat-x', (el) => {
  const s = S.house.stores.find((x) => x.id === Number(el.dataset.s)), c = S.house.categories.find((x) => x.id === Number(el.dataset.id));
  const elsewhere = S.house.stores.filter((x) => x.id !== s.id && x.categoryOrder.includes(c.id)).map((x) => x.name);
  sheet(`<h3>${esc(c.name)}</h3>
    <div class="menu-pop"><button data-a="cat-remove" data-s="${s.id}" data-id="${c.id}"><span class="ico">${I('x')}</span><span class="grow">Retirer de ${esc(s.name)}<span class="muted block">${elsewhere.length ? `Reste chez ${esc(elsewhere.join(', '))}` : 'Le rayon et ses produits restent, sans magasin'}</span></span></button>
    <button class="danger-t" data-a="cat-del" data-id="${c.id}"><span class="ico">${I('trash')}</span><span class="grow">Supprimer le rayon partout<span class="muted block">Ses produits passent dans un autre rayon</span></span></button></div>`);
});
on('click', 'cat-remove', async (el) => {
  const s = S.house.stores.find((x) => x.id === Number(el.dataset.s));
  const r = await attempt(() => put(hp(`/stores/${s.id}/order`), { categoryIds: s.categoryOrder.filter((c) => c !== Number(el.dataset.id)) }));
  if (r) { closeSheet(); toast(`Rayon retiré de ${s.name}`); await refresh(); }
});
on('click', 'cat-rename', (el) => {
  const c = S.house.categories.find((x) => x.id === Number(el.dataset.id));
  sheet(`<h3>Renommer le rayon</h3><input class="txt" name="name" value="${esc(c.name)}" data-enter="cat-rename-ok" data-id="${c.id}"><p class="muted small">Le nom change pour tous les magasins et pour les produits.</p><div class="row end"><button class="btn" data-a="cat-rename-ok" data-id="${c.id}">Enregistrer</button></div>`);
});
on('click', 'cat-rename-ok', async (el) => {
  const name = document.querySelector('.sheet [name=name]').value;
  if (await attempt(() => patch(hp(`/categories/${el.dataset.id}`), { name }))) { closeSheet(); await refresh(); }
});
on('click', 'cat-del', (el) => {
  const c = S.house.categories.find((x) => x.id === Number(el.dataset.id));
  const others = S.house.categories.filter((x) => x.id !== c.id);
  sheet(`<h3>Supprimer « ${esc(c.name)} » ?</h3>
    ${c.products ? `<p class="muted">${c.products} produit${c.products > 1 ? 's sont rangés' : ' est rangé'} dans ce rayon. Les déplacer vers :</p><select class="txt" name="moveTo">${others.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>` : '<p class="muted">Aucun produit dans ce rayon.</p>'}
    <p class="muted small">Le rayon disparaît de tous les magasins.</p>
    <div class="row end"><button class="btn sec2" data-a="close">Annuler</button><button class="btn danger" data-a="cat-del-ok" data-id="${c.id}">Supprimer</button></div>`);
});
on('click', 'cat-del-ok', async (el) => {
  const to = document.querySelector('.sheet [name=moveTo]');
  if (await attempt(() => del(hp(`/categories/${el.dataset.id}${to ? `?moveTo=${to.value}` : ''}`)))) { closeSheet(); toast('Rayon supprimé'); S.products = null; await refresh(); }
});
