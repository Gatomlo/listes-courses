// Ecran Foyer : membres et invitations, reglages, tags des plats.
import { esc, eur, on, acc, sheet, closeSheet, confirmSheet, toast, formData } from './ui.js';
import { I } from './icons.js';
import { patch, post, put, del, attempt } from './api.js';
import { S, hp, isManager, render, loadHouse } from './state.js';
import { installCard } from './install.js';
import { rulesHtml, editRules, ruleText, copyRules } from './modeles.js';

const DOW = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const roleLabel = (r) => (r === 'manager' ? 'Gestionnaire' : 'Membre');

export function foyerView() {
  const H = S.house, mgr = isManager();
  const members = H.members.map((m) => `<div class="item${mgr || m.me ? ' click' : ''}" ${mgr || m.me ? `data-a="member" data-id="${m.id}"` : ''}>
      <span class="grow"><b>${esc(m.name)}${m.me ? ' (vous)' : ''}</b><span class="muted block">${esc(m.email)}</span></span>
      <span class="pill ${m.role === 'manager' ? 'p-leaf' : 'p-grey'}">${roleLabel(m.role)}</span>${mgr || m.me ? '<span class="muted">›</span>' : ''}</div>`).join('');
  const h = H.household;
  return {
    cols: true, title: h.name, sub: mgr ? 'Vous êtes gestionnaire' : 'Vous êtes membre',
    right: '<button class="btn sm sec2" data-a="go" data-to="#/foyers">Mes foyers</button>',
    body: `${installCard()}${acc('mem', { icon: `${I('users', 's')} `, title: 'Membres', sum: ` · ${H.members.length} personne${H.members.length > 1 ? 's' : ''}`, def: true,
        body: members + (mgr ? '<button class="btn sec2 full" style="margin:8px 0" data-a="invite">＋ Inviter un membre</button>' : '') })}
      ${acc('set', { icon: `${I('sliders', 's')} `, title: 'Réglages', sum: ` · seuil ${eur(h.threshold_cents)}, ${h.avg_records} relevés, courses ${h.rhythm_days} j, menu ${h.menu_days} j dès le ${DOW[h.menu_start_dow]}, plat ≥ ${h.menu_gap_days} j`,
        body: `<div class="form">
          <label class="row"><span class="grow"><b>Nom du foyer</b></span><input class="txt w12" name="name" value="${esc(h.name)}" ${mgr ? '' : 'disabled'}></label>
          <label class="row"><span class="grow"><b>Seuil « 2 magasins »</b><span class="muted block">Économie minimale (€) pour conseiller de faire les deux</span></span><input class="txt w5" name="threshold" inputmode="decimal" value="${(h.threshold_cents / 100).toFixed(2).replace('.', ',')}" ${mgr ? '' : 'disabled'}></label>
          <label class="row"><span class="grow"><b>Prix moyen</b><span class="muted block">Nombre de derniers relevés pris en compte</span></span><input class="txt w5" type="number" min="1" max="20" name="avg_records" value="${h.avg_records}" ${mgr ? '' : 'disabled'}></label>
          <label class="row"><span class="grow"><b>Rythme des courses</b><span class="muted block">Jours entre deux listes (date proposée)</span></span><input class="txt w5" type="number" min="1" max="90" name="rhythm_days" value="${h.rhythm_days}" ${mgr ? '' : 'disabled'}></label>
          <label class="row"><span class="grow"><b>Durée d'un menu</b><span class="muted block">Jours proposés pour un nouveau menu</span></span><input class="txt w5" type="number" min="1" max="62" name="menu_days" value="${h.menu_days}" ${mgr ? '' : 'disabled'}></label>
          <label class="row"><span class="grow"><b>Premier jour d'un menu</b><span class="muted block">Quand aucun menu n'est enregistré avant</span></span><select class="txt w8" name="menu_start_dow" ${mgr ? '' : 'disabled'}>${[1, 2, 3, 4, 5, 6, 0].map((i) => `<option value="${i}" ${i === h.menu_start_dow ? 'selected' : ''}>${DOW[i]}</option>`).join('')}</select></label>
          <label class="row"><span class="grow"><b>Délai avant de reproposer un plat</b><span class="muted block">Génération du menu : jours sans ce plat avant de le proposer à nouveau</span></span><input class="txt w5" type="number" min="0" max="365" name="menu_gap_days" value="${h.menu_gap_days}" ${mgr ? '' : 'disabled'}></label>
          ${mgr ? '<div class="row end"><button class="btn" data-a="settings-save">Enregistrer</button></div>' : ''}</div>` })}
      ${acc('tags', { icon: `${I('tag', 's')} `, title: 'Tags des plats', sum: ` · ${H.tags.length}`,
        body: H.tags.map((t) => `<div class="ord"><span class="grow">#${esc(t.name)} <span class="muted">· ${t.dishes} plat${t.dishes > 1 ? 's' : ''}</span></span>
          ${mgr ? `<button class="ic" title="Renommer" data-a="tag-rename" data-id="${t.id}">✎</button><button class="ic" title="Fusionner" data-a="tag-merge" data-id="${t.id}">⇄</button><button class="ic" title="Supprimer" data-a="tag-del" data-id="${t.id}">✕</button>` : ''}</div>`).join('')
          || '<p class="muted">Aucun tag : ajoutez-en depuis la fiche d’un plat.</p>' })}
      ${acc('types', { icon: `${I('bowl', 's')} `, title: 'Types de plats', sum: ` · ${H.types.length}`,
        body: `${H.types.map((t) => `<div class="ord"><span class="grow">${esc(t.name)} <span class="muted">· ${t.dishes} plat${t.dishes > 1 ? 's' : ''}</span></span>
          ${mgr ? `<button class="ic" title="Renommer" data-a="type-rename" data-id="${t.id}">✎</button><button class="ic" title="Fusionner" data-a="type-merge" data-id="${t.id}">⇄</button><button class="ic" title="Supprimer" data-a="type-del" data-id="${t.id}">✕</button>` : ''}</div>`).join('')
          || '<p class="muted">Aucun type. Ex. poisson, pâtes, riz, porc, poulet : un plat peut en avoir plusieurs, les modèles de semaine s’en servent.</p>'}
          ${mgr ? '<div class="row gap" style="margin-top:8px"><input class="txt grow" id="type-in" placeholder="Nouveau type (ex. poisson)" data-enter="type-add"><button class="btn sm sec2" data-a="type-add">＋</button></div>' : ''}` })}
      ${acc('models', { icon: `${I('calendar', 's')} `, title: 'Modèles de semaine', sum: ` · ${H.models.length}`,
        body: `${H.models.map((m) => `<div class="item${mgr ? ' click' : ''}" ${mgr ? `data-a="model-edit" data-id="${m.id}"` : ''}><span class="grow"><b>${esc(m.name)}</b><span class="muted block">${m.rules.map(ruleText).join(' · ') || 'aucune règle'}</span></span>${mgr ? '<span class="muted">›</span>' : ''}</div>`).join('')
          || '<p class="muted">Aucun modèle. Un modèle fixe la composition d’une semaine pour « Générer le menu » : ex. exactement 1 poisson, 2 pâtes, au plus 1 porc.</p>'}
          ${mgr ? '<button class="btn sec2 full" style="margin:8px 0" data-a="model-edit">＋ Nouveau modèle</button>' : ''}` })}`,
  };
}

