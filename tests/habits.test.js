// « Peut-etre a racheter » : produits achetes a intervalle regulier.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');
const { db } = require('../lib/db');

let server, thomas, h;
before(async () => { server = await start(); ({ thomas, h } = await household()); });
after(() => server.close());

const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('habitudes : achats reguliers, delai atteint, pas deja dans une liste', async () => {
  const lait = (await thomas.post(`${h}/products`, { name: 'Lait habitude', category_id: (await thomas.get(h)).data.categories[0].id })).data;
  const rare = (await thomas.post(`${h}/products`, { name: 'Rare', category_id: (await thomas.get(h)).data.categories[0].id })).data;
  // Listes datees passees (cloturees) : lait achete tous les 7 jours, dernier achat il y a 8 jours ; « Rare » 2 fois seulement.
  const dates = [-29, -22, -15, -8];
  const hid = Number(h.match(/(\d+)/)[1]);
  for (const [k, n] of dates.entries()) {
    const l = db.prepare("INSERT INTO lists (household_id, type, date, status, created_at) VALUES (?, 'dated', ?, 'closed', 0)").run(hid, day(n)).lastInsertRowid;
    db.prepare("INSERT INTO list_items (list_id, product_id, qty, status, origin, created_at, updated_at) VALUES (?, ?, 1, 'bought', 'manual', 0, 0)").run(l, lait.id);
    if (k < 2) db.prepare("INSERT INTO list_items (list_id, product_id, qty, status, origin, created_at, updated_at) VALUES (?, ?, 1, 'bought', 'manual', 0, 0)").run(l, rare.id);
  }
  let r = (await thomas.get(`${h}/habits`)).data;
  assert.deepEqual(r.map((x) => x.name), ['Lait habitude']);
  assert.equal(r[0].every_days, 7);
  // Deja dans « A prevoir » : plus propose.
  const bid = (await thomas.get(`${h}/lists`)).data.backlog.id;
  await thomas.post(`${h}/lists/${bid}/items`, { product_id: lait.id, qty: 1 });
  r = (await thomas.get(`${h}/habits`)).data;
  assert.equal(r.length, 0);
});
