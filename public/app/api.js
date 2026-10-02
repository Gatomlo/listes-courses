// Appels a l'API (adresses relatives : la balise <base> pointe sur la racine de l'app,
// /cabas/ dans la passerelle), avec fonctionnement hors-ligne :
//  - chaque lecture reussie est gardee sur l'appareil (localStorage) et resservie sans
//    reseau : une liste ouverte une fois reste consultable dans un magasin sans reseau ;
//  - les actions du mode courses passent par des operations (sync) : sans reseau, elles
//    sont mises en file (outbox) et envoyees au retour du reseau, dans l'ordre.
import { toast } from './ui.js';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const TIMEOUT = 8000; // reseau tres faible en magasin : au-dela, on passe hors-ligne
const store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* plein ou indisponible */ } },
};

// ---------- Etat du reseau ----------
export const net = { online: navigator.onLine, syncedAt: store.get('cabas-synced', null) };
let netListener = () => {};
export const onNetChange = (fn) => { netListener = fn; };
function setOnline(v) {
  if (net.online === v) return;
  net.online = v;
  netListener();
  if (v) flush();
}
window.addEventListener('online', () => setOnline(true));
window.addEventListener('offline', () => setOnline(false));

export async function api(method, url, body) {
  let res;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    res = await fetch('api/' + url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
      credentials: 'same-origin',
      signal: ctrl.signal,
    });
  } catch {
    setOnline(false);
    throw new ApiError(0, 'Pas de réseau.');
  } finally {
    clearTimeout(timer);
  }
  setOnline(true);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || 'Erreur.');
  return data;
}

// Lecture : copie locale mise a jour ; sans reseau, la derniere copie connue.
export async function get(url) {
  try {
    const data = await api('GET', url);
    store.set('cabas-get:' + url, data);
    return data;
  } catch (e) {
    if (e.status === 0) {
      const cached = store.get('cabas-get:' + url, undefined);
      if (cached !== undefined) return cached;
    }
    throw e;
  }
}
// Met a jour la copie locale d'une lecture (apres une modification locale).
export const setCached = (url, data) => store.set('cabas-get:' + url, data);
export const getCached = (url) => store.get('cabas-get:' + url, undefined);

export const post = (u, b) => api('POST', u, b);
export const patch = (u, b) => api('PATCH', u, b);
export const put = (u, b) => api('PUT', u, b);
export const del = (u) => api('DELETE', u);

// Deconnexion : rien ne doit rester sur l'appareil.
export function clearLocal() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('cabas-get:') || k === 'cabas-outbox').forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

// ---------- Operations (mode courses, hors-ligne) ----------
const device = store.get('cabas-device', null) || (() => {
  const id = Math.random().toString(36).slice(2, 10);
  store.set('cabas-device', id);
  return id;
})();
let seq = 0;
export const newOp = (op) => ({ op_id: `${device}-${Date.now().toString(36)}-${seq++}`, at: Date.now(), ...op });

export const outbox = () => store.get('cabas-outbox', []);
let flushedListener = () => {};
export const onFlushed = (fn) => { flushedListener = fn; };

// Envoie des operations ; sans reseau, les met en file. Renvoie la reponse du serveur
// ({ results, lists }) ou null si mises en file.
export async function sync(hid, ops) {
  if (outbox().length) { queue(hid, ops); flush(); return null; } // garder l'ordre
  try {
    const r = await api('POST', `h/${hid}/sync`, { ops });
    markSynced();
    reportIgnored(r.results);
    return r;
  } catch (e) {
    if (e.status !== 0) throw e;
    queue(hid, ops);
    return null;
  }
}
function queue(hid, ops) {
  store.set('cabas-outbox', outbox().concat(ops.map((op) => ({ hid, op }))));
  netListener();
}
function markSynced() {
  net.syncedAt = Date.now();
  store.set('cabas-synced', net.syncedAt);
}
function reportIgnored(results) {
  const n = results.filter((r) => r.ignored && r.reason).length + results.filter((r) => !r.ok && !r.ignored).length;
  if (n) toast(`${n} modification${n > 1 ? 's' : ''} ignorée${n > 1 ? 's' : ''} (changée${n > 1 ? 's' : ''} entre-temps par quelqu'un d'autre)`, true);
}

let flushing = false;
export async function flush() {
  if (flushing) return;
  const pending = outbox();
  if (!pending.length) return;
  flushing = true;
  try {
    const hid = pending[0].hid;
    const batch = pending.filter((p) => p.hid === hid).slice(0, 100);
    const r = await api('POST', `h/${hid}/sync`, { ops: batch.map((p) => p.op) });
    // Toutes les operations envoyees ont une reponse (appliquee, deja appliquee ou refusee) :
    // elles quittent la file.
    const sent = new Set(batch.map((p) => p.op.op_id));
    store.set('cabas-outbox', outbox().filter((p) => !sent.has(p.op.op_id)));
    markSynced();
    reportIgnored(r.results);
    toast(`Réseau retrouvé · ${batch.length} modification${batch.length > 1 ? 's' : ''} envoyée${batch.length > 1 ? 's' : ''}`);
    flushedListener(r);
  } catch { /* toujours hors-ligne : nouvel essai plus tard */ } finally {
    flushing = false;
    netListener();
  }
  if (outbox().length && net.online) setTimeout(flush, 500);
}
// Nouvel essai regulier tant que la file n'est pas vide, et au retour sur l'app (sur
// iPhone, pas de synchronisation en arriere-plan : c'est ce retour qui la declenche).
setInterval(() => { if (outbox().length) flush(); }, 20000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });

// Execute une action et affiche l'erreur eventuelle ; renvoie undefined en cas d'echec.
export async function attempt(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.status === 0 ? 'Pas de réseau : action possible seulement en ligne.' : (e.message || 'Erreur.'), true);
    return undefined;
  }
}