const refresh = async () => { await loadHouse(); render(); };

on('click', 'settings-save', async () => {
  const f = formData(document.querySelector('.acc .form'));
  const threshold_cents = Math.round(parseFloat(String(f.threshold).replace(',', '.')) * 100);
  if (await attempt(() => patch(hp(), { name: f.name, threshold_cents, avg_records: f.avg_records, rhythm_days: f.rhythm_days, menu_days: f.menu_days, menu_start_dow: f.menu_start_dow, menu_gap_days: f.menu_gap_days }))) {
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
    <p class="muted small">${m.role === 'manager' ? 'Ajoute directement, valide les suggestions, gère plats, produits, magasins et membres.' : 'Consulte, coche en magasin, scanne les tickets et suggère articles et plats.'}${last ? ' Il faut au moins un gestionnaire dans le foyer.' : ''}</p>` : ''}
    ${mgr && !m.me ? `<div class="sec">Mot de passe oublié</div><button class="btn sec2 sm" data-a="member-reset" data-id="${m.id}">${I('lock', 's')} Créer un lien de réinitialisation</button><div id="reset-out"></div>` : ''}
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
  document.getElementById('invite-out').innerHTML = `<div class="card" style="margin-top:12px">${r.sent ? `<p>${I('mail', 's')} Invitation envoyée à <b>${esc(f.email)}</b>.</p>` : ''}
    <label class="muted">Lien d'invitation (valable 7 jours, usage unique)</label><input class="txt" readonly value="${esc(r.url)}" id="invite-url">
    <button class="btn sec2 full" style="margin-top:8px" data-a="invite-copy">${I('link', 's')} Copier le lien</button></div>`;
});
on('click', 'invite-copy', async () => {
  const input = document.getElementById('invite-url');
  try { await navigator.clipboard.writeText(input.value); toast('Lien copié'); } catch { input.select(); }
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

// ---------- Types de plats ----------
const typeById = (id) => S.house.types.find((t) => t.id === Number(id));
on('click', 'type-add', async () => {
  const i = document.getElementById('type-in');
  if (!i.value.trim()) return;
  if (await attempt(() => post(hp('/types'), { name: i.value }))) await tagsDone('Type créé');
});
on('click', 'type-rename', (el) => {
  const t = typeById(el.dataset.id);
  sheet(`<h3>Renommer « ${esc(t.name)} »</h3><input class="txt" name="name" value="${esc(t.name)}" data-enter="type-rename-ok" data-id="${t.id}">
    <p class="muted small">Le nom d’un type existant fusionne les deux.</p><div class="row end"><button class="btn" data-a="type-rename-ok" data-id="${t.id}">Enregistrer</button></div>`);
});
on('click', 'type-rename-ok', async (el) => {
  const name = document.querySelector('.sheet [name=name]').value;
  if (await attempt(() => patch(hp(`/types/${el.dataset.id}`), { name }))) await tagsDone('Type renommé');
});
on('click', 'type-merge', (el) => {
  const t = typeById(el.dataset.id), others = S.house.types.filter((x) => x.id !== t.id);
  if (!others.length) { toast('Aucun autre type'); return; }
  sheet(`<h3>Fusionner « ${esc(t.name)} »</h3><p class="muted">${t.dishes > 1 ? `Ses ${t.dishes} plats et les règles des modèles reçoivent` : t.dishes ? 'Son plat et les règles des modèles reçoivent' : 'Les règles des modèles reçoivent'} le type choisi, puis « ${esc(t.name)} » disparaît.</p>
    <select class="txt" name="into">${others.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>
    <div class="row end"><button class="btn sec2" data-a="close">Annuler</button><button class="btn" data-a="type-merge-ok" data-id="${t.id}">Fusionner</button></div>`);
});
on('click', 'type-merge-ok', async (el) => {
  const into = document.querySelector('.sheet [name=into]').value;
  if (await attempt(() => post(hp(`/types/${el.dataset.id}/merge`), { into }))) await tagsDone('Types fusionnés');
});
on('click', 'type-del', async (el) => {
  const t = typeById(el.dataset.id), n = S.house.models.filter((m) => m.rules.some((r) => r.type_id === t.id)).length;
  if (!(await confirmSheet({ title: `Supprimer « ${t.name} » ?`, ok: 'Supprimer', danger: true,
    text: `Il est retiré de ${t.dishes} plat${t.dishes > 1 ? 's' : ''}${n ? ` et ses règles de ${n} modèle${n > 1 ? 's' : ''}` : ''}.` }))) return;
  if (await attempt(() => del(hp(`/types/${t.id}`)))) await tagsDone('Type supprimé');
});

// ---------- Modeles de semaine ----------
let model = null; // { id, name, rules }
function modelSheet() {
  editRules(model.rules, modelSheet);
  sheet(`<h3>${model.id ? 'Modèle de semaine' : 'Nouveau modèle de semaine'}</h3>
    <label class="muted">Nom</label><input class="txt" id="model-name" data-in="model-name" value="${esc(model.name)}" placeholder="ex. Semaine normale, Été…">
    <div class="sec">Règles par semaine</div>
    <p class="muted small">Comptées en repas sur 7 jours (au prorata pour une fin de menu plus courte), repas déjà prévus compris. Les autres repas restent libres.</p>
    ${rulesHtml()}
    <div class="row end" style="margin-top:12px">${model.id ? '<button class="btn sec2 danger-t" data-a="model-del">Supprimer</button>' : ''}<button class="btn" data-a="model-save">Enregistrer</button></div>`);
}
on('click', 'model-edit', (el) => {
  const m = S.house.models.find((x) => x.id === Number(el.dataset.id));
  model = m ? { id: m.id, name: m.name, rules: copyRules(m.rules) } : { id: null, name: '', rules: [] };
  modelSheet();
});
on('input', 'model-name', (el) => { model.name = el.value; });
on('click', 'model-save', async () => {
  model.name = document.getElementById('model-name').value;
  const body = { name: model.name, rules: model.rules };
  if (await attempt(() => (model.id ? put(hp(`/menu-models/${model.id}`), body) : post(hp('/menu-models'), body)))) { closeSheet(); toast('Modèle enregistré'); await refresh(); }
});
on('click', 'model-del', async () => {
  if (!(await confirmSheet({ title: `Supprimer « ${model.name} » ?`, ok: 'Supprimer', danger: true, text: 'Les menus déjà générés ne changent pas.' }))) return;
  if (await attempt(() => del(hp(`/menu-models/${model.id}`)))) { toast('Modèle supprimé'); await refresh(); }
});

// Lien de reinitialisation du mot de passe (48 h), a transmettre au membre.
on('click', 'member-reset', async (el) => {
  const r = await attempt(() => post(hp(`/members/${el.dataset.id}/reset-link`)));
  if (!r) return;
  document.getElementById('reset-out').innerHTML = `<input class="txt" readonly value="${esc(r.url)}" id="reset-url" style="margin-top:8px">
    <p class="muted small">Valable 48 h, une seule fois. À transmettre au membre (message, SMS…) : il y choisira un nouveau mot de passe.</p>
    <button class="btn sec2 sm" data-a="reset-copy">${I('link', 's')} Copier</button>`;
});
on('click', 'reset-copy', async () => {
  const i = document.getElementById('reset-url');
  try { await navigator.clipboard.writeText(i.value); toast('Lien copié'); } catch { i.select(); }
});
