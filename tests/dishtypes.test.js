// Types de plats (gestion depuis le foyer), modeles de semaine et regles de generation.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');

let server, thomas, lea, h;
before(async () => { server = await start(); ({ thomas, lea, h } = await household()); });
after(() => server.close());

const addDays = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const type = async (name) => (await thomas.get(`${h}/types`)).data.find((t) => t.name === name);
const typesOf = async (name) => (await thomas.get(`${h}/dishes`)).data.find((d) => d.name === name).types;

test('types : création, plats, renommer, fusionner, supprimer, droits', async () => {
  assert.equal((await thomas.post(`${h}/types`, { name: 'Poisson' })).status, 201);
  assert.equal((await thomas.post(`${h}/types`, { name: ' poisson ' })).status, 409);
  assert.equal((await lea.post(`${h}/types`, { name: 'Riz' })).status, 403);
  const d = (await thomas.post(`${h}/dishes`, { name: 'Paella', types: ['Riz', 'POISSON', 'Fruits de mer'] })).data;
  assert.deepEqual(d.types, ['Fruits de mer', 'Poisson', 'Riz']);
  assert.equal((await type('Riz')).dishes, 1);
  assert.deepEqual((await thomas.get(h)).data.types.map((t) => t.name), ['Fruits de mer', 'Poisson', 'Riz']);

  // Modèle utilisant « Fruits de mer » : la fusion reporte la règle sur « Poisson ».
  const fdm = await type('Fruits de mer'), poisson = await type('Poisson');
  let m = (await thomas.post(`${h}/menu-models`, { name: 'Semaine', rules: [{ type_id: fdm.id, n: 1, mode: 'exact', slot: 'soir' }, { type_id: 999, n: 2 }] })).data;
  assert.deepEqual(m[0].rules, [{ type_id: fdm.id, type: 'Fruits de mer', n: 1, mode: 'exact', slot: 'soir' }]);
  assert.equal((await lea.post(`${h}/types/${fdm.id}/merge`, { into: poisson.id })).status, 403);
  await thomas.post(`${h}/types/${fdm.id}/merge`, { into: poisson.id });
  assert.deepEqual(await typesOf('Paella'), ['Poisson', 'Riz']);
  m = (await thomas.get(`${h}/menu-models`)).data;
  assert.equal(m[0].rules[0].type, 'Poisson');

  // Renommer vers un nom existant = fusion ; renommer simple.
  await thomas.patch(`${h}/types/${(await type('Riz')).id}`, { name: 'poisson' });
  assert.deepEqual(await typesOf('Paella'), ['Poisson']);
  await thomas.patch(`${h}/types/${poisson.id}`, { name: 'Poissons' });
  assert.deepEqual(await typesOf('Paella'), ['Poissons']);
  // Enregistrer sans « types » : inchangés.
  await thomas.put(`${h}/dishes/${d.id}`, { name: 'Paella' });
  assert.deepEqual(await typesOf('Paella'), ['Poissons']);

  // Suppression : retiré des plats et des modèles.
  await thomas.del(`${h}/types/${poisson.id}`);
  assert.deepEqual(await typesOf('Paella'), []);
  assert.deepEqual((await thomas.get(`${h}/menu-models`)).data[0].rules, []);
  await thomas.put(`${h}/menu-models/${m[0].id}`, { name: 'Semaine type', rules: [] });
  assert.equal((await thomas.get(`${h}/menu-models`)).data[0].name, 'Semaine type');
  await thomas.del(`${h}/menu-models/${m[0].id}`);
  assert.equal((await thomas.get(`${h}/menu-models`)).data.length, 0);
  await thomas.del(`${h}/dishes/${d.id}`);
});

test('génération avec un modèle : exactement, au plus, règle non tenue, prorata', async () => {
  const dishes = [['Saumon', ['Poisson']], ['Cabillaud', ['Poisson']], ['Carbonara', ['Pâtes']], ['Bolo', ['Pâtes']], ['Lasagne', ['Pâtes']],
    ['Curry', ['Riz', 'Poulet']], ['Rôti', ['Porc']], ['Côtelettes', ['Porc']], ['Omelette', []]];
  for (const [name, types] of dishes) await thomas.post(`${h}/dishes`, { name, types, slots: ['soir'] });
  const id = async (n) => (await type(n)).id;
  const rules = [{ type_id: await id('Poisson'), n: 1, mode: 'exact' }, { type_id: await id('Pâtes'), n: 2, mode: 'exact' },
    { type_id: await id('Porc'), n: 1, mode: 'max' }, { type_id: await id('Riz'), n: 2, mode: 'exact', slot: 'soir' }];
  const from = addDays(14), to = addDays(20);
  const g = (await thomas.post(`${h}/menu/generate`, { from, to, slots: ['soir'], gap_days: 30, rules })).data;
  const n = (t) => g.meals.filter((m) => m.types.includes(t)).length;
  assert.equal(n('Poisson'), 1);
  assert.equal(n('Pâtes'), 2);
  assert.equal(n('Porc'), 1);
  assert.equal(n('Riz'), 1);
  assert.equal(g.meals.length, 6); // Saumon|Cabillaud, 2 pâtes, Curry, 1 porc, Omelette
  assert.equal(g.empty.length, 1);
  assert.deepEqual(g.unmet, [{ week: from, type: 'Riz', slot: 'soir', want: 2, got: 1 }]);

  // Repas déjà prévu : compte dans la règle de sa semaine.
  const bolo = (await thomas.get(`${h}/dishes`)).data.find((d) => d.name === 'Bolo');
  await thomas.post(`${h}/meals`, { date: from, slot: 'midi', dish_id: bolo.id });
  const g2 = (await thomas.post(`${h}/menu/generate`, { from, to, slots: ['soir'], gap_days: 30, rules })).data;
  assert.equal(g2.meals.filter((m) => m.types.includes('Pâtes')).length, 1);

  // Dernière tranche de 3 jours : 2 pâtes × 3/7 -> 1.
  const g3 = (await thomas.post(`${h}/menu/generate`, { from: addDays(30), to: addDays(39), slots: ['soir'], gap_days: 0, rules: [rules[1]] })).data;
  const wk2 = g3.meals.filter((m) => m.date >= addDays(37));
  assert.equal(g3.meals.filter((m) => m.date < addDays(37) && m.types.includes('Pâtes')).length, 2);
  assert.equal(wk2.filter((m) => m.types.includes('Pâtes')).length, 1);
});

test('import CSV : colonne types (création, complément d\'un plat connu)', async () => {
  const csv = 'nom;types;repas\nRisotto;Riz, Végé;soir\nSaumon;Four;\n';
  const r = (await thomas.post(`${h}/dishes/import`, { csv })).data;
  assert.deepEqual([r.created, r.updated], [['Risotto'], ['Saumon']]);
  assert.deepEqual(await typesOf('Risotto'), ['Riz', 'Végé']);
  assert.deepEqual(await typesOf('Saumon'), ['Four', 'Poisson']);
});
