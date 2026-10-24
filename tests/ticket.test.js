// Etape 5 : lecture d'un ticket (texte OCR) et rapprochement avec le catalogue.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../public/app/ticket.mjs');

const COLRUYT = `COLRUYT JAMBES
Rue de la Gare 12 - 5100 Jambes
TVA BE 0400.378.485
03/10/2026 10:42  Caisse 4
LAIT DEMI ECR 1L        0,99
TOMAT CONC 400G
3 x 0,65                1,95
CAFE MOULU 500G         5,79
REMISE                 -0,50
PAPIER TOIL X12         5,99
2 X 2,49 YAOURT NAT X8  4,98
SOUS-TOTAL             19,70
TOTAL                  19,70
BANCONTACT             19,70
MERCI DE VOTRE VISITE`;

test('lecture : articles, quantites, remise, totaux ignores, date', async () => {
  const { parseTicket } = await load();
  const t = parseTicket(COLRUYT);
  assert.equal(t.date, '2026-10-03');
  assert.deepEqual(t.items.map((i) => i.label), ['LAIT DEMI ECR 1L', 'TOMAT CONC 400G', 'CAFE MOULU 500G', 'PAPIER TOIL X12', 'YAOURT NAT X8']);
  const [lait, tomat, cafe, , yaourt] = t.items;
  assert.deepEqual([lait.qty, lait.unit, lait.total], [1, 0.99, 0.99]);
  assert.deepEqual([tomat.qty, tomat.unit, tomat.total], [3, 0.65, 1.95]);
  assert.deepEqual([cafe.unit, cafe.total, cafe.promo], [5.29, 5.29, true]);
  assert.deepEqual([yaourt.qty, yaourt.unit], [2, 2.49]);
});

test('magasin detecte dans le texte', async () => {
  const { detectStore } = await load();
  const stores = [{ id: 1, name: 'Intermarché' }, { id: 2, name: 'Colruyt' }];
  assert.equal(detectStore(COLRUYT, stores), 2);
  assert.equal(detectStore('INTERMARCHE SUPER', stores), 1);
  assert.equal(detectStore('ALDI', stores), null);
});

test('rapprochement : correspondance memorisee, ressemblance, inconnu', async () => {
  const { parseTicket, matchLines, normLabel } = await load();
  const products = [
    { id: 1, name: 'Lait demi-écrémé 1 L' }, { id: 2, name: 'Tomates concassées 400 g' }, { id: 3, name: 'Café moulu 500 g' },
    { id: 4, name: 'Papier toilette x12' }, { id: 5, name: 'Yaourts nature x8' }, { id: 6, name: 'Lait de coco 400 ml' },
  ];
  const aliases = [{ store_id: 2, label_norm: normLabel('PAPIER TOIL X12'), product_id: 4 }];
  const lines = matchLines(parseTicket(COLRUYT + '\nCHIPS PAPRIKA 200G 1,89').items, {
    products, aliases, storeId: 2, listItems: [{ product_id: 1, at_store_id: 2 }],
  });
  const by = Object.fromEntries(lines.map((l) => [l.label, l]));
  assert.equal(by['LAIT DEMI ECR 1L'].product_id, 1, 'lait demi (pas lait de coco)');
  assert.equal(by['TOMAT CONC 400G'].product_id, 2);
  assert.equal(by['CAFE MOULU 500G'].product_id, 3);
  assert.equal(by['PAPIER TOIL X12'].how, 'alias');
  assert.equal(by['YAOURT NAT X8'].product_id, 5);
  assert.equal(by['CHIPS PAPRIKA 200G'].product_id, null, 'a associer');
});

test('ticket Collect&Go (PDF) : quantite, prix unitaire, remises sur la ligne suivante', async () => {
  const { parseTicket } = await load();
  const t = parseTicket(`ATH (COLRUYT) info@collectandgo.be
Date: 03/10/2026 18:05
N° ART. DESCRIPTION QUANT. PRIX UNIT. (EUR) MONTANT (EUR)
26700 BONI beurre de laiterie doux 250g 2 1.89 3.78
27403 HERTA KNACKI Original 10pc 1 2.66 2.66
A000317364-SCP-
S_0 Réduction B0102838 25% -0.67
8562 SOIGNON pyramide from.chèvre nature 150g 1 2.99 2.99
A000317928-SCP-
S_0 produit gratuit 100% -2.99`);
  assert.equal(t.date, '2026-10-03');
  assert.deepEqual(t.items.map((i) => [i.label, i.qty, i.unit, i.total, i.promo]), [
    ['BONI beurre de laiterie doux 250g', 2, 1.89, 3.78, false],
    ['HERTA KNACKI Original 10pc', 1, 1.99, 1.99, true],
    ['SOIGNON pyramide from.chèvre nature 150g', 1, 2.99, 0, true],
  ]);
});
