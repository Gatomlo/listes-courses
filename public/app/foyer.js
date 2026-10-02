// Ecran Foyer : membres et invitations, reglages, magasins et ordre des rayons.
import { esc, eur, on, acc, sheet, closeSheet, confirmSheet, toast, formData } from './ui.js';
import { patch, post, put, del, attempt } from './api.js';
import { S, hp, isManager, render, loadHouse } from './state.js';
import { installCard } from './install.js';

const DOW = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const COLORS = ['#c8313b', '#e08a12', '#2f7d4f', '#5b4bb7', '#1f6fb2', '#8a5a2b'];
const roleLabel = (r) => (r === 'manager' ? 'Gestionnaire' : 'Membre');
const dot = (c) => `<span class="dot" style="background:${esc(c)}"></span>`;

export function foyerView() {
  const H = S.house, mgr = isManager();
  const cats = Object.fromEntries(H.categories.map((c) => [c.id, c]));
  const members = H.members.map((m) => `<div class="item${mgr || m.me ? ' click' : ''}" ${mgr || m.me ? `data-a="member" data-id="${m.id}"` : ''}>
      <span class="grow"><b>${esc(m.name)}${m.me ? ' (vous)' : ''}</b><span class="muted block">${esc(m.email)}</span></span>
      <span class="pill ${m.role === 'manager' ? 'p-leaf' : 'p-grey'}">${roleLabel(m.role)}</span>${mgr || m.me ? '<span class="muted">›</span>' : ''}</div>`).join('');
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
  const h = H.household;
  return {
    title: h.name, sub: mgr ? 'Vous êtes gestionnaire' : 'Vous êtes membre',
    right: '<button class="btn sm sec2" data-a="go" data-to="#/foyers">Mes foyers</button>',
    body: `${installCard()}${acc('mem', { icon: '👥', title: 'Membres', sum: ` · ${H.members.length} personne${H.members.length > 1 ? 's' : ''}`, def: true,
        body: members + (mgr ? '<button class="btn sec2 full" style="margin:8px 0" data-a="invite">＋ Inviter un membre</button>' : '') })}
      ${acc('set', { icon: '⚙️', title: 'Réglages', sum: ` · seuil ${eur(h.threshold_cents)}, ${h.avg_records} relevés, courses ${h.rhythm_days} j, menu ${h.menu_days} j dès le ${DOW[h.menu_start_dow]}`,
        body: `<div class="form">
          <label class="row"><span class="grow"><b>Nom du foyer</b></span><input class="txt w12" name="name" value="${esc(h.name)}" ${mgr ? '' : 'disabled'}></label>
          <label class="row"><span class="grow"><b>Seuil « 2 magasins »</b><span class="muted block">Économie minimale (€) pour conseiller de faire les deux</span></span><input class="txt w5" name="threshold" inputmode="decimal" value="${(h.threshold_cents / 100).toFixed(2).replace('.', ',')}" ${mgr ? '' : 'disabled'}></label>
          <label class="row"><span class="grow"><b>Prix moyen</b><span class="muted block">Nombre de derniers relevés pris en compte</span></span><input class="txt w5" type="number" min="1" max="20" name="avg_records" value="${h.avg_records}" ${mgr ? '' : 'disabled'}></label>
          <label class="row"><span class="grow"><b>Rythme des courses</b><span class="muted block">Jours entre deux listes (date proposée)</span></span><input class="txt w5" type="number" min="1" max="90" name="rhythm_days" value="${h.rhythm_days}" ${mgr ? '' : 'disabled'}></label>
          <label class="row"><span class="grow"><b>Durée d'un menu</b><span class="muted block">Jours proposés pour un nouveau menu</span></span><input class="txt w5" type="number" min="1" max="62" name="menu_days" value="${h.menu_days}" ${mgr ? '' : 'disabled'}></label>
          <label class="row"><span class="grow"><b>Premier jour d'un menu</b><span class="muted block">Quand aucun menu n'est enregistré avant</span></span><select class="txt w8" name="menu_start_dow" ${mgr ? '' : 'disabled'}>${[1, 2, 3, 4, 5, 6, 0].map((i) => `<option value="${i}" ${i === h.menu_start_dow ? 'selected' : ''}>${DOW[i]}</option>`).join('')}</select></label>
          ${mgr ? '<div class="row end"><button class="btn" data-a="settings-save">Enregistrer</button></div>' : ''}</div>` })}
      ${stores}
      ${mgr ? '<button class="btn sec2 full" data-a="store-edit">＋ Ajouter un magasin</button>' : ''}
      ${acc('tags', { icon: '🏷', title: 'Tags des plats', sum: ` · ${H.tags.length}`,
        body: H.tags.map((t) => `<div class="ord"><span class="grow">#${esc(t.name)} <span class="muted">· ${t.dishes} plat${t.dishes > 1 ? 's' : ''}</span></span>
          ${mgr ? `<button class="ic" title="Renommer" data-a="tag-rename" data-id="${t.id}">✎</button><button class="ic" title="Fusionner" data-a="tag-merge" data-id="${t.id}">⇄</button><button class="ic" title="Supprimer" data-a="tag-del" data-id="${t.id}">✕</button>` : ''}</div>`).join('')
          || '<p class="muted">Aucun tag : ajoutez-en depuis la fiche d’un plat.</p>' })}`,
  };
}

