// Notifications (Web Push, sans service externe autre que celui du navigateur) : deux
// rappels la veille, chacun a son heure, reglables par chaque utilisateur et par foyer :
// - « menu » : les repas du lendemain ;
// - « ahead » : ce qui est a faire a l'avance pour ces repas (champ `ahead` des plats,
//   composants d'un plat compose compris).
// Les cles VAPID sont creees au premier besoin et gardees dans la base. Les heures
// s'entendent dans le fuseau CABAS_TZ (defaut Europe/Brussels), quel que soit celui du serveur.
const webpush = require('web-push');
const { db } = require('./db');
const { httpError } = require('./util');
const M = require('./meals');

const TZ = process.env.CABAS_TZ || 'Europe/Brussels';
const KINDS = ['menu', 'ahead'];
const WINDOW_MIN = 120; // rappel encore envoye jusqu'a 2 h apres l'heure (serveur redemarre...)
const SLOT = { pdj: 'Petit-déj.', midi: 'Midi', soir: 'Soir', coll: 'Collation' };
const ORDER = ['pdj', 'midi', 'soir', 'coll'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function keys() {
  let k = db.prepare('SELECT public_key, private_key FROM push_keys WHERE id = 1').get();
  if (!k) {
    const g = webpush.generateVAPIDKeys();
    db.prepare('INSERT OR IGNORE INTO push_keys (id, public_key, private_key) VALUES (1, ?, ?)').run(g.publicKey, g.privateKey);
    k = db.prepare('SELECT public_key, private_key FROM push_keys WHERE id = 1').get();
  }
  return k;
}
const publicKey = () => keys().public_key;
// Contact exige par les services de notification (Apple refuse une adresse locale).
function subject() {
  if (process.env.CABAS_PUSH_SUBJECT) return process.env.CABAS_PUSH_SUBJECT;
  const u = process.env.CABAS_PUBLIC_URL;
  return u && /^https:\/\//.test(u) ? u : 'mailto:cabas@example.org';
}

// Date (AAAA-MM-JJ) et heure (HH:MM) dans le fuseau du foyer.
function localNow(at = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const addDay = (iso) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

// ---------- Abonnements et reglages ----------
function subscribe(userId, b) {
  const endpoint = String((b && b.endpoint) || ''), k = (b && b.keys) || {};
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !k.p256dh || !k.auth) throw httpError(400, 'Abonnement invalide.');
  // Un appareil = un abonnement : repris par le dernier utilisateur connecte dessus.
  db.prepare(`INSERT INTO push_subs (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
    .run(userId, endpoint, String(k.p256dh).slice(0, 200), String(k.auth).slice(0, 100), Date.now());
}
function unsubscribe(userId, endpoint) {
  db.prepare('DELETE FROM push_subs WHERE user_id = ? AND endpoint = ?').run(userId, String(endpoint || ''));
}
function prefs(userId, hid) {
  const p = db.prepare('SELECT menu_on, menu_time, ahead_on, ahead_time FROM push_prefs WHERE user_id = ? AND household_id = ?').get(userId, hid)
    || { menu_on: 0, menu_time: '19:00', ahead_on: 0, ahead_time: '20:00' };
  const devices = db.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ?').get(userId).n;
  return { menu_on: !!p.menu_on, menu_time: p.menu_time, ahead_on: !!p.ahead_on, ahead_time: p.ahead_time, devices, tz: TZ };
}
// Champs absents = inchanges. Un rappel active apres son heure du jour ne part que demain.
function savePrefs(userId, hid, b) {
  const cur = prefs(userId, hid), now = localNow();
  const v = {};
  for (const k of KINDS) {
    const t = b[`${k}_time`] === undefined ? cur[`${k}_time`] : String(b[`${k}_time`]);
    if (!TIME.test(t)) throw httpError(400, 'Heure invalide (HH:MM).');
    v[`${k}_time`] = t;
    v[`${k}_on`] = b[`${k}_on`] === undefined ? cur[`${k}_on`] : !!b[`${k}_on`];
  }
  const sent = (k) => (minutes(now.time) >= minutes(v[`${k}_time`]) ? now.date : null);
  db.prepare(`INSERT INTO push_prefs (user_id, household_id, menu_on, menu_time, menu_sent, ahead_on, ahead_time, ahead_sent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, household_id) DO UPDATE SET menu_on = excluded.menu_on, menu_time = excluded.menu_time, menu_sent = excluded.menu_sent,
      ahead_on = excluded.ahead_on, ahead_time = excluded.ahead_time, ahead_sent = excluded.ahead_sent`)
    .run(userId, hid, v.menu_on ? 1 : 0, v.menu_time, sent('menu'), v.ahead_on ? 1 : 0, v.ahead_time, sent('ahead'));
  return prefs(userId, hid);
}

// ---------- Contenu ----------
// Repas valides du jour `date` (et repas a l'exterieur), dans l'ordre de la journee.
function dayMeals(hid, date) {
  const meals = M.mealRows(hid, date, date).filter((m) => !m.suggestion && !m.dish_deleted);
  const outs = M.outingRows(hid, date, date);
  return ORDER.flatMap((s) => [...meals.filter((m) => m.slot === s), ...outs.filter((o) => o.slot === s).map((o) => ({ ...o, out: true }))]);
}
// Notification d'un type pour le jour `date`, ou null s'il n'y a rien a dire.
function content(hid, kind, date) {
  const rows = dayMeals(hid, date);
  if (kind === 'menu') {
    if (!rows.length) return null;
    return { title: 'Demain au menu', url: '#/menu', tag: `menu-${date}`,
      body: rows.map((r) => `${SLOT[r.slot]} : ${r.out ? (r.rest ? `restes${r.dish ? ` de ${r.dish}` : r.note ? ` (${r.note})` : ''}` : `à l’extérieur${r.note ? ` (${r.note})` : ''}`) : `${r.dish}${r.persons !== 4 ? ` · ${r.persons} pers.` : ''}`}`).join('\n') };
  }
  // A faire a l'avance : plat du repas puis ses composants (hors « pas cette fois »).
  const todo = [], seen = new Set();
  for (const m of rows.filter((r) => !r.out)) {
    const ds = [{ id: m.dish_id, name: m.dish_name }, ...m.parts.filter((p) => !p.skipped).map((p) => ({ id: p.dish_id, name: p.name }))];
    for (const d of ds) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const a = (db.prepare('SELECT ahead FROM dishes WHERE id = ?').get(d.id) || {}).ahead;
      if (a) todo.push({ id: d.id, name: d.name, slot: m.slot, ahead: a });
    }
  }
  if (!todo.length) return null;
  return { title: 'À préparer pour demain', url: todo.length === 1 ? `#/plats/${todo[0].id}` : '#/menu', tag: `ahead-${date}`,
    body: todo.map((t) => `${t.name} (${SLOT[t.slot].toLowerCase()}) : ${t.ahead.replace(/\s*\n\s*/g, ' · ')}`).join('\n') };
}

// ---------- Envoi ----------
let sender = (sub, payload) => {
  const k = keys();
  return webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload,
    { TTL: 6 * 3600, urgency: 'normal', vapidDetails: { subject: subject(), publicKey: k.public_key, privateKey: k.private_key } });
};
const setSender = (fn) => { sender = fn; }; // essais
async function sendTo(userId, msg) {
  const subs = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subs WHERE user_id = ?').all(userId);
  let ok = 0;
  await Promise.all(subs.map(async (s) => {
    try { await sender(s, JSON.stringify(msg)); ok++; } catch (e) {
      // Abonnement expire ou retire par le navigateur : oublie.
      if (e && (e.statusCode === 404 || e.statusCode === 410)) db.prepare('DELETE FROM push_subs WHERE id = ?').run(s.id);
      else if (!process.env.CABAS_QUIET) console.warn(`Notification non envoyée (${e && e.statusCode || e && e.message})`);
    }
  }));
  return ok;
}

