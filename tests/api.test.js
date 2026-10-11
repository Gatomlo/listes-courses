// Tests de l'API sur une base temporaire (aucun e-mail envoye : CABAS_MAIL=log).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, baseUrl, client, outbox } = require('./helpers');

let server, base;
before(async () => { server = await start(); base = baseUrl(); });
after(() => server.close());

let thomas, lea, hid, h;

test('connexion par lien : compte cree, lien a usage unique', async () => {
  thomas = client();
  const r = await thomas.login('thomas@exemple.be');
  assert.equal(r.status, 200);
  assert.equal(r.data.name, 'Thomas');
  assert.equal(r.data.householdId, null);
  const token = new URL(outbox.at(-1).text.match(/https?:\S+/)[0]).searchParams.get('login');
  assert.equal((await client().post('/api/auth/verify', { token })).status, 400);
  assert.equal((await client().get('/api/me')).status, 401);
});

test('requete non JSON refusee (CSRF)', async () => {
  const res = await fetch(`${base}/api/auth/logout`, { method: 'POST', body: 'x' });
  assert.equal(res.status, 415);
});

test('creation du foyer : magasins et rayons par defaut', async () => {
  const r = await thomas.post('/api/households', { name: 'Foyer Phoenix' });
  assert.equal(r.status, 201);
  hid = r.data.householdId;
  h = `/api/h/${hid}`;
  const f = (await thomas.get(h)).data;
  assert.equal(f.role, 'manager');
  assert.deepEqual(f.stores.map((s) => s.name), ['Intermarché', 'Colruyt']);
  assert.equal(f.categories.length, 9);
  assert.equal(f.stores[0].categoryOrder.length, 9);
});

test('invitation, acceptation, roles', async () => {
  const inv = await thomas.post(`${h}/invitations`, { email: 'lea@exemple.be', role: 'member' });
  assert.equal(inv.status, 201);
  const token = new URL(inv.data.url).searchParams.get('invite');
  const preview = await client().get(`/api/invitations/${token}`);
  assert.equal(preview.data.household, 'Foyer Phoenix');
  lea = client();
  await lea.login('lea@exemple.be');
  const acc = await lea.post(`/api/invitations/${token}/accept`);
  assert.equal(acc.data.householdId, hid);
  assert.equal((await lea.post(`/api/invitations/${token}/accept`)).status, 404, 'usage unique');
  // Un membre ne gere pas le foyer
  assert.equal((await lea.patch(h, { threshold_cents: 100 })).status, 403);
  assert.equal((await lea.post(`${h}/stores`, { name: 'Aldi' })).status, 403);
  // Un etranger ne voit pas le foyer
  const bob = client();
  await bob.login('bob@exemple.be');
  assert.equal((await bob.get(h)).status, 404);
});

test('dernier gestionnaire protege, changement de profil', async () => {
  const me = (await thomas.get('/api/me')).data;
  assert.equal((await thomas.patch(`${h}/members/${me.id}`, { role: 'member' })).status, 409);
  assert.equal((await thomas.del(`${h}/members/${me.id}`)).status, 409);
  const leaId = (await lea.get('/api/me')).data.id;
  const r = await thomas.patch(`${h}/members/${leaId}`, { role: 'manager', display_name: 'Léa' });
  assert.equal(r.data.find((m) => m.id === leaId).role, 'manager');
  await thomas.patch(`${h}/members/${leaId}`, { role: 'member' });
});

test('magasins : ajout, desactivation, au moins un actif', async () => {
  let stores = (await thomas.post(`${h}/stores`, { name: 'Aldi', color: '#1f6fb2' })).data;
  const aldi = stores.find((s) => s.name === 'Aldi');
  assert.equal(aldi.categoryOrder.length, 9);
  stores = (await thomas.patch(`${h}/stores/${aldi.id}`, { active: false })).data;
  assert.equal(stores.find((s) => s.id === aldi.id).active, false);
  const [im, co] = stores;
  await thomas.patch(`${h}/stores/${im.id}`, { active: false });
  assert.equal((await thomas.patch(`${h}/stores/${co.id}`, { active: false })).status, 409);
  await thomas.patch(`${h}/stores/${im.id}`, { active: true });
});

