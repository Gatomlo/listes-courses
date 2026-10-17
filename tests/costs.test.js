// Budget : cout par personne des plats, palier « Économique » automatique, cout du menu.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');

let server, thomas, lea, h, P = {}, D = {}, st;
before(async () => {
  server = await start();
  ({ thomas, lea, h } = await household());
  const f = (await thomas.get(h)).data;
  const cat = f.categories[0].id;
  st = f.stores.map((s) => s.id);
  // Pates : 500 g a 1,00 € (Intermarché) / 0,80 € (Colruyt) ; sauce : 1 pot a 2,00 € ; fromage : 200 g a 3,00 € ; sel : base ; mystere : sans prix.
  for (const [k, name, extra, prices] of [['pat', 'Pâtes', { contenance: '500 g' }, [100, 80]], ['sau', 'Sauce', {}, [200, null]], ['fro', 'Fromage', { contenance: '200 g' }, [null, 300]],
    ['sel', 'Sel', { is_base: true }, [50, 50]], ['mys', 'Mystère', {}, [null, null]]]) {
    P[k] = (await thomas.post(`${h}/products`, { name, category_id: cat, ...extra })).data.id;
    for (const [i, c] of prices.entries()) if (c) await thomas.post(`${h}/products/${P[k]}/records`, { store_id: st[i], price: (c / 100).toFixed(2).replace('.', ',') });
  }
  const dish = async (name, portions, ingredients, extra = {}) => (await thomas.post(`${h}/dishes`, { name, portions, ingredients, ...extra })).data;
  D.pates = await dish('Pâtes sauce', 4, [{ product_id: P.pat, qty: 400, unit: 'g' }, { product_id: P.sau, qty: 1 }, { product_id: P.sel }]);
  D.gratin = await dish('Gratin', 2, [{ product_id: P.fro, qty: 100, unit: 'g' }, { product_id: P.mys, qty: 1 }]);
  D.duo = await dish('Duo', 4, [{ product_id: P.fro, qty: 200, unit: 'g' }], { parts: [{ dish_id: D.pates.id, portions: 2 }] });
});
after(() => server.close());

const dishes = async () => (await thomas.get(`${h}/dishes`)).data;
const byName = (l, n) => l.find((d) => d.name === n);

test('cout par personne : emballages fractionnaires au prix le plus bas, base exclue', async () => {
  // 400 g de pates = 0,8 paquet a 0,80 € = 0,64 € ; sauce 2,00 € ; sel (base) exclu -> 2,64 € / 4 = 0,66 €
  const d = byName(await dishes(), 'Pâtes sauce');
  assert.equal(d.cost_pp, 66);
  assert.equal(d.cost_partial, false);
  const f = (await thomas.get(`${h}/dishes/${D.pates.id}`)).data;
  assert.equal(f.cost_pp, 66);
  assert.deepEqual(f.ingredients.map((i) => i.cost), [64, 200, null]);
});

test('ingredient sans prix : cout partiel', async () => {
  // fromage 100 g = 0,5 x 3,00 = 1,50 € ; mystere sans prix ; 2 portions -> 0,75 €
  const d = byName(await dishes(), 'Gratin');
  assert.equal(d.cost_pp, 75);
  assert.equal(d.cost_partial, true);
  assert.equal((await thomas.get(`${h}/dishes/${D.gratin.id}`)).data.cost_missing, 1);
});

test('plat compose : ses ingredients + ceux des composants au prorata des portions', async () => {
  // fromage 200 g = 3,00 € ; pates sauce (2 portions sur 4) = 2,64 € x 0,5 = 1,32 € -> 4,32 € / 4 = 1,08 €
  assert.equal(byName(await dishes(), 'Duo').cost_pp, 108);
  const f = (await thomas.get(`${h}/dishes/${D.duo.id}`)).data;
  assert.equal(f.parts[0].cost_pp, 66);
});

test('tag Économique : automatique, selon le palier, jamais saisi', async () => {
  assert.ok(!byName(await dishes(), 'Pâtes sauce').tags.includes('Économique'), 'sans palier');
  let r = await thomas.patch(h, { eco_cents: 100 });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.eco_cents, 100);
  const l = await dishes();
  assert.ok(byName(l, 'Pâtes sauce').tags.includes('Économique'));
  assert.ok(!byName(l, 'Gratin').tags.includes('Économique'), 'cout partiel : pas de tag');
  assert.ok(!byName(l, 'Duo').tags.includes('Économique'), 'au-dessus du palier');
  assert.ok((await thomas.get(`${h}/dishes/${D.pates.id}`)).data.tags.includes('Économique'));
  // saisie manuelle ignoree, tag non renommable
  await thomas.put(`${h}/dishes/${D.duo.id}`, { ...(await thomas.get(`${h}/dishes/${D.duo.id}`)).data, tags: ['Économique', 'Rapide'] });
  assert.deepEqual((await thomas.get(`${h}/dishes/${D.duo.id}`)).data.tags, ['Rapide']);
  const eco = (await thomas.get(`${h}/tags`)).data.find((t) => t.auto);
  assert.equal(eco.dishes, 1);
  const rapide = (await thomas.get(`${h}/tags`)).data.find((t) => t.name === 'Rapide');
  assert.equal((await thomas.patch(`${h}/tags/${rapide.id}`, { name: 'économique' })).status, 409);
  // palier vide = desactive
  r = await thomas.patch(h, { eco_cents: '' });
  assert.equal(r.data.eco_cents, null);
  assert.ok(!byName(await dishes(), 'Pâtes sauce').tags.includes('Économique'));
});

test('cout du menu : repas, personnes, produits en reserve, total', async () => {
  const m1 = (await thomas.post(`${h}/meals`, { date: '2030-06-03', slot: 'soir', dish_id: D.pates.id, persons: 2 })).data;
  const m2 = (await thomas.post(`${h}/meals`, { date: '2030-06-04', slot: 'soir', dish_id: D.gratin.id, persons: 4 })).data;
  const r = (await thomas.get(`${h}/menu?from=2030-06-01&days=10`)).data;
  const a = r.meals.find((m) => m.id === (m1.id ?? m1.meal?.id)), b = r.meals.find((m) => m.id === (m2.id ?? m2.meal?.id));
  assert.ok(a && b, JSON.stringify([m1, m2]).slice(0, 200));
  assert.equal(a.cost, 132); // 0,66 x 2
  assert.equal(b.cost, 300); // 0,75 x 4
  assert.equal(b.cost_partial, true);
  assert.equal(r.cost.total, 432);
  assert.equal(r.cost.partial, true);
  // sauce deja en reserve : retiree du cout
  await thomas.patch(`${h}/meals/${a.id}`, { skip: [P.sau] });
  const r2 = (await thomas.get(`${h}/menu?from=2030-06-01&days=10`)).data;
  assert.equal(r2.meals.find((m) => m.id === a.id).cost, 32);
});
