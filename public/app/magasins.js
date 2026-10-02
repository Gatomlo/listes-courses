// Ecran Magasins : magasins (nom, couleur, actif) et ordre des rayons de chacun ; rayons
// communs (ajout, renommage, suppression).
import { esc, on, acc, sheet, closeSheet, toast, formData } from './ui.js';
import { patch, post, put, del, attempt } from './api.js';
import { S, hp, isManager, render, loadHouse } from './state.js';

const COLORS = ['#c8313b', '#e08a12', '#2f7d4f', '#5b4bb7', '#1f6fb2', '#8a5a2b'];
const dot = (c) => `<span class="dot" style="background:${esc(c)}"></span>`;
const refresh = async () => { await loadHouse(); render(); };

export function magasinsView() {
  const H = S.house, mgr = isManager();
  const cats = Object.fromEntries(H.categories.map((c) => [c.id, c]));
  const order = (s) => `<div class="muted small" style="margin:8px 0 4px">Rayons dans l'ordre du parcours</div>
    ${s.categoryOrder.map((cid, i) => `<div class="ord"><span class="muted n">${i + 1}</span><span class="grow">${esc(cats[cid].name)} <span class="muted">· ${cats[cid].products} produit${cats[cid].products > 1 ? 's' : ''}</span></span>
      ${mgr ? `<button class="ic" title="Monter" data-a="cat-move" data-s="${s.id}" data-i="${i}" data-d="-1">↑</button><button class="ic" title="Descendre" data-a="cat-move" data-s="${s.id}" data-i="${i}" data-d="1">↓</button>
      <button class="ic" title="Renommer" data-a="cat-rename" data-id="${cid}">✎</button><button class="ic" title="Supprimer" data-a="cat-del" data-id="${cid}">✕</button>` : ''}</div>`).join('')}
    ${mgr ? '<button class="btn sec2 full" style="margin:8px 0" data-a="cat-add">＋ Ajouter un rayon</button>' : ''}`;
  const stores = H.stores.map((s) => acc('st_' + s.id, {
    icon: dot(s.color), title: s.name + (s.active ? '' : ' (inactif)'),
    sum: s.active ? ` · ${H.categories.length} rayons` : ' · masqué des listes et conseils',
    body: `${mgr ? `<button class="btn sec2 full" style="margin-top:8px" data-a="store-edit" data-id="${s.id}">✎ Nom, couleur, actif / inactif</button>` : ''}${s.active ? order(s) : ''}`,
  })).join('');
  const n = H.stores.filter((s) => s.active).length;
  return {
    cols: true, title: 'Magasins', sub: `${n} actif${n > 1 ? 's' : ''} · rayons dans l'ordre du parcours`,
    body: `${stores || '<p class="muted">Aucun magasin.</p>'}
      ${mgr ? '<button class="fab" data-a="store-edit" title="Nouveau magasin">＋</button>' : ''}`,
  };
}

// ---------- Magasins ----------
on('click', 'store-edit', (el) => {
  const s = el.dataset.id ? S.house.stores.find((x) => x.id === Number(el.dataset.id)) : { name: '', color: '#5b4bb7', active: true };
  sheet(`<h3>${s.id ? 'Modifier le magasin' : 'Nouveau magasin'}</h3>
    <label class="muted">Nom</label><input class="txt" name="name" value="${esc(s.name)}" placeholder="ex. Aldi Jambes">
    <div class="sec">Couleur</div><div class="swatches">${COLORS.map((c) => `<label><input type="radio" name="color" value="${c}" ${s.color === c ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div>
    ${s.id ? `<label class="row" style="margin-top:10px"><span class="grow"><b>Actif</b><span class="muted block">Inactif : masqué des conseils et listes, prix conservés</span></span><input type="checkbox" class="cb" name="active" ${s.active ? 'checked' : ''}></label>`
    : '<p class="muted small">Rayons repris dans l\'ordre du premier magasin, à ajuster ensuite. Prix inconnus jusqu\'aux premiers relevés.</p>'}
    <div class="row end"><button class="btn" data-a="store-save" data-id="${s.id || ''}">Enregistrer</button></div>`);
});
on('click', 'store-save', async (el) => {
  const root = document.querySelector('.sheet');
  const f = formData(root);
  const color = (root.querySelector('[name=color]:checked') || {}).value;
  const body = { name: f.name, color, ...(el.dataset.id ? { active: f.active } : {}) };
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
on('click', 'cat-add', () => {
  sheet(`<h3>Nouveau rayon</h3><input class="txt" name="name" placeholder="ex. Bio" data-enter="cat-add-ok"><p class="muted small">Ajouté en fin de parcours dans tous les magasins ; à replacer avec ↑ ↓.</p><div class="row end"><button class="btn" data-a="cat-add-ok">Ajouter</button></div>`);
});
on('click', 'cat-add-ok', async () => {
  const name = document.querySelector('.sheet [name=name]').value;
  if (await attempt(() => post(hp('/categories'), { name }))) { closeSheet(); toast('Rayon ajouté'); await refresh(); }
});
on('click', 'cat-rename', (el) => {
  const c = S.house.categories.find((x) => x.id === Number(el.dataset.id));
  sheet(`<h3>Renommer le rayon</h3><input class="txt" name="name" value="${esc(c.name)}" data-enter="cat-rename-ok" data-id="${c.id}"><p class="muted small">Le nom change pour tous les magasins et dans le catalogue.</p><div class="row end"><button class="btn" data-a="cat-rename-ok" data-id="${c.id}">Enregistrer</button></div>`);
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
