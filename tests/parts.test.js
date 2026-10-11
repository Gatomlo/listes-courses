// Plats composes : un plat (Mezze) regroupe d'autres plats (recettes) ; courses additionnees.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');

let server, thomas, lea, h, P = {}, l1, D = {};
before(async () => {
  server = await start();
  ({ thomas, lea, h } = await household());
  const cat = (await thomas.get(h)).data.categories[0].id;
  for (const [k, name, extra] of [['poi', 'Pois chiches', { contenance: '400 g' }], ['cit', 'Citrons'], ['bou', 'Boulgour'], ['per', 'Persil'], ['sel', 'Sel', { is_base: true }], ['pita', 'Pain pita']]) {
    P[k] = (await thomas.post(`${h}/products`, { name, category_id: cat, ...extra })).data.id;
  }
  l1 = (await thomas.post(`${h}/lists`, { date: '2030-03-01', recurring: false })).data.id;
  const dish = async (name, portions, ingredients, extra = {}) => (await thomas.post(`${h}/dishes`, { name, portions, ingredients, ...extra })).data;
  D.hou = await dish('Houmous', 4, [{ product_id: P.poi, qty: 400, unit: 'g' }, { product_id: P.cit, qty: 1 }, { product_id: P.sel }], { steps: 'Mixer' });
  D.tab = await dish('Taboulé', 4, [{ product_id: P.bou, qty: 1 }, { product_id: P.per, qty: 1 }, { product_id: P.cit, qty: 1 }]);
  D.fal = await dish('Falafels', 4, [{ product_id: P.poi, qty: 200, unit: 'g' }]);
});
after(() => server.close());

const list = async () => (await thomas.get(`${h}/lists/${l1}`)).data;
const item = (l, pid) => l.items.find((i) => i.product_id === pid && !i.suggestion);

test('plat compose : enregistrement, fiche, regles', async () => {
  const r = await thomas.post(`${h}/dishes`, { name: 'Mezze libanais', portions: 4, ingredients: [{ product_id: P.pita, qty: 1 }],
    parts: [{ dish_id: D.hou.id, portions: 2 }, { dish_id: D.tab.id }, { dish_id: D.hou.id, portions: 9 }] });
  assert.equal(r.status, 201);
  D.mez = r.data;
  assert.deepEqual(D.mez.parts.map((p) => [p.name, p.portions, p.dish_portions]), [['Houmous', 2, 4], ['Taboulé', 4, 4]]);
  assert.equal(D.mez.parts[0].has_recipe, true);
  assert.deepEqual(D.mez.parts[1].ingredients.map((i) => i.name), ['Boulgour', 'Persil', 'Citrons']);
  assert.deepEqual((await thomas.get(`${h}/dishes/${D.hou.id}`)).data.used_in.map((d) => d.name), ['Mezze libanais']);
  const all = (await thomas.get(`${h}/dishes`)).data;
  assert.equal(all.find((d) => d.id === D.mez.id).parts, 2);
  assert.deepEqual(all.find((d) => d.id === D.mez.id).part_names, ['Houmous', 'Taboulé']);
  // Un seul niveau ; pas de boucle sur soi.
  const bad = (await thomas.post(`${h}/dishes`, { name: 'Apéro', parts: [{ dish_id: D.mez.id }] }));
  assert.equal(bad.status, 400);
  assert.equal((await thomas.put(`${h}/dishes/${D.hou.id}`, { ...D.hou, parts: [{ dish_id: D.fal.id }] })).status, 400);
  assert.equal((await thomas.put(`${h}/dishes/${D.mez.id}`, { ...D.mez, parts: [{ dish_id: D.mez.id }] })).status, 400);
  // Enregistrement sans `parts` : composition inchangee.
  const keep = await thomas.put(`${h}/dishes/${D.mez.id}`, { name: 'Mezze libanais', portions: 4, ingredients: [{ product_id: P.pita, qty: 1 }] });
  assert.equal(keep.data.parts.length, 2);
  // Ajout des falafels.
  D.mez = (await thomas.put(`${h}/dishes/${D.mez.id}`, { name: 'Mezze libanais', portions: 4, ingredients: [{ product_id: P.pita, qty: 1 }],
    parts: [...D.mez.parts, { dish_id: D.fal.id, portions: 4 }] })).data;
  assert.equal(D.mez.parts.length, 3);
});

