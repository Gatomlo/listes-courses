// Etape 2 : listes, suggestions, cloture, recurrents.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');

let server, thomas, lea, h, P = {};
before(async () => {
  server = await start();
  ({ thomas, lea, h } = await household());
  const f = (await thomas.get(h)).data;
  const cat = f.categories[0].id;
  for (const [k, name, rec] of [['lait', 'Lait', 1], ['cafe', 'Café', 2], ['pain', 'Pain', null], ['pq', 'Papier toilette', null], ['jus', 'Jus', null], ['savon', 'Savon', null]]) {
    P[k] = (await thomas.post(`${h}/products`, { name, category_id: cat, recurrence: rec })).data.id;
  }
});
after(() => server.close());

const listOf = async (who, id) => (await who.get(`${h}/lists/${id}`)).data;
const item = (l, pid) => l.items.find((i) => i.product_id === pid && !i.suggestion);
let backlog, l1, l2;

test('« A prevoir » existe d\'office ; ajout et cumul des quantites', async () => {
  const s = (await thomas.get(`${h}/lists`)).data;
  backlog = s.backlog.id;
  assert.deepEqual(s.upcoming, []);
  await thomas.post(`${h}/lists/${backlog}/items`, { product_id: P.pq });
  const r = await thomas.post(`${h}/lists/${backlog}/items`, { product_id: P.pq, qty: 2 });
  assert.equal(item(r.data, P.pq).qty, 3);
  await thomas.post(`${h}/lists/${backlog}/items`, { product_id: P.jus });
  assert.equal((await thomas.patch(`${h}/items/${item(r.data, P.pq).id}`, { status: 'bought' })).status, 400, 'a prevoir : pas de coche');
});

