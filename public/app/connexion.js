// Ecrans d'acces : connexion (mot de passe ; lien par e-mail si l'envoi est configure),
// premier compte, compte cree par une invitation, nouveau mot de passe par un lien,
// choix / creation de foyer.
import { esc, on, toast, sheet, closeSheet, formData } from './ui.js';
import { get, post, patch, attempt, clearLocal } from './api.js';
import { S, render, loadHouse, go } from './state.js';

const pending = { invite: null, invitation: null, sent: null, reset: null, mode: null, options: { mail: false, setup: false } };

export function setInvite(token) { pending.invite = token; }
export function setReset(token) { pending.reset = token; }
export const inviteToken = () => pending.invite;
export const resetPending = () => !!pending.reset;
export async function loadOptions() {
  pending.options = await get('auth/options').catch(() => pending.options);
}

export async function loadInvitation() {
  if (!pending.invite) return;
  pending.invitation = await get(`invitations/${encodeURIComponent(pending.invite)}`).catch(() => null);
  if (!pending.invitation) { toast('Invitation expirée ou déjà utilisée.', true); pending.invite = null; }
}

const roleLabel = (r) => (r === 'manager' ? 'Gestionnaire' : 'Membre');
const inviteCard = (inv) => `<div class="card"><h4>${esc(inv.inviter || 'Quelqu’un')} vous invite à rejoindre « ${esc(inv.household)} »</h4>
  <p class="muted">Profil proposé : <b>${roleLabel(inv.role)}</b>${inv.role === 'manager' ? ' — gère listes, plats, catalogue, magasins et membres.' : ' — consulte, coche en magasin, scanne les tickets, suggère articles et plats.'}</p></div>`;

// Champs d'un formulaire de compte.
const field = (name, label, type = 'text', extra = '') => `<label class="muted" for="f-${name}">${label}</label>
  <input class="txt" id="f-${name}" name="${name}" type="${type}" ${extra}>`;
const pwd = (name, label, auto) => field(name, label, 'password', `autocomplete="${auto}" minlength="8"`);

export function loginView() {
  const inv = pending.invitation, o = pending.options;
  // Ecran a afficher : lien de reinitialisation > premier compte > invitation > connexion.
  const mode = pending.reset ? 'reset' : o.setup ? 'setup' : pending.mode || (inv ? 'register' : 'login');
  let form;
  if (pending.sent) {
    form = `<b>📧 Lien envoyé</b><p class="muted">Un lien de connexion a été envoyé à <b>${esc(pending.sent)}</b>. Il est valable 15 minutes et ne sert qu'une fois.</p>
      <button class="btn sec2" data-a="auth-mode" data-m="login">Retour</button>`;
  } else if (mode === 'reset') {
    form = `<h4>Choisir un nouveau mot de passe</h4>${pwd('password', 'Nouveau mot de passe (8 caractères minimum)', 'new-password')}${pwd('password2', 'Confirmer', 'new-password')}
      <button class="btn full" style="margin-top:12px" data-a="auth-submit" data-m="reset">Enregistrer et me connecter</button>`;
  } else if (mode === 'setup') {
    form = `<h4>Créer le premier compte</h4><p class="muted small">Aucun compte n'existe encore sur cette installation : le vôtre sera le premier. Vous créerez ensuite votre foyer et inviterez les autres membres.</p>
      ${field('name', 'Votre prénom', 'text', 'autocomplete="given-name"')}${field('email', 'Adresse e-mail (identifiant)', 'email', 'autocomplete="email"')}
      ${pwd('password', 'Mot de passe (8 caractères minimum)', 'new-password')}${pwd('password2', 'Confirmer', 'new-password')}
      <button class="btn full" style="margin-top:12px" data-a="auth-submit" data-m="setup">Créer mon compte</button>`;
  } else if (mode === 'register') {
    form = `<h4>Créer mon compte</h4>
      ${field('name', 'Votre prénom', 'text', 'autocomplete="given-name"')}${field('email', 'Adresse e-mail (identifiant)', 'email', `autocomplete="email" value="${esc(inv && inv.email || '')}"`)}
      ${pwd('password', 'Mot de passe (8 caractères minimum)', 'new-password')}${pwd('password2', 'Confirmer', 'new-password')}
      <button class="btn full" style="margin-top:12px" data-a="auth-submit" data-m="register">Créer mon compte et rejoindre le foyer</button>
      <p class="muted small">Déjà un compte ? <a href="#" data-a="auth-mode" data-m="login">Se connecter</a></p>`;
  } else if (mode === 'mail') {
    form = `<h4>Recevoir un lien de connexion</h4>${field('email', 'Adresse e-mail', 'email', 'autocomplete="email" data-enter="auth-submit" data-m="mail"')}
      <button class="btn full" style="margin-top:12px" data-a="auth-submit" data-m="mail">Recevoir le lien</button>
      <p class="muted small"><a href="#" data-a="auth-mode" data-m="login">Se connecter avec le mot de passe</a></p>`;
  } else {
    form = `<h4>Se connecter</h4>${field('email', 'Adresse e-mail', 'email', `autocomplete="username" value="${esc(inv && inv.email || '')}"`)}
      ${field('password', 'Mot de passe', 'password', 'autocomplete="current-password" data-enter="auth-submit" data-m="login"')}
      <button class="btn full" style="margin-top:12px" data-a="auth-submit" data-m="login">Se connecter</button>
      ${inv ? '<p class="muted small">Pas encore de compte ? <a href="#" data-a="auth-mode" data-m="register">Créer mon compte</a></p>' : ''}
      ${o.mail ? '<p class="muted small"><a href="#" data-a="auth-mode" data-m="mail">Recevoir plutôt un lien par e-mail</a></p>' : ''}
      <p class="muted small">Mot de passe oublié : demandez un lien de réinitialisation à un gestionnaire de votre foyer.</p>`;
  }
  return {
    noNav: true, title: 'Le Cabas', sub: 'Listes de courses du foyer',
    body: `<div class="hero"><div class="logo">🧺</div><h1>Le Cabas</h1><p class="muted">Courses partagées, bons prix, menus.</p></div>
      ${inv && mode !== 'reset' && mode !== 'setup' ? inviteCard(inv) : ''}
      <div class="card narrow form" id="auth-form">${form}</div>`,
  };
}

