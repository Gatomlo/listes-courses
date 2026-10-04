// Unites des ingredients : contenance des produits, conversion en emballages dans les listes.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');
const U = require('../lib/units');

test('contenance, conversion, unites des recettes', () => {
  assert.deepEqual(U.parseSize('500 g'), { n: 500, u: 'g' });
  assert.deepEqual(U.parseSize('1,5 kg'), { n: 1500, u: 'g' });
  assert.deepEqual(U.parseSize('1 L'), { n: 1000, u: 'ml' });
  assert.deepEqual(U.parseSize('6 x 33 cl'), { n: 1980, u: 'ml' });
  assert.deepEqual(U.parseSize('x12'), { n: 12, u: 'pc' });
  assert.deepEqual(U.parseSize('12 œufs'), { n: 12, u: 'pc' });
  assert.deepEqual(U.parseSize('', 'kg'), { n: 1000, u: 'g' });
  assert.deepEqual(U.parseSize(null, 'pièce'), { n: 1, u: 'pc' });
  assert.equal(U.parseSize('grand format', 'paquet'), null);
  assert.equal(U.packages(600, 'g', { contenance: '500 g' }), 1.2);
  assert.equal(U.packages(20, 'ml', { contenance: '20 cl' }), 0.1);
  assert.equal(U.packages(2, 'pc', { contenance: '1 kg' }), null, 'pieces sans poids d\'une piece');
  assert.equal(U.packages(2, 'pc', { contenance: '1 kg', piece_qty: 150 }), 0.3);
  assert.equal(U.packages(300, 'g', { unit: 'pièce', piece_qty: 150 }), 2);
  assert.equal(U.packages(3, null, {}), 3);
  assert.deepEqual(U.normalizeAmount(50, 'cl'), { qty: 50, unit: 'cl' });
  assert.deepEqual(U.normalizeAmount(2, 'dl'), { qty: 20, unit: 'cl' });
  assert.deepEqual(U.toBase(2, 'cs'), { qty: 30, unit: 'ml' });
  assert.equal(U.packages(2, 'cc', { contenance: '1 L' }), 0.01);
  assert.equal(U.packages(0.5, 'kg', { contenance: '250 g' }), 2);
  assert.deepEqual(U.normalizeAmount(2, 'c. à s.'), { qty: 2, unit: 'cs' });
  assert.deepEqual(U.normalizeAmount(1, 'c. à c.'), { qty: 1, unit: 'cc' });
  assert.equal(U.normalizeAmount(2, 'gousses'), null);
  assert.equal(U.fmtAmount(1500, 'g'), '1,5 kg');
  assert.equal(U.fmtAmount(2, 'pc'), '2 pièces');
});

let server, thomas, h, P = {};
before(async () => {
  server = await start();
  ({ thomas, h } = await household());
  const cat = (await thomas.get(h)).data.categories[0].id;
  for (const [k, name, contenance] of [['pates', 'Pâtes', '500 g'], ['beurre', 'Beurre', '250 g'], ['oign', 'Oignons', '1 kg']]) {
    P[k] = (await thomas.post(`${h}/products`, { name, category_id: cat, contenance })).data.id;
  }
});
after(() => server.close());

test('quantites en g / pieces converties en emballages, sommees avant arrondi', async () => {
  const lid = (await thomas.post(`${h}/lists`, { date: '2031-03-01', recurring: false })).data.id;
  const d = await thomas.post(`${h}/dishes`, { name: 'Pâtes au beurre', portions: 4, ingredients: [
    { product_id: P.pates, qty: 0.3, unit: 'kg' }, { product_id: P.beurre, qty: 6, unit: 'cs' }, { product_id: P.oign, qty: 2, unit: 'pc' }] });
  assert.equal(d.status, 201);
  const ing = (k) => d.data.ingredients.find((i) => i.product_id === P[k]);
  assert.deepEqual([ing('pates').iunit, ing('pates').conv, ing('oign').conv], ['kg', true, false]);
  for (const date of ['2031-03-02', '2031-03-04']) await thomas.post(`${h}/meals`, { date, slot: 'soir', dish_id: d.data.id, persons: 4 });
  const it = async (k) => (await thomas.get(`${h}/lists/${lid}`)).data.items.find((i) => i.product_id === P[k]);
  assert.equal((await it('pates')).qty, 2, '600 g -> 2 paquets de 500 g');
  assert.equal((await it('pates')).need, '600 g');
  assert.equal((await it('beurre')).qty, 1, '2 x 6 CS = 180 ml -> 1 plaquette de 250 g');
  assert.equal((await it('oign')).qty, 2, 'sans poids d\'une piece : 1 emballage par repas');
  const r = await thomas.patch(`${h}/products/${P.oign}`, { piece_qty: '150' });
  assert.equal(r.data.piece_qty, 150);
  assert.equal((await it('oign')).qty, 1, '4 x 150 g = 600 g -> 1 filet de 1 kg');
  assert.equal((await thomas.get(`${h}/dishes/${d.data.id}`)).data.ingredients.find((i) => i.product_id === P.oign).conv, true);
});

test('contenance saisie en nombre + unite ; ancienne valeur gardee si non ressaisie', async () => {
  let r = await thomas.post(`${h}/products`, { name: 'Lait', category_id: (await thomas.get(h)).data.categories[0].id, cont_n: '1,5', cont_u: 'L' });
  assert.equal(r.data.contenance, '1,5 L');
  assert.deepEqual(r.data.size, { n: 1500, u: 'ml' });
  r = await thomas.patch(`${h}/products/${r.data.id}`, { cont_n: '', cont_u: 'g', contenance: 'grand format' });
  assert.equal(r.data.contenance, 'grand format');
  r = await thomas.patch(`${h}/products/${r.data.id}`, { cont_n: '', cont_u: 'g' });
  assert.equal(r.data.contenance, null);
});