// Un passage du planificateur : rappels dont l'heure est atteinte (dans la fenetre) et
// pas encore traites aujourd'hui ; marques traites avant l'envoi (meme sans contenu).
async function tick(at = new Date()) {
  const now = localNow(at), tomorrow = addDay(now.date), sent = [];
  for (const kind of KINDS) {
    const due = db.prepare(`SELECT p.user_id, p.household_id, p.${kind}_time AS t FROM push_prefs p
      JOIN memberships ms ON ms.user_id = p.user_id AND ms.household_id = p.household_id
      WHERE p.${kind}_on = 1 AND (p.${kind}_sent IS NULL OR p.${kind}_sent < ?)
        AND EXISTS (SELECT 1 FROM push_subs s WHERE s.user_id = p.user_id)`).all(now.date)
      .filter((p) => { const d = minutes(now.time) - minutes(p.t); return d >= 0 && d < WINDOW_MIN; });
    for (const p of due) {
      db.prepare(`UPDATE push_prefs SET ${kind}_sent = ? WHERE user_id = ? AND household_id = ?`).run(now.date, p.user_id, p.household_id);
      const msg = content(p.household_id, kind, tomorrow);
      if (msg) { await sendTo(p.user_id, msg); sent.push({ user_id: p.user_id, household_id: p.household_id, kind, msg }); }
    }
  }
  return sent;
}
// Essai depuis l'appareil : le rappel tel qu'il partirait ce soir, sinon un message type.
async function test(userId, hid, kind) {
  if (!KINDS.includes(kind)) throw httpError(400, 'Type de rappel inconnu.');
  const msg = content(hid, kind, addDay(localNow().date))
    || { title: kind === 'menu' ? 'Demain au menu' : 'À préparer pour demain', url: '#/menu', tag: `test-${kind}`,
      body: kind === 'menu' ? 'Rien de prévu demain pour l’instant : ce rappel ne partira pas tant que le menu est vide.'
        : 'Rien à préparer pour demain : ce rappel ne part que si un plat du lendemain a une consigne « À faire à l’avance ».' };
  const n = await sendTo(userId, msg);
  if (!n) throw httpError(409, 'Aucun appareil abonné : activez les rappels sur cet appareil.');
  return { sent: n };
}

let timer = null;
function start() {
  if (timer || process.env.CABAS_PUSH === 'off') return;
  const run = () => tick().catch((e) => console.error('Rappels :', e));
  timer = setInterval(run, 60 * 1000);
  timer.unref();
  run();
}

module.exports = { publicKey, subscribe, unsubscribe, prefs, savePrefs, content, tick, test, start, setSender, localNow };
