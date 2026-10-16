const test = require('node:test');
const assert = require('node:assert/strict');
const { parseInstagramHtml } = require('../lib/recipes');

const page = (cap) => `<html><head><meta property="og:image" content="https://cdn.example/x.jpg"><meta property="og:description" content="${cap}"></head></html>`;

test('legende Instagram : ingredients et etapes', () => {
  const cap = '1 234 likes, 56 comments - chef le 3 mars 2024 : &quot;Pâtes crémeuses 🍝 pour 4 personnes&#10;&#10;Ingrédients :&#10;• 300 g de pâtes&#10;• 20 cl de crème&#10;• sel&#10;&#10;Préparation :&#10;1. Cuire les pâtes.&#10;2. Ajouter la crème.&#10;#pates #facile&quot;.';
  const r = parseInstagramHtml(page(cap));
  assert.equal(r.source, 'instagram');
  assert.equal(r.portions, 4);
  assert.deepEqual(r.ingredients.map((i) => i.name), ['pâtes', 'crème', 'sel']);
  assert.deepEqual(r.steps, ['Cuire les pâtes.', 'Ajouter la crème.']);
  assert.equal(r.image, 'https://cdn.example/x.jpg');
});

test('legende Instagram : sans en-tete, lignes avec quantite', () => {
  const r = parseInstagramHtml(page('Super gâteau&#10;200 g de farine&#10;3 oeufs&#10;Mélanger et cuire'));
  assert.deepEqual(r.ingredients.map((i) => i.name), ['farine', 'oeufs']);
});

test('page sans description', () => {
  assert.equal(parseInstagramHtml('<html></html>'), null);
});