const refresh = async () => { await loadHouse(); render(); };

on('click', 'settings-save', async () => {
  const f = formData(document.querySelector('.acc .form'));
  const threshold_cents = Math.round(parseFloat(String(f.threshold).replace(',', '.')) * 100);
  if (await attempt(() => patch(hp(), { name: f.name, threshold_cents, avg_records: f.avg_records, rhythm_days: f.rhythm_days, menu_days: f.menu_days, menu_start_dow: f.menu_start_dow }))) {
    toast('Réglages enregistrés'); await refresh();
  }
});

// ---------- Membres ----------
on('click', 'member', (el) => {
  const m = S.house.members.find((x) => x.id === Number(el.dataset.id));
  const mgr = isManager();
  const managers = S.house.members.filter((x) => x.role === 'manager').length;
  const last = m.role === 'manager' && managers === 1;
  sheet(`<h3>${esc(m.name)}</h3><p class="muted">${esc(m.email)}</p>
    ${mgr ? `<label class="muted">Nom affiché dans ce foyer</label><input class="txt" name="display_name" value="${esc(m.name)}">
    <div class="sec">Profil</div><div class="seg">${['member', 'manager'].map((r) => `<button class="${m.role === r ? 'on' : ''}" data-a="member-role" data-id="${m.id}" data-role="${r}" ${last && r === 'member' ? 'disabled title="Dernier gestionnaire"' : ''}>${roleLabel(r)}</button>`).join('')}</div>
    <p class="muted small">${m.role === 'manager' ? 'Ajoute directement, valide les suggestions, gère plats, catalogue, magasins et membres.' : 'Consulte, coche en magasin, scanne les tickets et suggère articles et plats.'}${last ? ' Il faut au moins un gestionnaire dans le foyer.' : ''}</p>` : ''}
    ${mgr && !m.me ? `<div class="sec">Mot de passe oublié</div><button class="btn sec2 sm" data-a="member-reset" data-id="${m.id}">🔑 Créer un lien de réinitialisation</button><div id="reset-out"></div>` : ''}
    <div class="row end">${!last ? `<button class="btn sec2 danger-t" data-a="member-del" data-id="${m.id}">${m.me ? 'Quitter le foyer' : 'Retirer du foyer'}</button>` : ''}${mgr ? `<button class="btn" data-a="member-save" data-id="${m.id}">Enregistrer</button>` : ''}</div>`);
});
on('click', 'member-role', async (el) => {
  const r = await attempt(() => patch(hp(`/members/${el.dataset.id}`), { role: el.dataset.role }));
  if (r) { S.house.members = r; closeSheet(); render(); document.querySelector(`[data-a=member][data-id="${el.dataset.id}"]`)?.click(); }
});
on('click', 'member-save', async (el) => {
  const display_name = document.querySelector('.sheet [name=display_name]').value;
  const r = await attempt(() => patch(hp(`/members/${el.dataset.id}`), { display_name }));
  if (r) { S.house.members = r; closeSheet(); render(); }
});
on('click', 'member-del', async (el) => {
  const m = S.house.members.find((x) => x.id === Number(el.dataset.id));
  const ok = await confirmSheet({
    title: m.me ? 'Quitter le foyer ?' : `Retirer ${m.name} du foyer ?`, danger: true, ok: m.me ? 'Quitter' : 'Retirer',
    text: m.me ? 'Vous perdrez l\'accès à ses listes et menus.' : 'Son compte n\'est pas supprimé : il perd l\'accès à ce foyer. Son nom reste dans l\'historique.',
  });
  if (!ok) return;
  if (await attempt(() => del(hp(`/members/${m.id}`)))) {
    if (m.me) { location.href = './'; return; }
    toast(`${m.name} retiré du foyer`); await refresh();
  }
});