on('click', 'auth-mode', (el) => { pending.mode = el.dataset.m; pending.sent = null; render(); });
on('click', 'auth-submit', async (el) => {
  const m = el.dataset.m;
  const f = formData(document.getElementById('auth-form'));
  if ((m === 'setup' || m === 'register' || m === 'reset') && f.password !== f.password2) { toast('Les deux mots de passe diffèrent.', true); return; }
  if (m === 'mail') {
    if (!f.email) return;
    if (await attempt(() => post('auth/request', { email: f.email, invite: pending.invite || undefined }))) { pending.sent = f.email; render(); }
    return;
  }
  const call = {
    login: () => post('auth/login', { email: f.email, password: f.password }),
    setup: () => post('auth/setup', { name: f.name, email: f.email, password: f.password }),
    register: () => post('auth/register', { invite: pending.invite, name: f.name, email: f.email, password: f.password }),
    reset: () => post('auth/reset', { token: pending.reset, password: f.password }),
  }[m];
  const me = await attempt(call);
  if (!me) return;
  S.me = me;
  pending.reset = null; pending.mode = null; pending.options.setup = false;
  if (m === 'register') {
    // Le compte a deja rejoint le foyer de l'invitation.
    toast(`Bienvenue dans ${pending.invitation.household}`);
    pending.invite = null; pending.invitation = null;
  }
  if (m === 'reset') toast('Mot de passe enregistré');
  await loadHouse().catch(() => {});
  go(S.me.householdId ? '#/listes' : '#/foyers');
  await acceptPending();
});

// Connecte : accepte l'invitation en attente (apres confirmation).
export async function acceptPending() {
  if (!pending.invite || !pending.invitation) return;
  const inv = pending.invitation;
  const s = sheet(`<h3>Invitation</h3>${inviteCard(inv)}<div class="row end"><button class="btn sec2" data-r="0">Refuser</button><button class="btn" data-r="1">Rejoindre le foyer</button></div>`);
  const yes = await new Promise((resolve) => s.addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]');
    if (b) { closeSheet(); resolve(b.dataset.r === '1'); }
  }));
  const token = pending.invite;
  pending.invite = null; pending.invitation = null;
  if (!yes) return;
  const me = await attempt(() => post(`invitations/${encodeURIComponent(token)}/accept`));
  if (me) { S.me = me; await loadHouse(); toast(`Bienvenue dans ${inv.household}`); go('#/listes'); }
}

