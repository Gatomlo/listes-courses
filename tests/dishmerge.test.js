// Fusion de plats : repas, envies, tags, composition ; droits.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');

let server, thomas, lea, h;
before(async () => { server = await start(); ({ thomas, lea, h } = await household()); });
after(() => server.close());

test('fusion de plats', async () => {
  const a = (await thomas.post(`${h}/dishes`, { name: 'Chili', tags: ['Rapide'], steps: 'Cuire' })).data;
  const b = (await thomas.post(`${h}/dishes`, { name: 'Chili con carne', tags: ['Epice'], notes: 'Piment' })).data;
  const date = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const m = await thomas.post(`${h}/meals`, { date, slot: 'soir', dish_id: b.id, persons: 4 });
  assert.equal(m.status, 201, JSON.stringify(m.data));
  assert.equal((await lea.post(`${h}/dishes/${b.id}/merge`, { into: a.id })).status, 403);
  assert.equal((await thomas.post(`${h}/dishes/${a.id}/merge`, { into: a.id })).status, 400);
  const r = await thomas.post(`${h}/dishes/${b.id}/merge`, { into: a.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.tags, ['Epice', 'Rapide']);
  assert.equal(r.data.steps, 'Cuire');
  assert.equal(r.data.notes, 'Piment');
  assert.equal(r.data.upcoming.length, 1);
  assert.equal((await thomas.get(`${h}/dishes/${b.id}`)).status, 404);
});
