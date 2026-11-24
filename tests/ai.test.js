// IA facultative (Gemini) : cle, modeles, fonctions et reponses a un faux serveur Google.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');

let server, thomas, lea, h;
before(async () => { server = await start(); ({ thomas, lea, h } = await household()); });
after(() => server.close());

// Faux Google : intercepte seulement generativelanguage.googleapis.com.
const realFetch = global.fetch;
let seen = [], reply = null;
global.fetch = async (url, opts) => {
  if (!String(url).startsWith('https://generativelanguage.googleapis.com')) return realFetch(url, opts);
  const key = opts.headers['x-goog-api-key'];
  seen.push({ url: String(url), key, body: opts.body ? JSON.parse(opts.body) : null });
  const json = (status, data) => ({ ok: status < 400, status, json: async () => data });
  if (key !== 'AIzaGOOD1234567890') return json(400, { error: { message: 'API key not valid. Please pass a valid API key.' } });
  if (String(url).includes('/models?')) return json(200, { models: [
    { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] },
  ] });
  if (reply instanceof Error) throw reply;
  return json(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] });
};

test('sans cle : IA desactivee, les routes refusent proprement', async () => {
  assert.equal((await thomas.get(h)).data.ai, false);
  const r = await thomas.post(`${h}/ai/recipe`, { name: 'Gratin' });
  assert.equal(r.status, 409);
  assert.equal((await lea.get(`${h}/ai`)).status, 403); // reglages : gestionnaires
});

test('cle fausse refusee, cle valide enregistree sans jamais etre renvoyee', async () => {
  let r = await thomas.put(`${h}/ai`, { api_key: 'AIzaBAD' });
  assert.equal(r.status, 400);
  assert.equal((await thomas.get(h)).data.ai, false);
  r = await thomas.put(`${h}/ai`, { api_key: 'AIzaGOOD1234567890', model: 'gemini-2.5-pro' });
  assert.equal(r.status, 200);
  assert.equal(r.data.configured, true);
  assert.equal(r.data.key_hint, 'AIza…7890');
  assert.equal(r.data.model, 'gemini-2.5-pro');
  assert.deepEqual(r.data.models.map((m) => m.id), ['gemini-2.5-pro', 'gemini-2.5-flash']); // texte seulement, plus recent d'abord
  assert.ok(!JSON.stringify(r.data).includes('GOOD1234'));
  const g = (await thomas.get(`${h}/ai`)).data;
  assert.ok(!JSON.stringify(g).includes('GOOD1234'));
  assert.equal((await lea.get(h)).data.ai, true);
});

test('modele : changement sans toucher a la cle ; suppression de la cle', async () => {
  let r = await thomas.put(`${h}/ai`, { model: 'gemini-2.5-flash' });
  assert.equal(r.data.model, 'gemini-2.5-flash');
  assert.equal(r.data.configured, true);
  r = await thomas.del(`${h}/ai/key`);
  assert.equal(r.data.configured, false);
  assert.equal((await thomas.get(h)).data.ai, false);
  assert.equal((await thomas.post(`${h}/ai/items`, { text: 'lait' })).status, 409);
  await thomas.put(`${h}/ai`, { api_key: 'AIzaGOOD1234567890' }); // retour a l'etat configure
});

test('recette suggeree : meme forme que l import, appel avec le modele choisi', async () => {
  seen = [];
  reply = { name: 'Gratin dauphinois', portions: 4, time: '1 h 15', steps: ['Éplucher', 'Cuire au four'], ingredients: [
    { name: 'pomme de terre', quantity: 800, unit: 'g' }, { name: 'crème', quantity: 25, unit: 'cl' },
    { name: 'oeuf', quantity: 2, unit: 'pc' }, { name: 'sel', unit: 'g', base: true }] };
  const r = await thomas.post(`${h}/ai/recipe`, { name: 'Gratin', portions: 4 });
  assert.equal(r.status, 200);
  assert.equal(r.data.source, 'ai');
  assert.equal(r.data.steps.length, 2);
  const [pdt, creme, oeuf, sel] = r.data.ingredients;
  assert.deepEqual([pdt.name, pdt.amount, pdt.amount_unit], ['pomme de terre', 800, 'g']);
  assert.deepEqual([creme.amount, creme.amount_unit], [25, 'cl']);
  assert.deepEqual([oeuf.amount, oeuf.amount_unit], [2, 'pc']);
  assert.equal(sel.base, true);
  const call = seen.find((s) => s.url.includes(':generateContent'));
  assert.ok(call.url.includes('/models/gemini-2.5-flash:generateContent'));
  assert.ok(!call.url.includes('GOOD1234')); // cle en en-tete seulement
  assert.equal((await thomas.post(`${h}/ai/recipe`, { name: '' })).status, 400);
});

test('plat a partir de produits', async () => {
  reply = { name: 'Poêlée de courgettes', portions: 2, steps: ['Couper', 'Poêler'], ingredients: [{ name: 'courgette', quantity: 2, unit: 'pc' }] };
  const r = await thomas.post(`${h}/ai/dish`, { names: ['Courgette', 'Feta'], portions: 2 });
  assert.equal(r.data.name, 'Poêlée de courgettes');
  assert.equal(r.data.ingredients[0].name, 'courgette');
  assert.equal((await thomas.post(`${h}/ai/dish`, { names: [] })).status, 400);
});

test('rapprochement de libelles : seuls les produits du foyer sont acceptes', async () => {
  const cat = (await thomas.get(h)).data.categories[0].id;
  const lait = (await thomas.post(`${h}/products`, { name: 'Lait demi-écrémé', category_id: cat })).data;
  reply = { matches: [{ i: 0, product_id: lait.id }, { i: 1, product_id: 999999 }, { i: 2, product_id: null }] };
  const r = await lea.post(`${h}/ai/match`, { labels: ['LT DEMI ECR 1L', 'XYZ', 'ABC'] });
  assert.deepEqual(r.data.product_ids, [lait.id, null, null]);
});

test('ajout multiple en langage libre', async () => {
  reply = { items: [{ name: 'pâtes', qty: 1 }, { name: 'sauce tomate' }] };
  const r = await lea.post(`${h}/ai/items`, { text: 'un paquet de pâtes et une sauce tomate' });
  assert.deepEqual(r.data.items, [{ name: 'pâtes', qty: 1 }, { name: 'sauce tomate', qty: 1 }]);
});

test('Gemini en panne : erreur 502 propre (l interface retombe sur l existant)', async () => {
  reply = new Error('boom');
  const r = await thomas.post(`${h}/ai/items`, { text: 'lait' });
  assert.equal(r.status, 502);
  reply = 'pas du json {';
  assert.equal((await thomas.post(`${h}/ai/items`, { text: 'lait' })).status, 502);
});
