// En-tetes de securite. Sur toutes les reponses : pas de deduction du type de contenu,
// pas d'adresse d'origine transmise. Sur la page : politique de contenu (CSP) qui
// n'autorise que les scripts de l'application (aucun script ni onclick en ligne).
function headers(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  next();
}

function pagePolicy(res) {
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    // wasm-unsafe-eval : lecture des tickets (Tesseract.js, WebAssembly).
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; '));
}

// Les POST/PUT/PATCH doivent etre en JSON : un formulaire d'un autre site ne peut pas
// en envoyer sans CORS (protection CSRF, avec le cookie SameSite=Lax).
function jsonOnly(req, res, next) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method) || req.is('application/json')) return next();
  res.status(415).json({ error: 'Requête JSON attendue.' });
}

module.exports = { headers, pagePolicy, jsonOnly };