test('creation : date proposee, recurrents dus, import depuis A prevoir', async () => {
  const pv = (await thomas.get(`${h}/lists/new`)).data;
  assert.match(pv.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(pv.recurring.map((p) => p.name).sort(), ['Café', 'Lait']);
  assert.equal((await lea.get(`${h}/lists/new`)).status, 403);
  const pq = pv.backlog.find((i) => i.name === 'Papier toilette');
  const r = await thomas.post(`${h}/lists`, { date: '2030-01-04', recurring: true, backlogItemIds: [pq.id] });
  assert.equal(r.status, 201);
  l1 = r.data;
  assert.equal(item(l1, P.pq).qty, 3);
  assert.equal(item(l1, P.lait).origin, 'recurring');
  const b = await listOf(thomas, backlog);
  assert.deepEqual(b.items.map((i) => i.name), ['Jus'], 'importe = retire de A prevoir');
  assert.equal((await thomas.post(`${h}/lists`, { date: '2030-01-04' })).status, 409, 'une liste par date');
});

test('recurrence « toutes les 2 listes »', async () => {
  const pv = (await thomas.get(`${h}/lists/new?date=2030-01-19`)).data;
  assert.deepEqual(pv.recurring.map((p) => p.name), ['Lait'], 'cafe present dans la liste precedente');
  l2 = (await thomas.post(`${h}/lists`, { date: '2030-01-19', recurring: true })).data;
  assert.ok(item(l2, P.lait));
  assert.ok(!item(l2, P.cafe));
  assert.deepEqual((await thomas.get(`${h}/lists/new?date=2030-02-02`)).data.recurring.map((p) => p.name), ['Café', 'Lait']);
});

test('suggestions : membre -> en attente ; acceptee (cumul) ou refusee', async () => {
  let r = await lea.post(`${h}/lists/${l1.id}/items`, { product_id: P.pain, qty: 2 });
  const sug = r.data.items.find((i) => i.suggestion === 'pending');
  assert.equal(sug.suggested_by_name, 'Lea');
  assert.equal((await thomas.get(h)).data.pending, 1);
  assert.equal((await lea.post(`${h}/items/${sug.id}/accept`)).status, 403);
  assert.equal((await lea.patch(`${h}/items/${sug.id}`, { status: 'bought' })).status, 409);
  r = await thomas.post(`${h}/items/${sug.id}/accept`);
  assert.equal(item(r.data, P.pain).qty, 2);
  // Suggestion d'un produit deja present : quantite ajoutee
  r = await lea.post(`${h}/lists/${l1.id}/items`, { product_id: P.pain });
  r = await thomas.post(`${h}/items/${r.data.items.find((i) => i.suggestion).id}/accept`);
  assert.equal(item(r.data, P.pain).qty, 3);
  assert.equal(r.data.items.filter((i) => i.product_id === P.pain).length, 1);
  r = await lea.post(`${h}/lists/${l1.id}/items`, { product_id: P.jus });
  const s2 = (await thomas.get(`${h}/suggestions`)).data;
  assert.equal(s2.length, 1);
  r = await thomas.post(`${h}/items/${s2[0].id}/refuse`);
  assert.ok(!r.data.items.some((i) => i.product_id === P.jus));
});

test('droits du membre : cocher, quantite, note ; pas retirer ni deplacer', async () => {
  const l = await listOf(lea, l1.id);
  const lait = item(l, P.lait);
  assert.equal((await lea.patch(`${h}/items/${lait.id}`, { status: 'bought', qty: 2, note: 'bio' })).status, 200);
  assert.equal((await lea.del(`${h}/items/${lait.id}`)).status, 403);
  assert.equal((await lea.post(`${h}/items/${lait.id}/move`, { list_id: backlog })).status, 403);
  assert.equal((await lea.post(`${h}/lists/${l1.id}/close`)).status, 403);
});

test('deplacer un article (cumul a destination)', async () => {
  await thomas.post(`${h}/lists/${l2.id}/items`, { product_id: P.pain });
  const pain = item(await listOf(thomas, l1.id), P.pain);
  const r = await thomas.post(`${h}/items/${pain.id}/move`, { list_id: l2.id });
  assert.ok(!item(r.data, P.pain));
  assert.equal(item(await listOf(thomas, l2.id), P.pain).qty, 4);
});

test('suppression avec articles coches (non achetes -> A prevoir) et liste cloturee', async () => {
  const qtyIn = async (pid) => (item(await listOf(thomas, backlog), pid) || { qty: 0 }).qty;
  const savon0 = await qtyIn(P.savon), pain0 = await qtyIn(P.pain);
  let l = (await thomas.post(`${h}/lists`, { date: '2030-03-03', recurring: false })).data;
  await thomas.post(`${h}/lists/${l.id}/items`, { product_id: P.savon, qty: 2 });
  l = (await thomas.post(`${h}/lists/${l.id}/items`, { product_id: P.pain, qty: 1 })).data;
  await thomas.patch(`${h}/items/${item(l, P.pain).id}`, { status: 'bought' });
  assert.equal((await lea.del(`${h}/lists/${l.id}`)).status, 403);
  assert.equal((await thomas.del(`${h}/lists/${l.id}`)).status, 200);
  assert.equal(await qtyIn(P.savon), savon0 + 2);
  assert.equal(await qtyIn(P.pain), pain0);
  const c = (await thomas.post(`${h}/lists`, { date: '2030-03-10', recurring: false })).data;
  await thomas.post(`${h}/lists/${c.id}/close`, { fates: {} });
  assert.equal((await thomas.del(`${h}/lists/${c.id}`)).status, 200);
  assert.equal((await thomas.get(`${h}/lists/${c.id}`)).status, 404);
});

test('cloture : report vers la suivante, A prevoir, ou abandon', async () => {
  const l = await listOf(thomas, l1.id);
  const cafe = item(l, P.cafe), pq = item(l, P.pq);
  await lea.post(`${h}/lists/${l1.id}/items`, { product_id: P.jus }); // suggestion abandonnee a la cloture
  const r = await thomas.post(`${h}/lists/${l1.id}/close`, { fates: { [pq.id]: 'backlog' } });
  assert.equal(r.data.carried, 2);
  const closed = await listOf(thomas, l1.id);
  assert.equal(closed.status, 'closed');
  assert.equal(item(closed, P.cafe).carried_label, '2030-01-19');
  assert.equal(item(closed, P.pq).carried_label, 'À prévoir');
  assert.ok(!closed.items.some((i) => i.suggestion));
  assert.equal(item(await listOf(thomas, l2.id), P.cafe).origin, 'carried');
  assert.ok(item(await listOf(thomas, backlog), P.pq));
  assert.equal((await thomas.patch(`${h}/items/${cafe.id}`, { qty: 5 })).status, 409, 'lecture seule');
  const s = (await thomas.get(`${h}/lists`)).data;
  assert.equal(s.closed[0].id, l1.id);
  assert.equal((await thomas.post(`${h}/lists/${l1.id}/copy-to-backlog`)).data.copied, 1);
});

test('statut, date, suppression d\'une liste (articles manuels -> A prevoir)', async () => {
  assert.equal((await lea.patch(`${h}/lists/${l2.id}`, { status: 'prep' })).status, 403);
  assert.equal((await lea.patch(`${h}/lists/${l2.id}`, { status: 'shopping', date: '2030-01-21' })).status, 403);
  assert.equal((await lea.patch(`${h}/lists/${l2.id}`, { status: 'shopping' })).data.status, 'shopping', 'un membre part faire les courses');
  assert.equal(typeof (await thomas.get(`${h}/lists`)).data.upcoming[0].unknown, 'number');
  let r = await thomas.patch(`${h}/lists/${l2.id}`, { status: 'shopping', date: '2030-01-20' });
  assert.equal(r.data.status, 'shopping');
  assert.equal(r.data.date, '2030-01-20');
  const l3 = (await thomas.post(`${h}/lists`, { date: '2030-02-03', recurring: false })).data;
  await thomas.post(`${h}/lists/${l3.id}/items`, { product_id: P.jus, qty: 2 });
  r = await thomas.del(`${h}/lists/${l3.id}`);
  assert.equal(r.status, 200);
  assert.equal(item(await listOf(thomas, backlog), P.jus).qty, 3);
});

test('fusion de produits : les articles suivent', async () => {
  const dup = (await thomas.post(`${h}/products`, { name: 'Pain de mie', category_id: (await thomas.get(h)).data.categories[0].id })).data.id;
  await thomas.post(`${h}/lists/${l2.id}/items`, { product_id: dup, qty: 1 });
  await thomas.post(`${h}/products/${dup}/merge`, { into: P.pain });
  const l = await listOf(thomas, l2.id);
  assert.equal(l.items.filter((i) => i.product_id === P.pain).length, 1);
  assert.equal(item(l, P.pain).qty, 5);
});

test('produit supprime : retire des listes en cours, garde barre dans l historique', async () => {
  const lait = item(await listOf(thomas, l1.id), P.lait); // l1 cloturee, lait achete
  assert.ok(lait);
  assert.ok(item(await listOf(thomas, l2.id), P.lait));
  assert.equal((await thomas.del(`${h}/products/${P.lait}`)).status, 200);
  assert.ok(!item(await listOf(thomas, l2.id), P.lait), 'retire de la liste en cours');
  const hist = item(await listOf(thomas, l1.id), P.lait);
  assert.equal(hist.name, 'Lait');
  assert.equal(hist.deleted, 1);
  assert.equal((await thomas.get(`${h}/products/${P.lait}`)).status, 404);
  assert.ok(!(await thomas.get(`${h}/products`)).data.some((p) => p.id === P.lait));
  assert.equal((await thomas.get(`${h}/lists/new?date=2030-06-01`)).data.recurring.some((p) => p.name === 'Lait'), false);
  const again = await thomas.post(`${h}/products`, { name: 'Lait', category_id: (await thomas.get(h)).data.categories[0].id });
  assert.equal(again.status, 201, 'le nom est de nouveau libre');
});

test('cloture sans liste suivante : liste creee au debut du prochain menu', async () => {
  const a = (await thomas.post(`${h}/lists`, { date: '2040-01-05', recurring: false })).data;
  const r = (await thomas.post(`${h}/lists/${a.id}/close`, { fates: {} })).data;
  assert.ok(r.created && r.next === r.created);
  const created = (await thomas.get(`${h}/lists/${r.created}`)).data;
  const per = (await thomas.get(`${h}/menu?at=2040-01-05`)).data.period;
  assert.equal(created.date, new Date(Date.parse(per.end) + 86400000).toISOString().slice(0, 10));
  // Une liste suivante existe deja : rien n'est cree.
  const b = (await thomas.post(`${h}/lists`, { date: '2040-06-01', recurring: false })).data;
  await thomas.post(`${h}/lists`, { date: '2040-06-20', recurring: false });
  const r2 = (await thomas.post(`${h}/lists/${b.id}/close`, { fates: {} })).data;
  assert.equal(r2.created, null);
});
