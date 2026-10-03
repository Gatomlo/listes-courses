// Envies de plats sans date : propositions des membres, validation, creation de fiche.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');

let server, thomas, lea, h;
before(async () => { server = await start(); ({ thomas, lea, h } = await household()); });
after(() => server.close());

test('envies : membre en attente, gestionnaire valide, fiche creee, retiree une fois au menu', async () => {
  const bolo = (await thomas.post(`${h}/dishes`, { name: 'Bolo', portions: 4, ingredients: [] })).data.id;
  const pending = async () => (await thomas.get(h)).data.pending;
  const p0 = await pending();

  // Membre : plat existant et nom libre (un nom deja connu devient le plat).
  let w = (await lea.post(`${h}/wishes`, { dish_id: bolo })).data;
  assert.deepEqual(w.map((x) => [x.name, x.status]), [['Bolo', 'pending']]);
  assert.equal((await lea.post(`${h}/wishes`, { name: ' bolo ' })).status, 409);
  w = (await lea.post(`${h}/wishes`, { name: 'Tartiflette' })).data;
  const tarti = w.find((x) => x.name === 'Tartiflette');
  assert.equal(tarti.dish_id, null);
  assert.equal(await pending(), p0 + 2);
  assert.ok((await thomas.get(`${h}/suggestions`)).data.some((s) => s.kind === 'wish' && s.name === 'Tartiflette'));

  // Validation : plat existant ; nom libre seulement avec une fiche.
  assert.equal((await lea.post(`${h}/wishes/${w[0].id}/accept`)).status, 403);
  await thomas.post(`${h}/wishes/${w.find((x) => x.name === 'Bolo').id}/accept`);
  assert.equal((await thomas.post(`${h}/wishes/${tarti.id}/accept`)).status, 409);
  const td = (await thomas.post(`${h}/dishes`, { name: 'Tartiflette', portions: 4, ingredients: [] })).data.id;
  w = (await thomas.post(`${h}/wishes/${tarti.id}/accept`, { dish_id: td })).data;
  assert.deepEqual(w.map((x) => [x.name, x.status, !!x.dish_id]), [['Bolo', 'ok', true], ['Tartiflette', 'ok', true]]);
  assert.equal(await pending(), p0);

  // Membre : ne retire que ses envies en attente ; gestionnaire : directement validee.
  assert.equal((await lea.del(`${h}/wishes/${tarti.id}`)).status, 403);
  const soupe = (await thomas.post(`${h}/dishes`, { name: 'Soupe', portions: 4, ingredients: [] })).data.id;
  w = (await thomas.post(`${h}/wishes`, { dish_id: soupe })).data;
  assert.equal(w.find((x) => x.name === 'Soupe').status, 'ok');

  // Mis au menu par un gestionnaire : l'envie disparait ; suggestion d'un membre : a l'acceptation.
  await thomas.post(`${h}/meals`, { date: '2030-03-04', slot: 'soir', dish_id: bolo });
  const mid = (await lea.post(`${h}/meals`, { date: '2030-03-05', slot: 'soir', dish_id: td })).data.id;
  assert.deepEqual((await thomas.get(`${h}/wishes`)).data.map((x) => x.name), ['Tartiflette', 'Soupe']);
  await thomas.post(`${h}/meals/${mid}/accept`);
  assert.deepEqual((await thomas.get(`${h}/wishes`)).data.map((x) => x.name), ['Soupe']);
  await thomas.del(`${h}/dishes/${soupe}`);
  assert.deepEqual((await thomas.get(`${h}/wishes`)).data, []);
});