// ---------- Mes foyers ----------
export function foyersView() {
  const hs = S.me.households;
  return {
    title: 'Mes foyers', sub: hs.length ? 'Choisir le foyer affiché' : 'Créez votre premier foyer', back: hs.length ? '#/listes' : null, noNav: !hs.length,
    body: `${hs.map((h) => `<button class="card click row" data-a="foyer-pick" data-id="${h.id}"><span class="acc-i">🏡</span><span class="grow"><b>${esc(h.name)}</b><span class="muted block">${h.members} membre${h.members > 1 ? 's' : ''} · ${h.role === 'manager' ? 'gestionnaire' : 'membre'}</span></span>${h.id === S.me.householdId ? '<span class="pill p-leaf">actuel</span>' : ''}</button>`).join('')}
      <div class="card narrow"><label class="muted" for="new-house">Nouveau foyer</label><input class="txt" id="new-house" placeholder="ex. Foyer Phoenix" data-enter="foyer-create">
      <button class="btn full" style="margin-top:8px" data-a="foyer-create">＋ Créer le foyer</button><p class="muted small">Vous en serez gestionnaire. Magasins et rayons de départ : Intermarché, Colruyt, rayons courants (modifiables).</p></div>
      <div class="sec">Compte</div><div class="card row"><div class="grow"><b>${esc(S.me.name)}</b><div class="muted">${esc(S.me.email)}</div></div><button class="btn sm sec2" data-a="me-name">Renommer</button><button class="btn sm sec2" data-a="me-password">🔑 Mot de passe</button><button class="btn sm sec2" data-a="logout">Se déconnecter</button></div>`,
  };
}

on('click', 'foyer-pick', async (el) => {
  const me = await attempt(() => patch('me', { householdId: Number(el.dataset.id) }));
  if (me) { S.me = me; await loadHouse(); S.products = null; go('#/listes'); }
});
on('click', 'foyer-create', async () => {
  const name = document.getElementById('new-house').value.trim();
  if (!name) return;
  const me = await attempt(() => post('households', { name }));
  // Le nouveau foyer devient le foyer courant (fait par le serveur).
  if (me) { S.me = me; await loadHouse(); S.products = null; toast('Foyer créé'); go('#/foyer'); }
});
on('click', 'logout', async () => {
  await attempt(() => post('auth/logout'));
  clearLocal();
  location.href = './';
});
on('click', 'me-name', () => {
  const s = sheet(`<h3>Votre nom</h3><input class="txt" name="name" value="${esc(S.me.name)}" data-enter="me-name-ok"><div class="row end"><button class="btn" data-a="me-name-ok">Enregistrer</button></div>`);
  s.querySelector('input').select();
});
on('click', 'me-password', () => {
  sheet(`<h3>${S.me.hasPassword ? 'Changer mon mot de passe' : 'Choisir un mot de passe'}</h3><div class="form">
    ${S.me.hasPassword ? '<label class="muted">Mot de passe actuel</label><input class="txt" type="password" name="current" autocomplete="current-password">' : ''}
    <label class="muted">Nouveau mot de passe (8 caractères minimum)</label><input class="txt" type="password" name="password" autocomplete="new-password">
    <label class="muted">Confirmer</label><input class="txt" type="password" name="password2" autocomplete="new-password" data-enter="me-password-ok"></div>
    <div class="row end"><button class="btn" data-a="me-password-ok">Enregistrer</button></div>`);
});
on('click', 'me-password-ok', async () => {
  const f = formData(document.querySelector('.sheet'));
  if (f.password !== f.password2) { toast('Les deux mots de passe diffèrent.', true); return; }
  const me = await attempt(() => patch('me', { password: f.password, current_password: f.current }));
  if (me) { S.me = me; closeSheet(); toast('Mot de passe enregistré'); }
});
on('click', 'me-name-ok', async () => {
  const name = document.querySelector('.sheet [name=name]').value;
  const me = await attempt(() => patch('me', { name }));
  if (me) { S.me = me; closeSheet(); render(); }
});
