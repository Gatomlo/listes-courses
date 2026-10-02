// Variantes de plats : groupes d'options, choix par repas, ingredients dans la liste.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');

let server, thomas, lea, h, P = {}, l1, stoemp;
before(async () => {
  server = await start();
  ({ thomas, lea, h } = await household());
  const cat = (await thomas.get(h)).data.categories[0].id;
  for (const [k, name] of [['pdt', 'Pommes de terre'], ['car', 'Carottes'], ['oig', 'Oignons'], ['epi', 'Épinards'], ['pain', 'Pain de viande'], ['sau', 'Saucisse']]) {
    P[k] = (await thomas.post(`${h}/products`, { name, category_id: cat })).data.id;
  }
  l1 = (await thomas.post(`${h}/lists`, { date: '2030-02-01', recurring: false })).data.id;
});
after(() => server.close());

const list = async () => (await thomas.get(`${h}/lists/${l1}`)).data;
const names = (l) => l.items.filter((i) => !i.suggestion).map((i) => i.name).sort();

test('plat a variantes : enregistrement, fiche, ids conserves', async () => {
  const r = await thomas.post(`${h}/dishes`, { name: 'Stoemp', ingredients: [{ product_id: P.pdt, qty: 1 }], groups: [
    { name: 'Légume', options: [{ name: 'carottes', ingredients: [{ product_id: P.car, qty: 1 }] }, { name: 'oignons', ingredients: [{ product_id: P.oig, qty: 1 }] }, { name: 'épinards', ingredients: [{ product_id: P.epi, qty: 1 }] }] },
    { name: 'Viande', options: [{ name: 'pain de viande', ingredients: [{ product_id: P.pain, qty: 1 }] }, { name: 'saucisse', ingredients: [{ product_id: P.sau, qty: 1 }] }] },
    { name: 'Vide', options: [{ name: '' }] }] });
  assert.equal(r.status, 201);
  stoemp = r.data;
  assert.deepEqual(stoemp.ingredients.map((i) => i.name), ['Pommes de terre']);
  assert.deepEqual(stoemp.groups.map((g) => [g.name, g.options.map((o) => o.name)]), [['Légume', ['carottes', 'oignons', 'épinards']], ['Viande', ['pain de viande', 'saucisse']]]);
  assert.equal((await thomas.post(`${h}/dishes`, { name: 'X', groups: [{ name: 'A', options: [{ name: 'a' }] }, { name: 'a', options: [{ name: 'b' }] }] })).status, 400);
});

test('repas : choix des variantes -> ingredients et libelle ; defaut = 1re option', async () => {
  const opt = (g, k) => stoemp.groups[g].options[k].id;
  const mid = (await thomas.post(`${h}/meals`, { date: '2030-02-02', slot: 'soir', dish_id: stoemp.id, persons: 4, options: [opt(0, 2), opt(1, 1)] })).data.id;
  let l = await list();
  assert.deepEqual(names(l), ['Pommes de terre', 'Saucisse', 'Épinards']);
  assert.equal(l.meals[0].dish, 'Stoemp · épinards, saucisse');
  // Sans choix : premiere option de chaque groupe.
  await thomas.post(`${h}/meals`, { date: '2030-02-03', slot: 'soir', dish_id: stoemp.id, persons: 4 });
  l = await list();
  assert.equal(l.meals[1].dish, 'Stoemp · carottes, pain de viande');
  assert.deepEqual(names(l), ['Carottes', 'Pain de viande', 'Pommes de terre', 'Saucisse', 'Épinards']);
  // Changement de variante d'un repas.
  await thomas.patch(`${h}/meals/${mid}`, { options: [opt(0, 1), opt(1, 1)] });
  l = await list();
  assert.ok(names(l).includes('Oignons') && !names(l).includes('Épinards'));
  // Option retiree du plat : le repas retombe sur la premiere option du groupe.
  const g = stoemp.groups.map((x) => ({ name: x.name, options: x.options.map((o) => ({ id: o.id, name: o.name, ingredients: o.ingredients })) }));
  g[0].options.splice(1, 1);
  const r = await thomas.put(`${h}/dishes/${stoemp.id}`, { name: 'Stoemp', ingredients: stoemp.ingredients, groups: g });
  assert.equal(r.data.groups[0].options[0].id, opt(0, 0), 'ids conserves');
  l = await list();
  assert.equal(l.meals[0].dish, 'Stoemp · carottes, saucisse');
  assert.ok(!names(l).includes('Oignons'));
  // Suggestion d'un membre avec variante.
  const sid = (await lea.post(`${h}/meals`, { date: '2030-02-04', slot: 'midi', dish_id: stoemp.id, options: [opt(1, 1)] })).data.id;
  const m = (await lea.get(`${h}/menu?from=2030-02-04&days=1`)).data.meals.find((x) => x.id === sid);
  assert.equal(m.dish, 'Stoemp · carottes, saucisse');
});
