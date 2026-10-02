// Etape 3 : magasin conseille, choix manuel, scenarios, economie, promos.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');

let server, thomas, lea, h, im, co, lid, P = {};
before(async () => {
  server = await start();
  ({ thomas, lea, h } = await household());
  const f = (await thomas.get(h)).data;
  [im, co] = f.stores.map((s) => s.id);
  const cat = f.categories[0].id;
  // [nom, prix Intermarche, prix Colruyt]
  for (const [k, name, pi, pc] of [['hache', 'Haché', '4,20', '4,65'], ['cafe', 'Café', '6,49', '5,79'], ['pq', 'Papier toilette', '6,99', '5,99'], ['poir', 'Poireaux', '0,89', null], ['new', 'Nouveau', null, null]]) {
    P[k] = (await thomas.post(`${h}/products`, { name, category_id: cat })).data.id;
    if (pi) await thomas.post(`${h}/products/${P[k]}/records`, { store_id: im, price: pi });
    if (pc) await thomas.post(`${h}/products/${P[k]}/records`, { store_id: co, price: pc });
  }
  lid = (await thomas.post(`${h}/lists`, { date: '2030-01-04', recurring: false })).data.id;
  for (const [k, qty] of [['hache', 2], ['cafe', 1], ['pq', 1], ['poir', 2], ['new', 1]]) await thomas.post(`${h}/lists/${lid}/items`, { product_id: P[k], qty });
});
after(() => server.close());

const get = async () => (await thomas.get(`${h}/lists/${lid}`)).data;
const item = (l, k) => l.items.find((i) => i.product_id === P[k]);

test('magasin conseille par article ; produit sans prix -> magasin principal', async () => {
  const l = await get();
  assert.equal(item(l, 'hache').best_store_id, im);
  assert.equal(item(l, 'cafe').best_store_id, co);
  assert.equal(item(l, 'poir').best_store_id, im, 'seul prix connu');
  assert.equal(item(l, 'new').best_store_id, null);
  assert.equal(item(l, 'new').at_store_id, im, 'magasin principal');
  assert.equal(l.pricing.noPrice, 1);
});

test('scenarios et economie', async () => {
  const p = (await get()).pricing;
  const s = Object.fromEntries(p.stores.map((x) => [x.id, x]));
  // Intermarche : 2*420 + 649 + 699 + 2*89 = 2366 ; Colruyt : 2*465 + 579 + 599 + 2*89 (inconnu -> 89) = 2286
  assert.equal(s[im].total, 2366);
  assert.equal(s[co].total, 2286);
  assert.equal(s[co].unknown, 2, 'poireaux et nouveau');
  // Repartition : 840 + 579 + 599 + 178 = 2196 ; economie vs Colruyt = 90
  assert.equal(p.split, 2196);
  assert.equal(p.monoStoreId, co);
  assert.equal(p.saving, 90);
  assert.equal(p.recommendSplit, false, 'sous le seuil de 5 EUR');
  assert.equal(s[im].items + s[co].items, 5);
});

test('choix manuel du magasin (membre aussi), retour au conseil, tout chez un magasin', async () => {
  let l = await get();
  let r = await lea.patch(`${h}/items/${item(l, 'cafe').id}`, { store_id: im });
  assert.equal(r.status, 200);
  assert.equal(item(r.data, 'cafe').at_store_id, im);
  assert.equal(item(r.data, 'cafe').manual_store, true);
  r = await lea.patch(`${h}/items/${item(l, 'cafe').id}`, { store_id: null });
  assert.equal(item(r.data, 'cafe').at_store_id, co);
  assert.equal((await lea.post(`${h}/lists/${lid}/assign`, { store_id: co })).status, 403);
  r = await thomas.post(`${h}/lists/${lid}/assign`, { store_id: co });
  assert.ok(r.data.items.every((i) => i.at_store_id === co));
  assert.equal(r.data.pricing.split, r.data.pricing.stores.find((s) => s.id === co).total);
  r = await thomas.post(`${h}/lists/${lid}/assign`, { store_id: null });
  assert.equal(item(r.data, 'hache').at_store_id, im);
});

test('magasin desactive : ses articles reviennent au conseil', async () => {
  let l = await get();
  await thomas.patch(`${h}/items/${item(l, 'hache').id}`, { store_id: co });
  await thomas.patch(`${h}/stores/${co}`, { active: false });
  l = await get();
  assert.equal(item(l, 'hache').at_store_id, im);
  assert.equal(l.pricing.stores.length, 1);
  await thomas.patch(`${h}/stores/${co}`, { active: true });
  assert.equal(item(await get(), 'hache').at_store_id, co, 'choix retrouve a la reactivation');
  await thomas.patch(`${h}/items/${item(l, 'hache').id}`, { store_id: null });
});

test('promo pour cette sortie : remplace la moyenne, change le conseil', async () => {
  const r = await lea.post(`${h}/promos`, { product_id: P.hache, store_id: co, price: '3,49', list_id: lid, note: 'Dépliant' });
  assert.equal(r.status, 201);
  let l = await get();
  assert.equal(item(l, 'hache').prices[co], 349);
  assert.equal(item(l, 'hache').best_store_id, co);
  assert.equal(item(l, 'hache').promos[0].note, 'Dépliant');
  // Autre liste : la promo ne s'applique pas
  const other = (await thomas.post(`${h}/lists`, { date: '2030-01-19', recurring: false })).data.id;
  await thomas.post(`${h}/lists/${other}/items`, { product_id: P.hache });
  const o = (await thomas.get(`${h}/lists/${other}`)).data;
  assert.equal(o.items[0].prices[co], 465);
});

test('promo datee, sans prix (rappel), remplacement, suppression ; releve promo hors moyenne', async () => {
  let r = await thomas.post(`${h}/promos`, { product_id: P.cafe, store_id: im, valid_until: '2030-01-10' });
  assert.equal(r.status, 201);
  let l = await get();
  assert.equal(item(l, 'cafe').prices[im], 649, 'sans prix : moyenne gardee');
  assert.equal(item(l, 'cafe').promos.length, 1);
  r = await thomas.post(`${h}/promos`, { product_id: P.cafe, store_id: im, price: '4,99', valid_until: '2030-01-10' });
  assert.equal(r.data.filter((p) => p.product_id === P.cafe).length, 1, 'remplacee');
  l = await get();
  assert.equal(item(l, 'cafe').best_store_id, im);
  // Expiree pour une liste plus tardive
  const late = (await thomas.post(`${h}/lists`, { date: '2030-02-01', recurring: false })).data.id;
  await thomas.post(`${h}/lists/${late}/items`, { product_id: P.cafe });
  assert.equal((await thomas.get(`${h}/lists/${late}`)).data.items[0].prices[im], 649);
  const promo = r.data.find((p) => p.product_id === P.cafe);
  await thomas.del(`${h}/promos/${promo.id}`);
  assert.equal(item(await get(), 'cafe').prices[im], 649);
  assert.equal((await thomas.post(`${h}/promos`, { product_id: P.cafe, store_id: im })).status, 400, 'portee obligatoire');
  // Releve marque promo : exclu de la moyenne
  await thomas.post(`${h}/products/${P.pq}/records`, { store_id: co, price: '1,00', promo: true });
  assert.equal(item(await get(), 'pq').prices[co], 599);
});

test('fiche produit : promos en cours', async () => {
  const p = (await thomas.get(`${h}/products/${P.hache}`)).data;
  assert.equal(p.promos.length, 1);
  assert.equal(p.promos[0].price_cents, 349);
});
