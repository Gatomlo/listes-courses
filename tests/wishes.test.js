// Envies de plats sans date : propositions des membres, fiches brouillon, validation.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');

let server, thomas, lea, h;
before(async () => { server = await start(); ({ thomas, lea, h } = await household()); });
after(() => server.close());

const dishByName = async (n) => (await thomas.get(`${h}/dishes`)).data.find((d) => d.name === n);

test('envies : membre en attente, brouillon modifiable par son auteur, valide par un gestionnaire', async () => {
  const bolo = (await thomas.post(`${h}/dishes`, { name: 'Bolo', portions: 4, ingredients: [] })).data.id;
  const count = async () => (await thomas.get(h)).data.wishesPending;

  let w = (await lea.post(`${h}/wishes`, { dish_id: bolo })).data;
  assert.deepEqual(w.map((x) => [x.name, x.status, x.draft]), [['Bolo', 'pending', 0]]);
  assert.equal((await lea.post(`${h}/wishes`, { name: ' bolo ' })).status, 409);

  // Nom libre : fiche brouillon creee, visible dans les plats.
  w = (await lea.post(`${h}/wishes`, { name: 'Tartiflette' })).data;
  const tarti = w.find((x) => x.name === 'Tartiflette');
  assert.equal(tarti.draft, 1);
  assert.equal((await dishByName('Tartiflette')).draft, 1);
  assert.equal(await count(), 2);
  assert.ok(!(await thomas.get(`${h}/suggestions`)).data.some((s) => s.kind === 'wish'));

  // L'auteur complete son brouillon ; pas un autre plat ; enregistrement membre = toujours brouillon.
  assert.equal((await lea.put(`${h}/dishes/${tarti.dish_id}`, { name: 'Tartiflette', portions: 6, ingredients: [], notes: 'Reblochon' })).status, 200);
  assert.equal((await lea.put(`${h}/dishes/${bolo}`, { name: 'Bolo', portions: 4, ingredients: [] })).status, 403);
  assert.equal((await dishByName('Tartiflette')).draft, 1);

  // Gestionnaire : valider un plat existant ; enregistrer le brouillon = valider.
  assert.equal((await lea.post(`${h}/wishes/${w[0].id}/accept`)).status, 403);
  await thomas.post(`${h}/wishes/${w.find((x) => x.name === 'Bolo').id}/accept`);
  await thomas.put(`${h}/dishes/${tarti.dish_id}`, { name: 'Tartiflette', portions: 6, ingredients: [] });
  assert.equal((await dishByName('Tartiflette')).draft, 0);
  w = (await thomas.get(`${h}/wishes`)).data;
  assert.deepEqual(w.map((x) => [x.name, x.status]), [['Bolo', 'ok'], ['Tartiflette', 'ok']]);
  assert.equal(await count(), 0);
  assert.equal((await lea.put(`${h}/dishes/${tarti.dish_id}`, { name: 'Tartiflette', portions: 4, ingredients: [] })).status, 403);
});

test('envies : refus d un brouillon = fiche supprimee ; planifier = valider', async () => {
  let w = (await lea.post(`${h}/wishes`, { name: 'Chili' })).data;
  const chili = w.find((x) => x.name === 'Chili');
  const mid = (await lea.post(`${h}/meals`, { date: '2030-03-10', slot: 'soir', dish_id: chili.dish_id })).data.id;
  assert.ok(mid);
  await thomas.del(`${h}/wishes/${chili.id}`);
  assert.equal(await dishByName('Chili'), undefined);
  assert.equal((await thomas.get(`${h}/menu?from=2030-03-10&days=1`)).data.meals.length, 0);

  w = (await lea.post(`${h}/wishes`, { name: 'Curry' })).data;
  const curry = w.find((x) => x.name === 'Curry');
  await thomas.post(`${h}/meals`, { date: '2030-03-11', slot: 'soir', dish_id: curry.dish_id });
  assert.equal((await dishByName('Curry')).draft, 0);
  assert.ok(!(await thomas.get(`${h}/wishes`)).data.some((x) => x.name === 'Curry'));

  // Gestionnaire : nom libre = fiche normale, envie validee ; retiree a la suppression du plat.
  w = (await thomas.post(`${h}/wishes`, { name: 'Soupe' })).data;
  const soupe = w.find((x) => x.name === 'Soupe');
  assert.deepEqual([soupe.status, soupe.draft], ['ok', 0]);
  await thomas.del(`${h}/dishes/${soupe.dish_id}`);
  assert.ok(!(await thomas.get(`${h}/wishes`)).data.some((x) => x.name === 'Soupe'));
  // Membre : retire sa propre envie en attente (brouillon supprime).
  w = (await lea.post(`${h}/wishes`, { name: 'Gaufres' })).data;
  assert.equal((await lea.del(`${h}/wishes/${w.find((x) => x.name === 'Gaufres').id}`)).status, 200);
  assert.equal(await dishByName('Gaufres'), undefined);
});

test('envies : plat déjà placé au menu = plus une envie', async () => {
  const d = (await thomas.post(`${h}/dishes`, { name: 'Moules' })).data.id;
  const e = (await thomas.post(`${h}/dishes`, { name: 'Frites' })).data.id;
  const day = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  // Déjà au menu : refus.
  await thomas.post(`${h}/meals`, { date: day, slot: 'soir', dish_id: d });
  const r = await lea.post(`${h}/wishes`, { dish_id: d });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /déjà au menu/);
  // « Changer de plat » vers une envie : l'envie disparaît.
  await thomas.post(`${h}/wishes`, { dish_id: e });
  const mid = (await thomas.get(`${h}/menu?from=${day}&days=1`)).data.meals[0].id;
  await thomas.patch(`${h}/meals/${mid}`, { dish_id: e });
  assert.ok(!(await thomas.get(`${h}/wishes`)).data.some((w) => w.dish_id === e));
});
