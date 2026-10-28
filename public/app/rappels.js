// Rappel de la veille (notification push), propre a chaque utilisateur : un seul message
// (menu du lendemain + « À faire à l'avance »), une seule heure. L'appareil s'abonne a
// l'activation (autorisation du navigateur) ; reglages enregistres aussitot.
import { esc, on, sheet, toast } from './ui.js';
import { api, post, put, attempt } from './api.js';
import { S, hp } from './state.js';
import { I } from './icons.js';
import { isInstalled } from './install.js';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let prefs = null, here = null; // reglages ; abonnement de cet appareil

const b64 = (s) => { const p = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(p), (c) => c.charCodeAt(0)); };
async function deviceSub() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}
// Abonne cet appareil (demande l'autorisation) ; false si refuse ou impossible.
async function subscribeHere() {
  if (Notification.permission === 'denied') { toast('Notifications bloquées : autorisez-les dans les réglages du navigateur pour ce site.', true); return false; }
  if (await Notification.requestPermission() !== 'granted') { toast('Notifications non autorisées', true); return false; }
  try {
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api('GET', 'push/key');
    const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
    prefs = await post(hp('/push/subscribe'), sub.toJSON());
    here = sub;
    return true;
  } catch (e) {
    console.warn(e);
    toast('Abonnement impossible sur cet appareil (navigation privée ? notifications bloquées ?)', true);
    return false;
  }
}
// Deconnexion : cet appareil ne recoit plus les rappels de ce compte.
export async function pushOff() {
  try {
    const sub = await deviceSub();
    if (sub) { await post(hp('/push/unsubscribe'), { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
  } catch { /* ignore */ }
}

// Resume pour l'onglet Plus.
export const rappelsSub = () => 'Menu du lendemain et préparations à l’avance';

function view() {
  if (!supported()) {
    return sheet(`<h3>${I('bell', 's')} Rappels</h3><p class="muted">${isIos() && !isInstalled()
      ? 'Sur iPhone, les notifications ne marchent qu’avec l’app installée : Plus → « Installer l’app », puis ouvrez-la depuis son icône (iOS 16.4 ou plus récent).'
      : 'Ce navigateur ne permet pas les notifications.'}</p>`);
  }
  const blocked = Notification.permission === 'denied';
  const device = here ? `<div class="banner leaf">${I('check')}<span class="grow">Rappels reçus sur cet appareil</span></div>`
    : `<div class="banner">${I('bell')}<span class="grow">${blocked ? 'Notifications bloquées pour ce site : autorisez-les dans les réglages du navigateur.' : 'Cet appareil ne reçoit pas encore les rappels : ils s’activent au premier rappel coché.'}</span></div>`;
  sheet(`<h3>${I('bell', 's')} Rappel de la veille</h3>${device}
    <div class="card" style="margin-top:10px"><label class="row"><input type="checkbox" class="cb" data-ch="push-on" ${prefs.menu_on ? 'checked' : ''}>
      <span class="grow"><b>Menu du lendemain et préparations à l’avance</b><span class="muted small block">Un seul message : les repas prévus demain, puis les consignes « À faire à l’avance » de leurs plats (fiche du plat, onglet Recette).</span></span></label>
      <div class="row gap" style="margin-top:8px"><span class="muted grow">Heure</span><input class="txt" style="width:8.5em" type="time" value="${esc(prefs.menu_time)}" data-ch="push-time">
      <button class="btn sm sec2" data-a="push-test">Essai</button></div></div>
    <p class="muted small">Envoyé seulement s’il y a quelque chose à dire. Heure de ${esc(prefs.tz === 'Europe/Brussels' ? 'Belgique' : prefs.tz)} · réglage propre à votre compte, sur ${prefs.devices || 0} appareil${prefs.devices > 1 ? 's' : ''}.</p>`);
}
on('click', 'push-open', async () => {
  if (!supported()) { view(); return; }
  [prefs, here] = await Promise.all([attempt(() => api('GET', hp('/push'))), deviceSub().catch(() => null)]);
  if (prefs) view();
});
async function save(body) {
  const r = await attempt(() => put(hp('/push'), body));
  if (r) { prefs = r; view(); }
}
on('change', 'push-on', async (el) => {
  if (el.checked && !here && !(await subscribeHere())) { el.checked = false; return; }
  await save({ menu_on: el.checked });
  toast(el.checked ? `Rappel à ${prefs.menu_time}` : 'Rappel désactivé');
});
on('change', 'push-time', (el) => { if (el.value) save({ menu_time: el.value }); });
on('click', 'push-test', async () => {
  if (!here && !(await subscribeHere())) return;
  const r = await attempt(() => post(hp('/push/test'), {}));
  if (r) toast('Essai envoyé');
  view();
});
