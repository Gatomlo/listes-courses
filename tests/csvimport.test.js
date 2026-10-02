// Import de produits par fichier CSV.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');
const { parseCsv } = require('../lib/csvimport');

let server, thomas, lea, h;
before(async () => { server = await start(); ({ thomas, lea, h } = await household()); });
after(() => server.close());

const CSV = '﻿Nom;Rayon;Emballage;Contenance;Magasin;Prix;Promo;Prix normal;Date\r\n'
  + 'Beurre doux;Frais;pièce;250 g;Colruyt;1,89;;;2026-10-02\r\n'
  + '"Chips ""Grills""";Apéro;sachet;125 g;colruyt;0,93;oui;1,39;02/10/2026\r\n'
  + 'Sel;;;;;;;;\r\n'
  + ';Frais;;;;;;;\r\n'
  + 'Lait;Frais;brique;1 L;Lidl;0,99;;;\r\n'
  + 'Fusilli;Épicerie;paquet;500 g;Colruyt;abc;;;\r\n';

test('lecture CSV : separateur, guillemets, BOM', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y",2\n\n'), [['a', 'b'], ['x, y', '2']]);
  assert.equal(parseCsv(CSV)[2][0], 'Chips "Grills"');
});

test('import : apercu sans ecriture, puis import, puis reimport sans doublon', async () => {
  assert.equal((await lea.post(`${h}/products/import`, { csv: CSV })).status, 403);
  const dry = (await thomas.post(`${h}/products/import`, { csv: CSV, dry: true })).data;
  assert.deepEqual(dry.created, ['Beurre doux', 'Chips "Grills"', 'Sel']);
  assert.deepEqual(dry.categories, ['Apéro']);
  assert.equal(dry.records, 3);
  assert.deepEqual(dry.errors.map((e) => e.line), [5, 6, 7]);
  assert.equal((await thomas.get(`${h}/products`)).data.length, 0);

  const r = (await thomas.post(`${h}/products/import`, { csv: CSV })).data;
  assert.equal(r.created.length, 3);
  const ps = (await thomas.get(`${h}/products`)).data;
  const chips = ps.find((p) => p.name === 'Chips "Grills"');
  assert.equal(chips.unit, 'sachet');
  assert.equal(chips.contenance, '125 g');
  const recs = (await thomas.get(`${h}/products/${chips.id}`)).data.records;
  assert.deepEqual(recs.map((x) => [x.price_cents, x.promo, x.date]).sort(), [[139, false, '2026-10-02'], [93, true, '2026-10-02']].sort());
  assert.equal(chips.prices[Object.keys(chips.prices)[0]].avg, 139); // promo hors moyenne
  const sel = ps.find((p) => p.name === 'Sel');
  const f = (await thomas.get(h)).data;
  assert.equal(f.categories.find((c) => c.id === sel.category_id).name, 'Épicerie'); // rayon par defaut
  assert.ok(f.stores.every((s) => s.categoryOrder.length === f.categories.length)); // nouveau rayon dans chaque parcours

  const again = (await thomas.post(`${h}/products/import`, { csv: CSV })).data;
  assert.equal(again.created.length, 0);
  assert.equal(again.records, 0);
  assert.equal(again.skipped, 3);
});

test('import : fichier sans colonne nom refuse', async () => {
  const r = await thomas.post(`${h}/products/import`, { csv: 'produit;prix\nx;1' });
  assert.equal(r.status, 200); // « produit » est un synonyme de « nom »
  assert.equal((await thomas.post(`${h}/products/import`, { csv: 'article;prix\nx;1' })).status, 400);
});
