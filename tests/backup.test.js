// Sauvegarde complete du foyer : gestionnaire seulement, sans comptes ni jetons.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');

let server, thomas, lea, h;
before(async () => { server = await start(); ({ thomas, lea, h } = await household()); });
after(() => server.close());

test('export JSON du foyer, reserve au gestionnaire', async () => {
  const f = (await thomas.get(h)).data;
  await thomas.post(`${h}/products`, { name: 'Lait', category_id: f.categories[0].id });
  const r = await thomas.get(`${h}/export`);
  assert.equal(r.status, 200);
  assert.equal(r.data.app, 'cabas');
  assert.ok(r.data.tables.products.some((p) => p.name === 'Lait'));
  assert.ok(r.data.tables.stores.length >= 1);
  assert.ok(r.data.tables.price_records !== undefined, 'tables enfants incluses');
  for (const t of ['users', 'sessions', 'login_tokens', 'memberships', 'push_subs']) assert.equal(r.data.tables[t], undefined, t);
  assert.equal((await lea.get(`${h}/export`)).status, 403);
});

test('reglages : fonctions avancees du menu', async () => {
  assert.equal((await thomas.get(h)).data.household.adv_menu, 0);
  await thomas.patch(h, { adv_menu: true });
  assert.equal((await thomas.get(h)).data.household.adv_menu, 1);
});
