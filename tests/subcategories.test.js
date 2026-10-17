// Sous-rayons : appartiennent a un rayon, produits, ordre par magasin, import CSV.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');

let server, thomas, lea, h;
before(async () => { server = await start(); ({ thomas, lea, h } = await household()); });
after(() => server.close());

test('sous-rayons : creation, produit, ordre par magasin, suppression', async () => {
  const house = (await thomas.get(h)).data;
  const [c1, c2] = house.categories;
  assert.equal((await lea.post(`${h}/subcategories`, { category_id: c1.id, name: 'Pâtes' })).status, 403);
  assert.equal((await thomas.post(`${h}/subcategories`, { category_id: c1.id, name: '' })).status, 400);
  let r = (await thomas.post(`${h}/subcategories`, { category_id: c1.id, name: 'Pâtes' })).data;
  assert.equal((await thomas.post(`${h}/subcategories`, { category_id: c1.id, name: 'pâtes' })).status, 409);
  await thomas.post(`${h}/subcategories`, { category_id: c1.id, name: 'Conserves' });
  r = (await thomas.get(h)).data;
  const subs = r.categories.find((c) => c.id === c1.id).subs;
  assert.deepEqual(subs.map((s) => s.name), ['Pâtes', 'Conserves']);

  // Produit : sous-rayon du bon rayon seulement ; changer de rayon l'efface.
  const p = (await thomas.post(`${h}/products`, { name: 'Spaghetti', category_id: c1.id, subcategory_id: subs[0].id })).data;
  assert.equal(p.subcategory_id, subs[0].id);
  assert.equal((await thomas.post(`${h}/products`, { name: 'Faux', category_id: c2.id, subcategory_id: subs[0].id })).status, 400);
  const moved = (await thomas.patch(`${h}/products/${p.id}`, { category_id: c2.id })).data;
  assert.equal(moved.subcategory_id, null);

  // Liste unique des formulaires : « rayon » = « cid » ou « cid:sid ».
  const q = (await thomas.post(`${h}/products`, { name: 'Penne', rayon: `${c1.id}:${subs[0].id}` })).data;
  assert.deepEqual([q.category_id, q.subcategory_id], [c1.id, subs[0].id]);
  assert.equal((await thomas.patch(`${h}/products/${q.id}`, { rayon: `${c1.id}` })).data.subcategory_id, null);

  // Ordre des sous-rayons dans un magasin.
  const sid = r.stores[0].id;
  let st = (await thomas.put(`${h}/stores/${sid}/suborder`, { category_id: c1.id, ids: [subs[1].id, subs[0].id] })).data;
  assert.deepEqual(st.find((s) => s.id === sid).subOrder, [subs[1].id, subs[0].id]);
  assert.equal((await thomas.put(`${h}/stores/${sid}/suborder`, { category_id: c2.id, ids: [subs[0].id] })).status, 400);

  // Suppression : le produit reste, sans sous-rayon.
  await thomas.patch(`${h}/products/${p.id}`, { category_id: c1.id, subcategory_id: subs[0].id });
  await thomas.del(`${h}/subcategories/${subs[0].id}`);
  assert.equal((await thomas.get(`${h}/products/${p.id}`)).data.subcategory_id, null);
});

test('import CSV : colonne sous-rayon', async () => {
  const csv = 'nom;rayon;sous-rayon\nRiz basmati;Épicerie;Pâtes, riz\nLentilles;Épicerie;Pâtes, riz\n';
  const r = (await thomas.post(`${h}/products/import`, { csv })).data;
  assert.equal(r.created.length, 2);
  const house = (await thomas.get(h)).data;
  const cat = house.categories.find((c) => c.name === 'Épicerie');
  assert.deepEqual(cat.subs.map((s) => s.name), ['Pâtes, riz']);
});
