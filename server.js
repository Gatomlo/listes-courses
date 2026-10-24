// Le Cabas : serveur Express. Seul (npm start, PORT) ou monte dans node-gateway sur
// /cabas (dossier apps/cabas) : le module exporte l'app, et n'ecoute un port ou
// n'installe de gestionnaire global que s'il est lance directement.
const fs = require('fs');
const path = require('path');
const express = require('express');
const security = require('./lib/security');
const auth = require('./lib/auth');
const { router } = require('./lib/api');

if (require.main === module) {
  const fatal = (kind) => (err) => { console.error(`${kind} :`, err); process.exit(1); };
  process.on('uncaughtException', fatal('Erreur non interceptee'));
  process.on('unhandledRejection', fatal('Promesse rejetee non geree'));
}

const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

app.disable('x-powered-by');
app.use(security.headers);
app.use(express.json({ limit: '5mb' })); // photos des plats (redimensionnees par l'appareil)

// Interface : fichiers toujours revalides (304 si inchanges), sauf la page elle-meme.
app.use(express.static(PUBLIC_DIR, { index: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));

// Lecture des tickets (Tesseract.js) servie par l'app elle-meme, sans site externe :
// bibliotheque, moteur WebAssembly et donnees de langue francaise (paquets npm versionnes).
const NM = path.join(__dirname, 'node_modules');
const vendor = (dir) => express.static(path.join(NM, dir), { index: false, maxAge: '30d' });
app.use('/vendor/pdfjs', vendor('pdfjs-dist/build'));
app.use('/vendor/tesseract', vendor('tesseract.js/dist'));
app.use('/vendor/tesseract-core', vendor('tesseract.js-core'));
app.use('/vendor/tessdata', vendor('@tesseract.js-data/fra/4.0.0_best_int'));

app.use('/api', auth.loadUser, security.jsonOnly, router());
app.use('/api', (req, res) => res.status(404).json({ error: 'Adresse inconnue.' }));
app.use('/api', (err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;
  // expose : echec attendu (site distant...) -> message montre, une ligne au journal.
  if (err.expose) console.warn(`${req.method} ${req.originalUrl} : ${err.message}`);
  else if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.expose ? 'Erreur interne du serveur.' : err.message });
});

// Page unique (navigation par #). <base> = racine de l'app, pour des chemins relatifs
// valables seuls comme sous /cabas.
app.get('/', (req, res) => {
  security.pagePolicy(res);
  const root = auth.rootPath(req).replace(/[<>"&]/g, '');
  res.set('Cache-Control', 'no-cache').type('html').send(INDEX.replace(/\{\{ROOT\}\}/g, root));
});

// Rappels de la veille (notifications) : verification chaque minute (CABAS_PUSH=off : aucun).
require('./lib/push').start();

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Le Cabas : http://localhost:${PORT}/`));
}

module.exports = app;