// ---------- Invitation ----------
on('click', 'invite', () => {
  sheet(`<h3>Inviter un membre</h3><label class="muted">E-mail (facultatif, envoyé seulement si l'envoi d'e-mails est configuré)</label><input class="txt" name="email" type="email" placeholder="prenom@exemple.be">
    <div class="sec">Profil</div><select class="txt" name="role"><option value="member">Membre</option><option value="manager">Gestionnaire</option></select>
    <div class="row end" style="margin-top:12px"><button class="btn" data-a="invite-ok">Créer l'invitation</button></div><div id="invite-out"></div>`);
});
on('click', 'invite-ok', async () => {
  const f = formData(document.querySelector('.sheet'));
  const r = await attempt(() => post(hp('/invitations'), f));
  if (!r) return;
  document.getElementById('invite-out').innerHTML = `<div class="card" style="margin-top:12px">${r.sent ? `<p>📧 Invitation envoyée à <b>${esc(f.email)}</b>.</p>` : ''}
    <label class="muted">Lien d'invitation (valable 7 jours, usage unique)</label><input class="txt" readonly value="${esc(r.url)}" id="invite-url">
    <button class="btn sec2 full" style="margin-top:8px" data-a="invite-copy">🔗 Copier le lien</button></div>`;
});
on('click', 'invite-copy', async () => {
  const input = document.getElementById('invite-url');
  try { await navigator.clipboard.writeText(input.value); toast('Lien copié'); } catch { input.select(); }
});

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
on('click', 'close', () => closeSheet());

// ---------- Tags des plats ----------
const tagById = (id) => S.house.tags.find((t) => t.id === Number(id));
const tagsDone = async (msg) => { closeSheet(); toast(msg); S.dishes = null; await refresh(); };
on('click', 'tag-rename', (el) => {
  const t = tagById(el.dataset.id);
  sheet(`<h3>Renommer #${esc(t.name)}</h3><input class="txt" name="name" value="${esc(t.name)}" data-enter="tag-rename-ok" data-id="${t.id}">
    <p class="muted small">Le nom d’un tag existant fusionne les deux.</p><div class="row end"><button class="btn" data-a="tag-rename-ok" data-id="${t.id}">Enregistrer</button></div>`);
});
on('click', 'tag-rename-ok', async (el) => {
  const name = document.querySelector('.sheet [name=name]').value;
  if (await attempt(() => patch(hp(`/tags/${el.dataset.id}`), { name }))) await tagsDone('Tag renommé');
});
on('click', 'tag-merge', (el) => {
  const t = tagById(el.dataset.id), others = S.house.tags.filter((x) => x.id !== t.id);
  if (!others.length) { toast('Aucun autre tag'); return; }
  sheet(`<h3>Fusionner #${esc(t.name)}</h3><p class="muted">${t.dishes > 1 ? `Ses ${t.dishes} plats reçoivent` : t.dishes ? 'Son plat reçoit' : 'Aucun plat ne reçoit'} le tag choisi, puis #${esc(t.name)} disparaît.</p>
    <select class="txt" name="into">${others.map((o) => `<option value="${o.id}">#${esc(o.name)}</option>`).join('')}</select>
    <div class="row end"><button class="btn sec2" data-a="close">Annuler</button><button class="btn" data-a="tag-merge-ok" data-id="${t.id}">Fusionner</button></div>`);
});
on('click', 'tag-merge-ok', async (el) => {
  const into = document.querySelector('.sheet [name=into]').value;
  if (await attempt(() => post(hp(`/tags/${el.dataset.id}/merge`), { into }))) await tagsDone('Tags fusionnés');
});
on('click', 'tag-del', async (el) => {
  const t = tagById(el.dataset.id);
  if (!(await confirmSheet({ title: `Supprimer #${t.name} ?`, text: `Il est retiré de ${t.dishes} plat${t.dishes > 1 ? 's' : ''}.`, ok: 'Supprimer', danger: true }))) return;
  if (await attempt(() => del(hp(`/tags/${t.id}`)))) await tagsDone('Tag supprimé');
});

// Lien de reinitialisation du mot de passe (48 h), a transmettre au membre.
on('click', 'member-reset', async (el) => {
  const r = await attempt(() => post(hp(`/members/${el.dataset.id}/reset-link`)));
  if (!r) return;
  document.getElementById('reset-out').innerHTML = `<input class="txt" readonly value="${esc(r.url)}" id="reset-url" style="margin-top:8px">
    <p class="muted small">Valable 48 h, une seule fois. À transmettre au membre (message, SMS…) : il y choisira un nouveau mot de passe.</p>
    <button class="btn sec2 sm" data-a="reset-copy">🔗 Copier</button>`;
});
on('click', 'reset-copy', async () => {
  const i = document.getElementById('reset-url');
  try { await navigator.clipboard.writeText(i.value); toast('Lien copié'); } catch { i.select(); }
});
