// Etape 4 : rejeu idempotent, conflits, temps reel (SSE).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household, baseUrl } = require('./helpers');

let server, thomas, lea, h, im, lid, P = {};
before(async () => {
  server = await start();
  ({ thomas, lea, h } = await household());
  const f = (await thomas.get(h)).data;
  im = f.stores[0].id;
  const cat = f.categories[0].id;
  for (const k of ['lait', 'pain', 'oeufs']) P[k] = (await thomas.post(`${h}/products`, { name: k, category_id: cat })).data.id;
  lid = (await thomas.post(`${h}/lists`, { date: '2030-01-04', recurring: false })).data.id;
  for (const k of ['lait', 'pain']) await thomas.post(`${h}/lists/${lid}/items`, { product_id: P[k] });
});
after(() => server.close());

const list = async () => (await thomas.get(`${h}/lists/${lid}`)).data;
const item = (l, k) => l.items.find((i) => i.product_id === P[k] && !i.suggestion);
const sync = (who, ops) => who.post(`${h}/sync`, { ops });

test('operation rejouee deux fois : appliquee une fois', async () => {
  const lait = item(await list(), 'lait');
  const op = { op_id: 'dev1-1', at: Date.now(), type: 'item.update', item_id: lait.id, fields: { status: 'bought' } };
  let r = await sync(lea, [op, { op_id: 'dev1-2', at: Date.now(), type: 'record.add', product_id: P.lait, store_id: im, price: '1,09' }]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.results.map((x) => x.ok), [true, true]);
  assert.equal(item(r.data.lists[0], 'lait').status, 'bought');
  r = await sync(lea, [op, { op_id: 'dev1-2', at: Date.now(), type: 'record.add', product_id: P.lait, store_id: im, price: '1,09' }]);
  assert.ok(r.data.results.every((x) => x.replay));
  const p = (await thomas.get(`${h}/products/${P.lait}`)).data;
  assert.equal(p.records.length, 1, 'releve non double');
  assert.equal(p.records[0].source, 'check');
});

test('conflit : « achete » l\'emporte sur un decochage plus ancien', async () => {
  const lait = item(await list(), 'lait');
  const r = await sync(thomas, [{ op_id: 'dev2-1', at: Date.now() - 60000, type: 'item.update', item_id: lait.id, fields: { status: 'todo' } }]);
  assert.equal(r.data.results[0].ignored, true);
  assert.equal(item(await list(), 'lait').status, 'bought');
});

test('conflit : la modification la plus recente gagne', async () => {
  const pain = item(await list(), 'pain');
  await sync(thomas, [{ op_id: 'dev2-2', at: Date.now(), type: 'item.update', item_id: pain.id, fields: { qty: 3 } }]);
  const r = await sync(lea, [{ op_id: 'dev1-3', at: Date.now() - 60000, type: 'item.update', item_id: pain.id, fields: { qty: 5, status: 'bought' } }]);
  const l = await list();
  assert.equal(item(l, 'pain').qty, 3, 'quantite plus ancienne ignoree');
  assert.equal(item(l, 'pain').status, 'bought', 'cocher passe quand meme');
  assert.equal(r.data.results[0].ok, true);
});

test('article supprime entre-temps, refus metier : definitif et signale', async () => {
  const r0 = await thomas.post(`${h}/lists/${lid}/items`, { product_id: P.oeufs });
  const oeufs = item(r0.data, 'oeufs');
  await thomas.del(`${h}/items/${oeufs.id}`);
  let r = await sync(lea, [{ op_id: 'dev1-4', at: Date.now(), type: 'item.update', item_id: oeufs.id, fields: { status: 'bought' } }]);
  assert.equal(r.data.results[0].ignored, true);
  assert.match(r.data.results[0].reason, /supprimé/);
  // Ajout hors-ligne par un membre : devient une suggestion
  r = await sync(lea, [{ op_id: 'dev1-5', at: Date.now(), type: 'item.add', list_id: lid, product_id: P.oeufs, qty: 2 }]);
  assert.ok(r.data.lists[0].items.some((i) => i.product_id === P.oeufs && i.suggestion === 'pending'));
  r = await sync(lea, [{ op_id: 'dev1-6', at: Date.now(), type: 'item.update', item_id: item(await list(), 'pain').id, fields: { store_id: 999 } }]);
  assert.equal(r.data.results[0].ok, false);
});

// Lit les evenements SSE d'un client jusqu'a `n` messages.
async function readEvents(cookieClient, url, n, during) {
  const ctrl = new AbortController();
  const res = await fetch(baseUrl() + url, { headers: { cookie: cookieClient }, signal: ctrl.signal });
  const reader = res.body.getReader();
  const out = [];
  let buf = '';
  const pump = (async () => {
    while (out.length < n) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split('\n').find((x) => x.startsWith('data: '));
        if (line) out.push(JSON.parse(line.slice(6)));
      }
    }
  })();
  await during();
  await Promise.race([pump, new Promise((r) => setTimeout(r, 1500))]);
  ctrl.abort();
  return out;
}

test('temps reel : presence et changement diffuse aux autres', async () => {
  const pain = item(await list(), 'pain');
  const events = await readEvents(thomas.cookie(), `${h}/events?list=${lid}`, 3, async () => {
    await new Promise((r) => setTimeout(r, 100));
    await sync(lea, [{ op_id: 'dev1-7', at: Date.now(), type: 'item.update', item_id: pain.id, fields: { note: 'complet' } }]);
  });
  const pres = events.find((e) => e.type === 'presence');
  assert.ok(pres.users.some((u) => u.listId === lid));
  const ch = events.find((e) => e.type === 'change');
  assert.ok(ch, 'changement recu');
  assert.equal(ch.listId, lid);
});
