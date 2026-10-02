// Importe un panier transcrit (produits + prix) dans un foyer, par l'API.
// Usage : CABAS_URL=http://localhost:3000/cabas CABAS_EMAIL=... CABAS_PASSWORD=... node scripts/import-prices.js scripts/colruyt-2026-10-02.json [--dry]
// Produit existant (meme nom, sans accents ni casse) : seul le releve est ajoute (ignore s'il
// existe deja pour ce magasin, cette date et ce prix : relancer est sans danger). Sinon il est cree
// dans le rayon indique (cree s'il manque). Promo avec prix normal connu : deux releves (promo + normal).
// Exige un compte gestionnaire si des rayons doivent etre crees.
const fs = require('node:fs');

const [file, flag] = process.argv.slice(2);
const dry = flag === '--dry';
const base = (process.env.CABAS_URL || 'http://localhost:3000/cabas').replace(/\/$/, '') + '/api';
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
let cookie = '';

async function call(method, url, body) {
  const res = await fetch(base + url, {
    method, headers: { 'content-type': 'application/json', cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} : ${res.status} ${data.error || ''}`);
  return data;
}

(async () => {
  if (!file) throw new Error('Fichier JSON requis.');
  const cart = JSON.parse(fs.readFileSync(file, 'utf8'));
  const me = await call('POST', '/auth/login', { email: process.env.CABAS_EMAIL, password: process.env.CABAS_PASSWORD });
  const h = `/h/${me.householdId}`;
  const info = await call('GET', h + '/');
  const store = info.stores.find((s) => norm(s.name) === norm(cart.store));
  if (!store) throw new Error(`Magasin « ${cart.store} » introuvable dans le foyer.`);
  const cats = new Map(info.categories.map((c) => [norm(c.name), c.id]));
  const products = new Map((await call('GET', h + '/products')).map((p) => [norm(p.name), p.id]));
  let created = 0, records = 0;

  for (const it of cart.items) {
    let pid = products.get(norm(it.name));
    if (!pid) {
      let cid = cats.get(norm(it.rayon));
      if (!cid && !dry) {
        const r = await call('POST', h + '/categories', { name: it.rayon });
        cid = r.categories.find((c) => norm(c.name) === norm(it.rayon)).id;
        cats.set(norm(it.rayon), cid);
      }
      if (!dry) pid = (await call('POST', h + '/products', { name: it.name, category_id: cid, unit: it.unit, contenance: it.contenance })).id;
      created++;
      console.log(`+ ${it.name} (${it.rayon})`);
    }
    const recs = [{ price: it.prix, promo: !!it.promo }];
    if (it.promo && it.normal) recs.push({ price: it.normal, promo: false });
    // Deja importe (meme magasin, date et prix) : on ne double pas le releve.
    const known = pid ? (await call('GET', `${h}/products/${pid}`)).records : [];
    for (const r of recs) {
      if (known.some((k) => k.store_id === store.id && k.date === cart.date && k.price_cents === Math.round(r.price * 100))) continue;
      if (!dry) await call('POST', `${h}/products/${pid}/records`, { store_id: store.id, date: cart.date, source: 'manual', ...r });
      records++;
    }
  }
  console.log(`${dry ? '[essai] ' : ''}${created} produit(s) créé(s), ${records} relevé(s) chez ${store.name}.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