test('repas : ingredients additionnes, composant ecarte, base', async () => {
  // 8 pers. pour un mezze de 4 : facteur 2 ; houmous 2/4 -> 400 g, taboule x2, falafels 400 g.
  const mid = (await thomas.post(`${h}/meals`, { date: '2030-03-02', slot: 'soir', dish_id: D.mez.id, persons: 8 })).data.id;
  let l = await list();
  assert.equal(item(l, P.poi).meal_qty, 2, '400 g + 400 g = 2 boites de 400 g');
  assert.equal(item(l, P.poi).need, '800 g');
  assert.equal(item(l, P.cit).meal_qty, 3, 'houmous 1 + taboule 2');
  assert.equal(item(l, P.bou).meal_qty, 2);
  assert.equal(item(l, P.pita).meal_qty, 2);
  assert.deepEqual(item(l, P.poi).from, ['Mezze libanais']);
  assert.deepEqual(l.base.map((b) => b.name), ['Sel']);
  const m = l.meals.find((x) => x.id === mid);
  assert.equal(m.has_recipe, true);
  assert.deepEqual(m.parts.map((p) => [p.name, p.skipped]), [['Houmous', false], ['Taboulé', false], ['Falafels', false]]);
  // Pas de taboule cette fois.
  await thomas.patch(`${h}/meals/${mid}`, { part_skip: [D.tab.id, 999999] });
  l = await list();
  assert.equal(item(l, P.bou), undefined);
  assert.equal(item(l, P.cit).meal_qty, 1);
  assert.deepEqual(l.meals.find((x) => x.id === mid).part_skip, [D.tab.id]);
  // Historique : le houmous compte le repas, le taboule ecarte non.
  assert.equal((await thomas.get(`${h}/dishes/${D.hou.id}`)).data.upcoming.length, 1);
  assert.equal((await thomas.get(`${h}/dishes/${D.hou.id}`)).data.upcoming[0].via, 'Mezze libanais');
  assert.equal((await thomas.get(`${h}/dishes/${D.tab.id}`)).data.upcoming.length, 0);
  const all = (await thomas.get(`${h}/dishes`)).data;
  assert.equal(all.find((d) => d.id === D.hou.id).next_date, '2030-03-02');
  assert.equal(all.find((d) => d.id === D.tab.id).next_date, null);
  // Membre : lecture des composants, suggestion avec composant ecarte.
  const sid = (await lea.post(`${h}/meals`, { date: '2030-03-03', slot: 'midi', dish_id: D.mez.id, part_skip: [D.fal.id] })).data.id;
  assert.deepEqual((await lea.get(`${h}/menu?from=2030-03-03&days=1`)).data.meals.find((x) => x.id === sid).part_skip, [D.fal.id]);
  await thomas.del(`${h}/meals/${sid}`);
});

test('suppression : composant retire, plat compose garde ses recettes', async () => {
  await thomas.del(`${h}/dishes/${D.fal.id}`);
  const mez = (await thomas.get(`${h}/dishes/${D.mez.id}`)).data;
  assert.deepEqual(mez.parts.map((p) => p.name), ['Houmous', 'Taboulé']);
  let l = await list();
  assert.equal(item(l, P.poi).meal_qty, 1, 'reste le houmous');
  await thomas.del(`${h}/dishes/${D.mez.id}`);
  assert.equal((await thomas.get(`${h}/dishes/${D.hou.id}`)).status, 200);
  assert.deepEqual((await thomas.get(`${h}/dishes/${D.hou.id}`)).data.used_in, []);
  l = await list();
  assert.equal(item(l, P.poi), undefined);
});
