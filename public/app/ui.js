// Briques d'interface : echappement, accordeons, panneau du bas, messages, actions.
// La politique de contenu interdit les onclick en ligne : chaque bouton porte
// data-a="nom" (et ses parametres en data-*), traite par delegation (voir on()).

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const eur = (cents) => (cents == null ? '—' : (cents / 100).toFixed(2).replace('.', ',') + ' €');
export const fmtDate = (iso, o = { day: 'numeric', month: 'short' }) => new Date(iso + 'T12:00').toLocaleDateString('fr-BE', o);

export const isPc = () => window.matchMedia('(min-width: 900px)').matches;

// ---------- Actions par delegation ----------
const handlers = { click: {}, input: {}, change: {} };
export function on(kind, name, fn) { handlers[kind][name] = fn; }
for (const kind of ['click', 'input', 'change']) {
  document.addEventListener(kind, (ev) => {
    const attr = kind === 'click' ? 'a' : kind === 'input' ? 'in' : 'ch';
    const el = ev.target.closest(`[data-${attr}]`);
    if (!el) return;
    const fn = handlers[kind][el.dataset[attr]];
    if (!fn) return;
    if (kind === 'click') ev.preventDefault();
    fn(el, ev);
  });
}
// Entree dans un champ marque data-enter : declenche l'action indiquee.
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  const el = ev.target.closest('[data-enter]');
  if (el && handlers.click[el.dataset.enter]) { ev.preventDefault(); handlers.click[el.dataset.enter](el, ev); }
});

// ---------- Accordeons ----------
// Etat memorise par appareil, separement mobile / PC ; sur PC tout est ouvert par defaut.
const accKey = () => (isPc() ? 'cabas-acc-pc' : 'cabas-acc');
function accState() {
  try { return JSON.parse(localStorage.getItem(accKey()) || '{}'); } catch { return {}; }
}
export const isOpen = (id, def = false) => accState()[id] ?? (isPc() || def);
export function toggleAcc(id, def) {
  const st = accState();
  st[id] = !isOpen(id, def);
  try { localStorage.setItem(accKey(), JSON.stringify(st)); } catch { /* stockage indisponible */ }
}
export function acc(id, { icon = '', title, sum = '', body, def = false }) {
  const o = isOpen(id, def);
  return `<section class="acc${o ? ' open' : ''}"><button class="acc-h" data-a="acc" data-id="${esc(id)}" data-def="${def ? 1 : ''}" aria-expanded="${o}">
    ${icon ? `<span class="acc-i">${icon}</span>` : ''}<span class="grow"><b>${esc(title)}</b><span class="muted">${sum}</span></span><span class="acc-c">›</span></button>
    ${o ? `<div class="acc-b">${body}</div>` : ''}</section>`;
}

// ---------- Panneau (bas sur mobile, dialogue centre sur PC) ----------
export function sheet(html) {
  closeSheet();
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  bg.addEventListener('click', (e) => { if (e.target === bg) closeSheet(); });
  document.body.appendChild(bg);
  const first = bg.querySelector('input,select,textarea');
  if (first) first.focus();
  return bg.querySelector('.sheet');
}
export function closeSheet() { document.querySelectorAll('.sheet-bg').forEach((e) => e.remove()); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

// Confirmation : resout true / false.
export function confirmSheet({ title, text, ok = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    const s = sheet(`<h3>${esc(title)}</h3><p class="muted">${text}</p><div class="row end"><button class="btn sec2" data-r="0">Annuler</button><button class="btn${danger ? ' danger' : ''}" data-r="1">${esc(ok)}</button></div>`);
    s.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (b) { closeSheet(); resolve(b.dataset.r === '1'); }
    });
  });
}

// ---------- Message ----------
let toastTimer;
export function toast(msg, isError = false) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.toggle('err', isError);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), isError ? 4500 : 2400);
}

// Valeurs d'un formulaire (champs name=...) d'un conteneur.
export function formData(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach((el) => {
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  });
  return out;
}
