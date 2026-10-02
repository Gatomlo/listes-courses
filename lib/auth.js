// Authentification sans mot de passe : un lien de connexion envoye par e-mail (valable
// 15 min, usage unique), puis une session de 90 jours gardee en base (survit au
// redemarrage de la passerelle). Roles par foyer : manager (gestionnaire) ou member.
const crypto = require('crypto');
const { db } = require('./db');
const { httpError, limiter } = require('./util');

const COOKIE = 'cabas_session';
const SESSION_TTL = 90 * 24 * 3600 * 1000;
const LOGIN_TTL = 15 * 60 * 1000;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

// Chemin de montage de l'app (/cabas dans la passerelle, '' seule).
function rootPath(req) {
  const m = req.app && req.app.mountpath;
  return typeof m === 'string' && m !== '/' ? m : '';
}

// Adresse publique de l'app pour les liens envoyes par e-mail. CABAS_PUBLIC_URL
// (ex. https://exemple.be/cabas) est a definir en production : l'en-tete Host d'une
// requete peut etre falsifie.
function publicUrl(req) {
  const fixed = String(process.env.CABAS_PUBLIC_URL || '').replace(/\/+$/, '');
  if (fixed) return fixed;
  const proto = String(req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  return `${proto}://${req.get('host')}${rootPath(req)}`;
}

function readCookie(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// Cookie limite a l'app (pas aux autres outils de la passerelle, meme domaine).
function setCookie(req, res, value, maxAge) {
  const secure = req.secure || String(req.get('x-forwarded-proto') || '').startsWith('https');
  const parts = [`${COOKIE}=${value}`, `Path=${rootPath(req)}/`, `Max-Age=${Math.floor(maxAge / 1000)}`, 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function createSession(req, res, userId) {
  const token = newToken();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, Date.now() + SESSION_TTL);
  setCookie(req, res, token, SESSION_TTL);
}

function destroySession(req, res) {
  const token = readCookie(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  setCookie(req, res, '', 0);
}

// Renseigne req.user si la session est valide (prolongee au plus une fois par jour).
function loadUser(req, res, next) {
  const token = readCookie(req);
  if (token) {
    const row = db.prepare(`SELECT u.id, u.email, u.name, u.last_household_id, s.expires_at FROM sessions s
      JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha256(token));
    if (row && row.expires_at > Date.now()) {
      req.user = { id: row.id, email: row.email, name: row.name, lastHouseholdId: row.last_household_id };
      if (row.expires_at - Date.now() < SESSION_TTL - 24 * 3600 * 1000) {
        db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Date.now() + SESSION_TTL, sha256(token));
        setCookie(req, res, token, SESSION_TTL);
      }
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return next(httpError(401, 'Connexion requise.'));
  next();
}

// ---------- Liens de connexion ----------
// Limites : 5 demandes par adresse et par heure, 100 au total (anti-abus d'envoi).
const requests = limiter(3600 * 1000);
function createLoginToken(email) {
  const key = email.toLowerCase();
  if (requests.count(key) >= 5 || requests.count('*') >= 100) throw httpError(429, 'Trop de demandes, réessayez plus tard.');
  requests.hit(key); requests.hit('*');
  const token = newToken();
  db.prepare('DELETE FROM login_tokens WHERE expires_at < ?').run(Date.now() - 24 * 3600 * 1000);
  db.prepare('INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)').run(sha256(token), email, Date.now() + LOGIN_TTL);
  return token;
}

// Consomme un lien : renvoie l'adresse e-mail, ou une erreur 400.
function consumeLoginToken(token) {
  const row = db.prepare('SELECT email, expires_at, used_at FROM login_tokens WHERE token_hash = ?').get(sha256(String(token || '')));
  if (!row || row.used_at || row.expires_at < Date.now()) throw httpError(400, 'Lien de connexion expiré ou déjà utilisé. Demandez-en un nouveau.');
  db.prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ?').run(Date.now(), sha256(String(token)));
  return row.email;
}

// ---------- Mots de passe ----------
// scrypt (module crypto de Node) : calcul volontairement couteux, asynchrone pour ne pas
// bloquer les autres requetes. Format : scrypt$<sel hex>$<empreinte hex>.
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const MIN_PASSWORD = 8;

function checkPassword(p) {
  if (typeof p !== 'string' || p.length < MIN_PASSWORD) throw httpError(400, `Mot de passe trop court (${MIN_PASSWORD} caractères minimum).`);
  if (p.length > 200) throw httpError(400, 'Mot de passe trop long.');
}
async function hashPassword(p) {
  checkPassword(p);
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(p, salt, 64)).toString('hex')}`;
}
// Compte inconnu ou sans mot de passe : meme calcul sur une empreinte factice (le temps
// de reponse ne revele pas si l'adresse existe).
const DUMMY = `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`;
async function verifyPassword(p, stored) {
  const [, salt, hash] = String(stored || DUMMY).split('$');
  const expected = Buffer.from(hash, 'hex');
  const actual = await scrypt(String(p || ''), Buffer.from(salt, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual) && !!stored;
}

// Echecs de connexion : blocage 15 min apres 8 echecs pour une adresse ; au-dela de 40
// echecs au total, reponses ralenties (l'IP n'est pas fiable derriere le proxy).
const failures = limiter(15 * 60 * 1000);
const tooManyFailures = (email) => failures.count('u:' + email) >= 8;
const recordFailure = (email) => { failures.hit('u:' + email); failures.hit('*'); };
const failureDelay = () => (failures.count('*') >= 40 ? 3000 : 600);

// Lien de reinitialisation (cree par un gestionnaire, transmis a la main) : 48 h.
function createResetToken(userId) {
  const token = newToken();
  db.prepare('DELETE FROM reset_tokens WHERE expires_at < ? OR user_id = ?').run(Date.now(), userId);
  db.prepare('INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, Date.now() + 48 * 3600 * 1000);
  return token;
}
function consumeResetToken(token) {
  const row = db.prepare('SELECT user_id, expires_at, used_at FROM reset_tokens WHERE token_hash = ?').get(sha256(String(token || '')));
  if (!row || row.used_at || row.expires_at < Date.now()) throw httpError(400, 'Lien expiré ou déjà utilisé. Demandez-en un nouveau à un gestionnaire du foyer.');
  db.prepare('UPDATE reset_tokens SET used_at = ? WHERE token_hash = ?').run(Date.now(), sha256(String(token)));
  return row.user_id;
}

// ---------- Roles dans un foyer ----------
function roleIn(userId, householdId) {
  const row = db.prepare('SELECT role FROM memberships WHERE user_id = ? AND household_id = ?').get(userId, householdId);
  return row ? row.role : null;
}

// Garde des routes /api/h/:hid/... : membre du foyer (req.role renseigne).
function householdMember(req, res, next) {
  if (!req.user) return next(httpError(401, 'Connexion requise.'));
  const hid = parseInt(req.params.hid, 10);
  const role = Number.isFinite(hid) ? roleIn(req.user.id, hid) : null;
  if (!role) return next(httpError(404, 'Foyer introuvable.'));
  req.hid = hid;
  req.role = role;
  next();
}

// A poser sur une route reservee aux gestionnaires.
function manager(req, res, next) {
  if (req.role !== 'manager') return next(httpError(403, 'Réservé aux gestionnaires du foyer.'));
  next();
}

module.exports = {
  sha256, newToken, rootPath, publicUrl, createSession, destroySession, loadUser, requireAuth,
  createLoginToken, consumeLoginToken, roleIn, householdMember, manager, requests,
  hashPassword, verifyPassword, checkPassword, tooManyFailures, recordFailure, failureDelay, failures, createResetToken, consumeResetToken,
};
