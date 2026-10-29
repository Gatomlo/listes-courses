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
