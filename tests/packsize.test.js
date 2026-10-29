// Prix d'un même produit vendu en formats différents selon le magasin.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');

let server, thomas, h;
before(async () => { server = await start(); ({ thomas, h } = await household()); });
after(() => server.close());

test('relevé avec contenance : prix ramené à la contenance du produit', async () => {
  const f = (await thomas.get(h)).data;
  const [im, co] = f.stores.map((s) => s.id);
  const p = (await thomas.post(`${h}/products`, { name: 'Noix de pécan', category_id: f.categories[0].id, contenance: '100 g' })).data;
  // 100 g à 3,00 € chez IM ; 400 g à 8,00 € chez Colruyt = 2,00 € les 100 g
  await thomas.post(`${h}/products/${p.id}/records`, { store_id: im, price: '3,00' });
  const r = await thomas.post(`${h}/products/${p.id}/records`, { store_id: co, price: '8,00', cont_n: '400', cont_u: 'g' });
  assert.equal(r.data.prices[im].avg, 300);
  assert.equal(r.data.prices[co].avg, 200);
  assert.equal(r.data.best_store_id, co);
  assert.equal(r.data.records[0].cont, '400 g');
});

test('produit sans contenance : la première saisie la définit', async () => {
  const f = (await thomas.get(h)).data;
  const p = (await thomas.post(`${h}/products`, { name: 'Amandes', category_id: f.categories[0].id })).data;
  const r = await thomas.post(`${h}/products/${p.id}/records`, { store_id: f.stores[0].id, price: '2,50', cont_n: '250', cont_u: 'g' });
  assert.equal(r.data.contenance, '250 g');
});

test('liste : petite quantité moins chère dans le petit format, grande quantité dans le grand', async () => {
  const f = (await thomas.get(h)).data;
  const [im, co] = f.stores.map((s) => s.id);
  const p = (await thomas.get(`${h}/products`)).data.find((x) => x.name === 'Noix de pécan');
  const l = (await thomas.post(`${h}/lists`, { date: '2030-01-04', recurring: false })).data;
  const add = async (qty) => (await thomas.post(`${h}/lists/${l.id}/items`, { product_id: p.id, qty })).data;
  await add(1);
  let it = (await thomas.get(`${h}/lists/${l.id}`)).data.items.find((i) => i.product_id === p.id);
  assert.equal(it.best_store_id, im);              // 1 x 100 g : 3,00 € contre un sachet de 400 g à 8,00 €
  assert.equal(it.prices[co] * it.qty, 800);
  assert.equal(it.packs[co].size, '400 g');
  await thomas.patch(`${h}/items/${it.id}`, { qty: 8 });
  it = (await thomas.get(`${h}/lists/${l.id}`)).data.items.find((i) => i.product_id === p.id);
  assert.equal(it.best_store_id, co);              // 800 g : 2 sachets = 16,00 € contre 24,00 €
  assert.equal(it.prices[co] * it.qty, 1600);
});

test('promo avec format et relevé au cochage (opération hors-ligne) avec format', async () => {
  const f = (await thomas.get(h)).data;
  const [im, co] = f.stores.map((s) => s.id);
  const p = (await thomas.get(`${h}/products`)).data.find((x) => x.name === 'Noix de pécan');
  const l = (await thomas.post(`${h}/lists`, { date: '2030-02-01', recurring: false })).data;
  await thomas.post(`${h}/lists/${l.id}/items`, { product_id: p.id, qty: 4 });
  const get = async () => (await thomas.get(`${h}/lists/${l.id}`)).data.items.find((i) => i.product_id === p.id);
  // 400 g : Intermarché 4 x 3,00 = 12,00 € ; Colruyt 1 sachet = 8,00 €
  assert.equal((await get()).best_store_id, co);
  // Promo Intermarché : 400 g à 5,00 € -> 5,00 € pour 4 x 100 g
  await thomas.post(`${h}/promos`, { product_id: p.id, store_id: im, price: '5,00', cont_n: '400', cont_u: 'g', list_id: l.id });
  let it = await get();
  assert.equal(it.best_store_id, im);
  assert.equal(Math.round(it.prices[im] * it.qty), 500);
  assert.equal(it.promos.find((x) => x.store_id === im).cont, '400 g');
  // Relevé au cochage chez Intermarché : 400 g à 7,00 € (hors promo) -> 1,75 € les 100 g
  await thomas.post(`${h}/sync`, { ops: [{ op_id: 'rec-1', type: 'record.add', product_id: p.id, store_id: im, price: '7,00', cont_n: '400', cont_u: 'g' }] });
  const pr = (await thomas.get(`${h}/products/${p.id}`)).data;
  assert.equal(pr.records[0].cont, '400 g');
  assert.equal(pr.prices[im].avg, 238); // moyenne de 300 (100 g) et 175 (400 g ramené à 100 g)
});

test('prix au kg par magasin sur les articles', async () => {
  const f = (await thomas.get(h)).data;
  const [im, co] = f.stores.map((s) => s.id);
  const p = (await thomas.get(`${h}/products`)).data.find((x) => x.name === 'Noix de pécan');
  const l = (await thomas.post(`${h}/lists`, { date: '2030-03-01', recurring: false })).data;
  await thomas.post(`${h}/lists/${l.id}/items`, { product_id: p.id, qty: 1 });
  const it = (await thomas.get(`${h}/lists/${l.id}`)).data.items.find((i) => i.product_id === p.id);
  assert.equal(it.unit_per, 'kg');
  assert.equal(it.unit_prices[co], 2000);              // 8,00 € les 400 g = 20 €/kg
  assert.ok(it.unit_prices[co] < it.unit_prices[im]);   // moins cher au kg chez Colruyt (qui n'est pas conseillé pour 100 g)
  assert.equal(it.best_store_id, im);
});
