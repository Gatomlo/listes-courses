// Passages par magasin : magasin d'achat, fin de passage, tickets a saisir, produit cree hors-ligne.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');

let server, thomas, lea, h, im, colruyt, lid, P = {};
before(async () => {
  server = await start();
  ({ thomas, lea, h } = await household());
  const f = (await thomas.get(h)).data;
  [im, colruyt] = f.stores.map((s) => s.id);
  const cat = f.categories[0].id;
  for (const k of ['lait', 'pain', 'oeufs']) P[k] = (await thomas.post(`${h}/products`, { name: k, category_id: cat })).data.id;
  lid = (await thomas.post(`${h}/lists`, { date: '2030-02-04', recurring: false })).data.id;
  for (const k of ['lait', 'pain', 'oeufs']) await thomas.post(`${h}/lists/${lid}/items`, { product_id: P[k] });
});
after(() => server.close());

const list = async () => (await thomas.get(`${h}/lists/${lid}`)).data;
const item = (l, k) => l.items.find((i) => i.product_id === P[k] && !i.suggestion);
const sync = (who, ops) => who.post(`${h}/sync`, { ops });
let n = 0;
const op = (o) => ({ op_id: `t-${n++}`, at: Date.now(), ...o });

test('cochage : le magasin d\'achat est garde, effacé au decochage', async () => {
  const l = await list();
  await sync(lea, [op({ type: 'item.update', item_id: item(l, 'lait').id, fields: { status: 'bought', bought_store_id: im } }),
    op({ type: 'item.update', item_id: item(l, 'pain').id, fields: { status: 'bought', bought_store_id: im } })]);
  let x = await list();
  assert.equal(item(x, 'lait').bought_store_id, im);
  assert.equal(item(x, 'lait').bought_at, im);
  await sync(lea, [op({ type: 'item.update', item_id: item(x, 'pain').id, fields: { status: 'todo' } })]);
  x = await list();
  assert.equal(item(x, 'pain').bought_store_id, null);
  assert.equal(item(x, 'pain').bought_at, null);
});

test('ticket a saisir : seulement apres la fin du passage, une seule fois', async () => {
  assert.deepEqual((await list()).tickets, [], 'passage pas termine');
  const r = await sync(lea, [op({ type: 'trip.finish', list_id: lid, store_id: im })]);
  assert.ok(r.data.results[0].ok);
  const t = r.data.lists[0].tickets;
  assert.equal(t.length, 1);
  assert.equal(t[0].store_id, im);
  assert.equal(t[0].items, 1);
  const s = (await thomas.get(`${h}/lists`)).data;
  assert.equal(s.tickets.length, 1);
  assert.equal(s.tickets[0].list_id, lid);
});

test('le ticket saisi retire l\'attente et fixe le magasin d\'achat', async () => {
  const r = await sync(thomas, [op({ type: 'receipt.save', store_id: colruyt, list_id: lid, date: '2030-02-04', lines: [{ label: 'OEUFS', qty: 1, unit_price: '2,50', product_id: P.oeufs }, { label: 'LAIT', qty: 1, unit_price: '1,00', product_id: P.lait }] })]);
  assert.ok(r.data.results[0].ok);
  const x = await list();
  assert.equal(item(x, 'oeufs').status, 'bought');
  assert.equal(item(x, 'oeufs').bought_store_id, colruyt);
  assert.equal(item(x, 'lait').bought_store_id, colruyt, 'le ticket corrige le magasin');
  assert.deepEqual(x.tickets.map((t) => t.store_id), [], 'colruyt a un ticket ; im n\'a plus d\'article');
});

test('article repris apres coup : le passage deja termine redemande un ticket, « pas de ticket » l\'ecarte', async () => {
  const l = await list();
  await sync(thomas, [op({ type: 'item.update', item_id: item(l, 'pain').id, fields: { status: 'bought', bought_store_id: im } })]);
  assert.deepEqual((await list()).tickets.map((t) => t.store_id), [im]);
  await sync(thomas, [op({ type: 'trip.skip', list_id: lid, store_id: im })]);
  assert.deepEqual((await list()).tickets, []);
});

test('liste cloturee : tickets sans passage termine, puis ecartes', async () => {
  const l2 = (await thomas.post(`${h}/lists`, { date: '2030-02-11', recurring: false })).data.id;
  await thomas.post(`${h}/lists/${l2}/items`, { product_id: P.lait });
  const it = (await thomas.get(`${h}/lists/${l2}`)).data.items[0];
  await sync(thomas, [op({ type: 'item.update', item_id: it.id, fields: { status: 'bought', bought_store_id: colruyt } })]);
  assert.equal((await thomas.get(`${h}/lists/${l2}`)).data.tickets.length, 0);
  await thomas.post(`${h}/lists/${l2}/close`, { fates: {} });
  assert.equal((await thomas.get(`${h}/lists/${l2}`)).data.tickets.length, 1);
  await sync(thomas, [op({ type: 'trip.skip', list_id: l2, store_id: colruyt })]);
  assert.equal((await thomas.get(`${h}/lists/${l2}`)).data.tickets.length, 0);
});

test('product.add : cree le produit puis l\'ajoute (ou reprend celui du meme nom)', async () => {
  const cat = (await thomas.get(h)).data.categories[0].id;
  let r = await sync(thomas, [op({ type: 'product.add', name: 'Beurre salé', category_id: cat, unit: 'paquet', list_id: lid, qty: 2 })]);
  assert.ok(r.data.results[0].ok, r.data.results[0].reason);
  const pid = r.data.results[0].productId;
  assert.equal(r.data.lists[0].items.find((i) => i.product_id === pid).qty, 2);
  r = await sync(thomas, [op({ type: 'product.add', name: 'beurre sale', category_id: cat, list_id: lid, qty: 1 })]);
  assert.equal(r.data.results[0].productId, pid, 'meme produit');
  assert.equal(r.data.lists[0].items.find((i) => i.product_id === pid).qty, 3);
  // membre : suggestion
  r = await sync(lea, [op({ type: 'product.add', name: 'Miel', category_id: cat, list_id: lid, qty: 1 })]);
  assert.ok(r.data.lists[0].items.find((i) => i.name === 'Miel').suggestion);
});