test('parcours incomplet repare : rayons manquants remis en fin de parcours', async () => {
  const { db } = require('../lib/db');
  const before = (await thomas.get(h)).data;
  const s = before.stores[0], keep = s.categoryOrder[2];
  db.prepare('DELETE FROM store_category_order WHERE store_id = ? AND category_id <> ?').run(s.id, keep);
  const after = (await thomas.get(h)).data;
  const fixed = after.stores.find((x) => x.id === s.id);
  assert.equal(fixed.categoryOrder.length, before.categories.length);
  assert.equal(fixed.categoryOrder[0], keep);
  assert.ok(after.stores.every((x) => x.categoryOrder.length === after.categories.length));
});

test('rayons : ajout en fin de parcours, ordre, suppression avec transfert', async () => {
  const r = await thomas.post(`${h}/categories`, { name: 'Bio' });
  const bio = r.data.categories.find((c) => c.name === 'Bio');
  const store = r.data.stores[0];
  assert.equal(store.categoryOrder.at(-1), bio.id);
  const order = [bio.id, ...store.categoryOrder.filter((id) => id !== bio.id)];
  const s2 = (await thomas.put(`${h}/stores/${store.id}/order`, { categoryIds: order })).data;
  assert.equal(s2[0].categoryOrder[0], bio.id);
  assert.equal((await thomas.put(`${h}/stores/${store.id}/order`, { categoryIds: [bio.id] })).status, 400);
  const p = (await thomas.post(`${h}/products`, { name: 'Quinoa', category_id: bio.id })).data;
  assert.equal((await thomas.del(`${h}/categories/${bio.id}`)).status, 400);
  const epicerie = r.data.categories.find((c) => c.name === 'Épicerie');
  assert.equal((await thomas.del(`${h}/categories/${bio.id}?moveTo=${epicerie.id}`)).status, 200);
  assert.equal((await thomas.get(`${h}/products/${p.id}`)).data.category_id, epicerie.id);
});

test('produits : prix moyen hors promo, magasin conseille ou impose, fusion', async () => {
  const f = (await thomas.get(h)).data;
  const [im, co] = f.stores;
  const frais = f.categories.find((c) => c.name === 'Frais').id;
  const lait = (await lea.post(`${h}/products`, { name: 'Lait demi-écrémé 1 L', category_id: frais, unit: 'bouteille', recurrence: 1 })).data;
  assert.equal((await lea.post(`${h}/products`, { name: 'lait demi-ecreme 1 l', category_id: frais })).status, 409, 'doublon (accents, casse)');
  for (const [sid, price] of [[im.id, '1,05'], [im.id, '1.15'], [co.id, '0,99'], [co.id, '0,50']]) {
    await lea.post(`${h}/products/${lait.id}/records`, { store_id: sid, price, promo: price === '0,50' });
  }
  let p = (await lea.get(`${h}/products/${lait.id}`)).data;
  assert.equal(p.prices[im.id].avg, 110);
  assert.equal(p.prices[co.id].avg, 99, 'promo exclue');
  assert.equal(p.best_store_id, co.id);
  assert.equal(p.records.length, 4);
  assert.equal((await lea.patch(`${h}/products/${lait.id}`, { forced_store_id: im.id })).status, 403);
  p = (await thomas.patch(`${h}/products/${lait.id}`, { forced_store_id: im.id })).data;
  assert.equal(p.best_store_id, im.id);
  const dup = (await thomas.post(`${h}/products`, { name: 'Lait 1L', category_id: frais })).data;
  await thomas.post(`${h}/products/${dup.id}/records`, { store_id: im.id, price: 1 });
  p = (await thomas.post(`${h}/products/${dup.id}/merge`, { into: lait.id })).data;
  assert.equal(p.records.length, 5);
  assert.equal((await thomas.get(`${h}/products/${dup.id}`)).status, 404);
  const list = (await lea.get(`${h}/products`)).data;
  assert.equal(list.length, 2);
});

test('page servie avec sa politique de contenu', async () => {
  const res = await fetch(`${base}/`);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(await res.text(), /<base href="\/">/);
});
