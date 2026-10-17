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

test('parcours appris : ordre des rayons d apres le cochage', async () => {
  const hh = await household('Parcours');
  const t = hh.thomas, hx = hh.h;
  const cats = (await t.get(hx)).data.categories.slice(0, 3);
  const store = (await t.get(hx)).data.stores[0];
  // Parcours actuel : rayons 0, 1, 2 ; on coche dans l'ordre 2, 1, 0.
  await t.put(`${hx}/stores/${store.id}/order`, { categoryIds: cats.map((c) => c.id) });
  const lid = (await t.post(`${hx}/lists`, { date: day(1) })).data.id;
  const order = [cats[2], cats[1], cats[0]];
  for (const [k, c] of order.entries()) for (const j of [0, 1]) {
    const p = (await t.post(`${hx}/products`, { name: `P${k}${j}`, category_id: c.id })).data;
    const it = (await t.post(`${hx}/lists/${lid}/items`, { product_id: p.id, qty: 1 })).data;
    const itemId = (it.items || []).find((x) => x.product_id === p.id).id;
    await t.patch(`${hx}/items/${itemId}`, { status: 'bought', bought_store_id: store.id });
    db.prepare('UPDATE list_items SET updated_at = ? WHERE id = ?').run(1000 + k * 10 + j, itemId);
  }
  const r = (await t.get(`${hx}/stores/${store.id}/route?list=${lid}`)).data;
  assert.equal(r.changed, true);
  assert.deepEqual(r.order, order.map((c) => c.id));
});

test('parcours automatique : applique a la fin du passage', async () => {
  const hh = await household('Auto');
  const t = hh.thomas, hx = hh.h;
  const cats = (await t.get(hx)).data.categories.slice(0, 3);
  const store = (await t.get(hx)).data.stores[0];
  await t.put(`${hx}/stores/${store.id}/order`, { categoryIds: cats.map((c) => c.id) });
  await t.patch(`${hx}/stores/${store.id}`, { auto_route: true });
  const lid = (await t.post(`${hx}/lists`, { date: day(1) })).data.id;
  for (const [k, c] of [cats[2], cats[1], cats[0]].entries()) for (const j of [0, 1]) {
    const p = (await t.post(`${hx}/products`, { name: `A${k}${j}`, category_id: c.id })).data;
    const it = (await t.post(`${hx}/lists/${lid}/items`, { product_id: p.id, qty: 1 })).data;
    const itemId = it.items.find((x) => x.product_id === p.id).id;
    await t.patch(`${hx}/items/${itemId}`, { status: 'bought', bought_store_id: store.id });
    db.prepare('UPDATE list_items SET updated_at = ? WHERE id = ?').run(1000 + k * 10 + j, itemId);
  }
  await t.post(`/api/h/${hx.split('/').pop()}/sync`, { ops: [{ op_id: 'x1', type: 'trip.finish', list_id: lid, store_id: store.id }] });
  const st = (await t.get(hx)).data.stores.find((s) => s.id === store.id);
  assert.deepEqual(st.categoryOrder.slice(0, 3), [cats[2].id, cats[1].id, cats[0].id]);
});
