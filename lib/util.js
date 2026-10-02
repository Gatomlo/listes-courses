// Utilitaires communs du serveur : erreurs HTTP, lecture des saisies, limiteur de debit.

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function str(v, max = 200) {
  const s = v == null ? '' : String(v).trim();
  return s.slice(0, max);
}

function intOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Prix saisi ("1,99", "1.99", 1.99) -> centimes entiers, ou null si invalide.
function cents(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 100) : null;
}

// Date AAAA-MM-JJ valide, sinon null.
function isoDate(v) {
  const s = String(v || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
}

const today = () => new Date().toISOString().slice(0, 10);

// Gestionnaire de route asynchrone : une erreur (ou promesse rejetee) va a next().
const asyncHandler = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);

// Compteur d'evenements par cle sur une fenetre glissante (demandes de lien de connexion).
function limiter(windowMs) {
  const hits = new Map();
  const recent = (key) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length) hits.set(key, list); else hits.delete(key);
    return list;
  };
  return {
    count: (key) => recent(key).length,
    hit: (key) => { hits.set(key, recent(key).concat(Date.now())); },
    clear: () => hits.clear(),
  };
}

module.exports = { httpError, str, intOrNull, cents, isoDate, today, asyncHandler, limiter };
