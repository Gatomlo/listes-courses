// Ecrans d'acces : connexion par lien e-mail, invitation recue, choix / creation de foyer.
import { esc, on, toast, sheet, closeSheet } from './ui.js';
import { get, post, patch, attempt } from './api.js';
import { S, render, loadHouse, go } from './state.js';

const pending = { invite: null, invitation: null, sent: null };

export function setInvite(token) { pending.invite = token; }
export const inviteToken = () => pending.invite;

export async function loadInvitation() {
  if (!pending.invite) return;
  pending.invitation = await get(`invitations/${encodeURIComponent(pending.invite)}`).catch(() => null);
  if (!pending.invitation) { toast('Invitation expirée ou déjà utilisée.', true); pending.invite = null; }
}

const roleLabel = (r) => (r === 'manager' ? 'Gestionnaire' : 'Membre');
const inviteCard = (inv) => `<div class="card"><h4>${esc(inv.inviter || 'Quelqu’un')} vous invite à rejoindre « ${esc(inv.household)} »</h4>
  <p class="muted">Profil proposé : <b>${roleLabel(inv.role)}</b>${inv.role === 'manager' ? ' — gère listes, plats, catalogue, magasins et membres.' : ' — consulte, coche en magasin, scanne les tickets, suggère articles et plats.'}</p></div>`;

export function loginView() {
  const inv = pending.invitation;
  return {
    noNav: true, title: 'Le Cabas', sub: 'Listes de courses du foyer',
    body: `<div class="hero"><div class="logo">🧺</div><h1>Le Cabas</h1><p class="muted">Courses partagées, bons prix, menus.</p></div>
      ${inv ? inviteCard(inv) : ''}
      ${pending.sent ? `<div class="card"><b>📧 Lien envoyé</b><p class="muted">Un lien de connexion a été envoyé à <b>${esc(pending.sent)}</b>. Il est valable 15 minutes et ne sert qu'une fois. Vous pouvez fermer cette page.</p>
        <button class="btn sec2" data-a="login-reset">Changer d'adresse</button></div>`
      : `<div class="card narrow"><label class="muted" for="login-email">Adresse e-mail</label>
        <input class="txt" id="login-email" type="email" autocomplete="email" placeholder="prenom@exemple.be" value="${esc(inv && inv.email || '')}" data-enter="login-send">
        <button class="btn full" style="margin-top:10px" data-a="login-send">Recevoir un lien de connexion</button>
        <p class="muted small">Pas de mot de passe : un lien arrive par e-mail. La session reste ouverte 90 jours sur cet appareil.</p></div>`}`,
  };
}

on('click', 'login-send', async () => {
  const email = document.getElementById('login-email').value.trim();
  if (!email) return;
  const ok = await attempt(() => post('auth/request', { email, invite: pending.invite || undefined }));
  if (ok) { pending.sent = email; render(); }
});
on('click', 'login-reset', () => { pending.sent = null; render(); });

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
      <div class="sec">Compte</div><div class="card row"><div class="grow"><b>${esc(S.me.name)}</b><div class="muted">${esc(S.me.email)}</div></div><button class="btn sm sec2" data-a="me-name">Renommer</button><button class="btn sm sec2" data-a="logout">Se déconnecter</button></div>`,
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
  location.href = './';
});
on('click', 'me-name', () => {
  const s = sheet(`<h3>Votre nom</h3><input class="txt" name="name" value="${esc(S.me.name)}" data-enter="me-name-ok"><div class="row end"><button class="btn" data-a="me-name-ok">Enregistrer</button></div>`);
  s.querySelector('input').select();
});
on('click', 'me-name-ok', async () => {
  const name = document.querySelector('.sheet [name=name]').value;
  const me = await attempt(() => patch('me', { name }));
  if (me) { S.me = me; closeSheet(); render(); }
});
