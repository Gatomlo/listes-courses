// Service worker : l'application s'ouvre sans reseau (magasins sans couverture).
// Portee = dossier de l'app (/cabas/ dans la passerelle). L'API n'est jamais mise en
// cache ici : les donnees hors-ligne sont gerees par l'app (public/app/api.js).
// Changer VERSION quand la liste des fichiers change.
const VERSION = 'cabas-v35';
const FILES = [
  './', 'style.css', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png',
  'app/main.js', 'app/ui.js', 'app/api.js', 'app/state.js', 'app/connexion.js',
  'app/foyer.js', 'app/magasins.js', 'app/install.js', 'app/catalogue.js', 'app/listes.js', 'app/scan.js', 'app/ticket.mjs', 'app/plats.js', 'app/menu.js', 'app/icons.js', 'app/plus.js',
];
// Le lecteur de tickets (vendor/, ~ 6 Mo) est garde a sa premiere utilisation.

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Reseau d'abord (3 s au plus), sinon la copie gardee ; la copie est rafraichie a chaque
// reponse reussie. API et autres sites : pas d'intervention.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  const scope = new URL(self.registration.scope).pathname;
  const key = req.mode === 'navigate' ? scope : req; // la page, quelle que soit l'adresse (#, ?login=...)
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await Promise.race([
        fetch(req),
        new Promise((_, reject) => setTimeout(() => reject(new Error('lent')), 3000)),
      ]);
      if (res.ok) cache.put(key, res.clone());
      return res;
    } catch {
      const hit = await cache.match(key, { ignoreSearch: true });
      if (hit) return hit;
      return fetch(req);
    }
  })());
});
