// Etape 5 : enregistrement d'un ticket valide (operation receipt.save).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');

let server, thomas, lea, h, co, im, lid, cat, P = {};
before(async () => {
  server = await start();
  ({ thomas, lea, h } = await household());
  const f = (await thomas.get(h)).data;
  [im, co] = f.stores.map((s) => s.id);
  cat = f.categories[0].id;
  for (const k of ['Lait', 'Tomates', 'Café']) P[k] = (await thomas.post(`${h}/products`, { name: k, category_id: cat })).data.id;
  await thomas.post(`${h}/products/${P['Café']}/records`, { store_id: co, price: '5,79' });
  lid = (await thomas.post(`${h}/lists`, { date: '2030-01-04', recurring: false })).data.id;
  for (const k of ['Lait', 'Tomates']) await thomas.post(`${h}/lists/${lid}/items`, { product_id: P[k] });
});
after(() => server.close());

const receipt = (lines, extra = {}) => ({ op_id: `r-${Math.random()}`, at: Date.now(), type: 'receipt.save', store_id: co, list_id: lid, date: '2030-01-04', raw_text: 'COLRUYT ...', lines, ...extra });

test('ticket valide par un membre : releves, coches, creation, alias, lignes ignorees', async () => {
  const r = await lea.post(`${h}/sync`, { ops: [receipt([
    { label: 'LAIT DEMI ECR 1L', qty: 1, unit_price: '0.99', product_id: P.Lait },
    { label: 'TOMAT CONC 400G', qty: 3, unit_price: '0.65', product_id: P.Tomates },
    { label: 'CAFE MOULU 500G', qty: 1, unit_price: '5.29', promo: true, product_id: P['Café'] },
    { label: 'CHIPS PAPRIKA', qty: 1, unit_price: '1.89', create: { name: 'Chips paprika 200 g', category_id: cat, unit: 'sachet' } },
    { label: 'SAC REUTILISABLE', qty: 1, unit_price: '0.10', ignore: true },
  ])] });
  assert.equal(r.status, 200);
  const res = r.data.results[0];
  assert.equal(res.ok, true);
  assert.deepEqual([res.receipt.records, res.receipt.checked, res.receipt.created, res.receipt.ignored], [4, 2, 1, 1]);
  const l = r.data.lists[0];
  assert.ok(l.items.filter((i) => !i.suggestion).every((i) => i.status === 'bought'));
  // Prix : releve ocr, promo exclue de la moyenne
  const cafe = (await thomas.get(`${h}/products/${P['Café']}`)).data;
  assert.equal(cafe.prices[co].avg, 579, 'promo hors moyenne');
  assert.equal(cafe.records[0].source, 'ocr');
  const lait = (await thomas.get(`${h}/products/${P.Lait}`)).data;
  assert.equal(lait.prices[co].avg, 99);
  // Produit cree au catalogue
  const prods = (await thomas.get(`${h}/products`)).data;
  assert.ok(prods.some((p) => p.name === 'Chips paprika 200 g'));
  // Correspondances memorisees pour ce magasin
  const al = (await thomas.get(`${h}/aliases`)).data;
  assert.equal(al.length, 4);
  assert.ok(al.some((a) => a.label_norm === 'tomat conc 400g' && a.store_id === co && a.product_id === P.Tomates));
});

test('rejeu sans doublon ; creation reutilise un produit du meme nom ; alias mis a jour', async () => {
  const op = receipt([{ label: 'TOMAT CONC 400G', qty: 1, unit_price: '0.69', product_id: P.Lait }, { label: 'CHIPS', qty: 1, unit_price: '1.89', create: { name: 'chips paprika 200 G', category_id: cat } }]);
  await thomas.post(`${h}/sync`, { ops: [op] });
  const again = await thomas.post(`${h}/sync`, { ops: [op] });
  assert.equal(again.data.results[0].replay, true);
  const prods = (await thomas.get(`${h}/products`)).data;
  assert.equal(prods.filter((p) => /chips/i.test(p.name)).length, 1, 'pas de doublon de produit');
  const al = (await thomas.get(`${h}/aliases`)).data;
  assert.equal(al.find((a) => a.label_norm === 'tomat conc 400g').product_id, P.Lait, 'correspondance corrigee');
  const lait = (await thomas.get(`${h}/products/${P.Lait}`)).data;
  assert.equal(lait.records.filter((x) => x.source === 'ocr').length, 2, 'un seul releve de plus malgre le rejeu');
});

test('magasin d\'un autre foyer refuse', async () => {
  const r = await thomas.post(`${h}/sync`, { ops: [receipt([], { store_id: 99999 })] });
  assert.equal(r.data.results[0].ok, false);
});
