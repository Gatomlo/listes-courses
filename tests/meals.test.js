// Etape 6 : plats, repas, ingredients dans les listes, lien d'affichage, import de recette.
process.env.CABAS_ALLOW_PRIVATE_FETCH = '1'; // page de recette servie en local
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { start, household, client } = require('./helpers');
const { parseIngredient, parseRecipeHtml, privateIp } = require('../lib/recipes');

let server, thomas, lea, h, cat, P = {}, D = {}, l1, l2;
before(async () => {
  server = await start();
  ({ thomas, lea, h } = await household());
  cat = (await thomas.get(h)).data.categories[0].id;
  for (const [k, name, base] of [['oign', 'Oignons'], ['hache', 'Haché'], ['toma', 'Tomates concassées'], ['hari', 'Haricots rouges'], ['huile', 'Huile', true], ['lasa', 'Feuilles de lasagne']]) {
    P[k] = (await thomas.post(`${h}/products`, { name, category_id: cat, is_base: !!base })).data.id;
  }
  l1 = (await thomas.post(`${h}/lists`, { date: '2030-01-04', recurring: false })).data.id;
  l2 = (await thomas.post(`${h}/lists`, { date: '2030-01-18', recurring: false })).data.id;
});
after(() => server.close());

const list = async (id) => (await thomas.get(`${h}/lists/${id}`)).data;
const item = (l, k) => l.items.find((i) => i.product_id === P[k] && !i.suggestion);

test('plats : creation, doublon, droits, fiche', async () => {
  let r = await thomas.post(`${h}/dishes`, { name: 'Lasagnes', portions: 4, steps: 'Monter les couches', ingredients: [
    { product_id: P.hache, qty: 1 }, { product_id: P.toma, qty: 2 }, { product_id: P.oign, qty: 2 }, { product_id: P.lasa, qty: 1 }, { product_id: P.huile }] });
  assert.equal(r.status, 201);
  D.lasa = r.data.id;
  assert.equal(r.data.ingredients.length, 5);
  r = await thomas.post(`${h}/dishes`, { name: 'Chili', portions: 4, url: 'https://exemple.be/chili', ingredients: [{ product_id: P.hache, qty: 1 }, { product_id: P.hari, qty: 2 }, { product_id: P.oign, qty: 1 }] });
  D.chili = r.data.id;
  D.croque = (await thomas.post(`${h}/dishes`, { name: 'Croque-monsieur' })).data.id;
  assert.equal((await thomas.post(`${h}/dishes`, { name: 'lasagnes' })).status, 409);
  assert.equal((await lea.post(`${h}/dishes`, { name: 'Crêpes' })).status, 403);
  const all = (await lea.get(`${h}/dishes`)).data;
  assert.equal(all.length, 3);
  assert.ok(all.find((d) => d.name === 'Chili').ingredient_names.includes('Oignons'));
});

test('repas -> ingredients fusionnes dans la liste de la periode, base a verifier', async () => {
  await thomas.post(`${h}/meals`, { date: '2030-01-05', slot: 'soir', dish_id: D.lasa, persons: 4 });
  await thomas.post(`${h}/meals`, { date: '2030-01-09', slot: 'midi', dish_id: D.chili, persons: 6 });
  await thomas.post(`${h}/meals`, { date: '2030-01-10', slot: 'soir', dish_id: D.croque, persons: 4 });
  const l = await list(l1);
  assert.equal(item(l, 'hache').qty, 3, '1 + 1,5 -> 3 (arrondi a l\'emballage)');
  assert.equal(item(l, 'oign').qty, 4, '2 + 1,5 -> 4');
  assert.deepEqual(item(l, 'oign').from.sort(), ['Chili', 'Lasagnes']);
  assert.equal(item(l, 'oign').origin, 'meal');
  assert.ok(!item(l, 'huile'), 'ingredient de base non ajoute');
  assert.deepEqual(l.base.map((b) => b.name), ['Huile']);
  assert.deepEqual(l.meals.map((m) => m.dish), ['Lasagnes', 'Chili', 'Croque-monsieur']);
  assert.equal((await list(l2)).items.length, 0);
});

test('part manuelle + part repas ; retirer un repas garde la part manuelle', async () => {
  await thomas.post(`${h}/lists/${l1}/items`, { product_id: P.oign, qty: 2 });
  let l = await list(l1);
  assert.equal(item(l, 'oign').qty, 6);
  assert.equal(item(l, 'oign').manual_qty, 2);
  // Quantite saisie = total : part manuelle = total - repas
  await thomas.patch(`${h}/items/${item(l, 'oign').id}`, { qty: 5 });
  assert.equal(item(await list(l1), 'oign').manual_qty, 1);
  const menu = (await thomas.get(`${h}/menu?from=2030-01-01&days=14`)).data;
  const chili = menu.meals.find((m) => m.dish === 'Chili');
  await thomas.del(`${h}/meals/${chili.id}`);
  l = await list(l1);
  assert.equal(item(l, 'oign').qty, 3, '2 (lasagnes) + 1 manuel');
  assert.ok(!item(l, 'hari'), 'haricots retires');
  await thomas.post(`${h}/meals`, { date: '2030-01-09', slot: 'midi', dish_id: D.chili, persons: 6 });
});

test('cocher garde l\'article ; en reserve ; retirer un article de repas', async () => {
  let l = await list(l1);
  await lea.patch(`${h}/items/${item(l, 'hache').id}`, { status: 'bought' });
  await thomas.post(`${h}/meals`, { date: '2030-01-11', slot: 'soir', dish_id: D.lasa, persons: 2 });
  l = await list(l1);
  assert.equal(item(l, 'hache').status, 'bought', 'coche conserve apres recalcul');
  assert.equal(item(l, 'hache').qty, 3, '1 + 1,5 + 0,5 = 3');
  // Tomates en reserve pour tous leurs repas
  let r = await thomas.post(`${h}/items/${item(l, 'toma').id}/in-stock`);
  assert.ok(!item(r.data, 'toma'));
  // Retirer l'article des haricots (repas) : ne revient pas au recalcul suivant
  await thomas.del(`${h}/items/${item(r.data, 'hari').id}`);
  await thomas.post(`${h}/meals`, { date: '2030-01-12', slot: 'soir', dish_id: D.croque, persons: 4 });
  assert.ok(!item(await list(l1), 'hari'));
  const m = (await thomas.get(`${h}/menu?from=2030-01-01&days=14`)).data.meals.find((x) => x.dish === 'Chili');
  assert.deepEqual(m.skip, [P.hari]);
});

test('repas rattache a une autre liste ; creneau remplace', async () => {
  const menu = (await thomas.get(`${h}/menu?from=2030-01-01&days=14`)).data;
  const lasa2 = menu.meals.find((x) => x.date === '2030-01-11');
  await thomas.patch(`${h}/meals/${lasa2.id}`, { list_id: l2 });
  assert.equal(item(await list(l2), 'lasa').qty, 1);
  await thomas.patch(`${h}/meals/${lasa2.id}`, { list_id: '' });
  assert.ok(!item(await list(l2), 'lasa'));
  await thomas.post(`${h}/meals`, { date: '2030-01-12', slot: 'soir', dish_id: D.lasa, persons: 4 });
  const after = (await thomas.get(`${h}/menu?from=2030-01-12&days=1`)).data.meals;
  assert.deepEqual(after.map((x) => x.dish), ['Lasagnes'], 'croque remplace');
});

test('suggestion de repas par un membre', async () => {
  const r = await lea.post(`${h}/meals`, { date: '2030-01-13', slot: 'midi', dish_id: D.chili, persons: 4 });
  assert.equal(r.status, 201);
  const s = (await thomas.get(`${h}/suggestions`)).data.filter((x) => x.kind === 'meal');
  assert.equal(s.length, 1);
  assert.equal(s[0].suggested_by_name, 'Lea');
  const before = item(await list(l1), 'oign').qty;
  assert.equal((await lea.post(`${h}/meals/${s[0].id}/accept`)).status, 403);
  await thomas.post(`${h}/meals/${s[0].id}/accept`);
  assert.equal(item(await list(l1), 'oign').qty, before + 1);
});

test('cloture : la quantite totale est reportee', async () => {
  const l = await list(l1);
  const oign = item(l, 'oign').qty;
  await thomas.post(`${h}/lists/${l1}/close`, { fates: {} });
  const n = item(await list(l2), 'oign');
  assert.equal(n.qty, oign);
  assert.equal(n.origin, 'carried');
});

test('suppression d\'un plat : repas a venir retires, historique garde ; produit supprime retire des plats', async () => {
  await thomas.post(`${h}/meals`, { date: '2030-01-20', slot: 'soir', dish_id: D.chili, persons: 4 });
  assert.ok(item(await list(l2), 'hari').meal_qty > 0);
  await thomas.del(`${h}/dishes/${D.chili}`);
  const hari = item(await list(l2), 'hari');
  assert.equal(hari.meal_qty, 0, 'part repas retiree');
  assert.equal(hari.qty, hari.manual_qty, 'part reportee gardee');
  assert.equal((await thomas.get(`${h}/dishes/${D.chili}`)).status, 404);
  await thomas.del(`${h}/products/${P.lasa}`);
  assert.ok(!(await thomas.get(`${h}/dishes/${D.lasa}`)).data.ingredients.some((i) => i.product_id === P.lasa));
});

test('historique d\'un plat : a venir et 5 dernieres fois', async () => {
  const d = (await thomas.get(`${h}/dishes/${D.lasa}`)).data;
  assert.ok(Array.isArray(d.upcoming) && Array.isArray(d.past));
  assert.ok(d.past.length <= 5);
});

test('lien d\'affichage du menu : lecture seule sans connexion, revocable', async () => {
  const { token } = (await thomas.post(`${h}/menu-share`, {})).data;
  const anon = client();
  let r = await anon.get(`/api/public/menu/${token}?from=2030-01-01&days=31`);
  assert.equal(r.status, 200);
  assert.equal(r.data.household, 'Foyer Phoenix');
  assert.ok(r.data.meals.some((m) => m.dish === 'Lasagnes'));
  assert.ok(!r.data.meals.some((m) => m.suggestion), 'pas de suggestions');
  await thomas.post(`${h}/menu-share`, { action: 'revoke' });
  r = await anon.get(`/api/public/menu/${token}`);
  assert.equal(r.status, 404);
});

test('lecture des ingredients et des recettes', () => {
  const ka = (s) => ['qty', 'unit', 'name', 'amount', 'amount_unit'].map((k) => parseIngredient(s)[k]);
  assert.deepEqual(ka('1,2 kg de pommes de terre'), [1.2, 'kg', 'pommes de terre', 1.2, 'kg']);
  assert.deepEqual(ka("2 gousses d'ail"), [2, 'gousses', 'ail', null, null]);
  assert.deepEqual(ka('3 oignons'), [3, null, 'oignons', 3, 'pc']);
  assert.deepEqual(ka('2 boîtes de pois chiches'), [2, 'boîtes', 'pois chiches', 2, null]);
  assert.deepEqual(ka("2 c. à s. d'huile").slice(3), [2, 'cs']);
  assert.deepEqual(ka('1 C. à café cumin').slice(2), ['cumin', 1, 'cc']);
  assert.deepEqual(ka("2 C. à soupe d'huile d'olive").slice(2), ["huile d'olive", 2, 'cs']);
  assert.deepEqual(ka('1 càs de miel').slice(2), ['miel', 1, 'cs']);
  assert.deepEqual(ka('3 cuillerées à café de thé').slice(2), ['thé', 3, 'cc']);
  assert.deepEqual(ka('2 cacahuètes').slice(2), ['cacahuètes', 2, 'pc']);
  assert.equal(parseRecipeHtml(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'X', image: [{ '@type': 'ImageObject', url: 'https://ex.be/p.jpg' }] })}</script>`).image, 'https://ex.be/p.jpg');
  assert.equal(parseIngredient('Sel, poivre').base, true);
  assert.equal(parseIngredient('½ litre de lait').qty, 0.5);
  const html = `<html><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"Recipe","name":"Gratin dauphinois","recipeYield":"6 personnes","totalTime":"PT1H30M",
    "recipeIngredient":["1,2 kg de pommes de terre","50 cl de crème fraîche","Sel, poivre"],"recipeInstructions":[{"@type":"HowToStep","text":"Éplucher."},{"@type":"HowToStep","text":"Cuire 1 h."}]}]}</script></html>`;
  const r = parseRecipeHtml(html);
  assert.equal(r.name, 'Gratin dauphinois');
  assert.equal(r.portions, 6);
  assert.equal(r.time, '1 h 30');
  assert.deepEqual(r.steps, ['Éplucher.', 'Cuire 1 h.']);
  assert.equal(r.ingredients.length, 3);
  assert.equal(parseRecipeHtml('<html>rien</html>'), null);
  const ent = parseRecipeHtml(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Gratin d&#x27;endives', recipeIngredient: ['200 g d&amp;#x27;emmental'], recipeInstructions: 'Pr&eacute;chauffer l&#39;four' })}</script>`);
  assert.equal(ent.name, "Gratin d'endives");
  assert.equal(ent.ingredients[0].raw, "200 g d'emmental");
  assert.deepEqual(ent.steps, ["Préchauffer l'four"]);
  assert.ok(privateIp('127.0.0.1') && privateIp('10.1.2.3') && privateIp('192.168.1.1') && privateIp('::1') && !privateIp('8.8.8.8'));
});

test('photo d un plat : envoi, lecture, photo d une recette importee, retrait', async () => {
  const { baseUrl } = require('./helpers');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  let r = await thomas.post(`${h}/dishes`, { name: 'Tarte photo', photo_data: `data:image/png;base64,${png}` });
  assert.equal(r.status, 201);
  const d = r.data;
  assert.match(d.photo, /^h\/\d+\/dishes\/\d+\/photo\?v=/);
  const get = await fetch(`${baseUrl()}/api/${d.photo}`, { headers: { cookie: thomas.cookie() } });
  assert.equal(get.status, 200);
  assert.equal(Buffer.from(await get.arrayBuffer()).toString('base64'), png);
  assert.equal((await fetch(`${baseUrl()}/api/${d.photo}`)).status, 401, 'connexion requise');
  assert.equal((await thomas.put(`${h}/dishes/${d.id}`, { name: 'Tarte photo', photo_data: 'data:text/html;base64,AAAA' })).status, 400);
  // Photo de la recette (adresse) telechargee par le serveur.
  const img = http.createServer((req, res) => { res.setHeader('content-type', 'image/png'); res.end(Buffer.from(png, 'base64')); }).listen(0);
  await new Promise((ok) => img.once('listening', ok));
  r = await thomas.put(`${h}/dishes/${d.id}`, { name: 'Tarte photo', photo_url: `http://127.0.0.1:${img.address().port}/p.png` });
  img.close();
  assert.equal(r.status, 200);
  assert.notEqual(r.data.photo, d.photo);
  assert.ok((await thomas.get(`${h}/dishes`)).data.find((x) => x.id === d.id).photo);
  r = await thomas.put(`${h}/dishes/${d.id}`, { name: 'Tarte photo', photo: null });
  assert.equal(r.data.photo, null);
  assert.equal((await thomas.get(`${h}/dishes/${d.id}/photo`)).status, 404);
});

test('import depuis un lien (page servie en local) ; page sans recette', async () => {
  const page = http.createServer((req, res) => {
    if (req.url === '/redir') { res.writeHead(302, { location: '/recette' }); return res.end(); }
    if (req.url === '/interdit') { res.writeHead(403); return res.end(); }
    res.setHeader('content-type', 'text/html');
    res.end(req.url === '/recette' ? '<script type="application/ld+json">{"@type":"Recipe","name":"Soupe","recipeYield":4,"recipeIngredient":["3 poireaux"],"recipeInstructions":"Mixer."}</script>' : '<p>Rien</p>');
  }).listen(0);
  await new Promise((r) => page.once('listening', r));
  const base = `http://127.0.0.1:${page.address().port}`;
  let r = await thomas.post(`${h}/recipe-import`, { url: `${base}/redir` });
  assert.equal(r.status, 200);
  assert.equal(r.data.name, 'Soupe');
  assert.deepEqual([r.data.ingredients[0].amount, r.data.ingredients[0].amount_unit], [3, 'pc']);
  r = await thomas.post(`${h}/recipe-import`, { url: `${base}/vide` });
  assert.equal(r.status, 422);
  r = await thomas.post(`${h}/recipe-import`, { url: 'ftp://exemple.be/x' });
  assert.equal(r.status, 400);
  // Site qui refuse le serveur : message lisible (pas « erreur interne »).
  r = await thomas.post(`${h}/recipe-import`, { url: `${base}/interdit` });
  assert.equal(r.status, 502);
  assert.match(r.data.error, /refuse la lecture automatique \(403\)/);
  // Repli : ingredients colles.
  r = await thomas.post(`${h}/recipe-import`, { text: '• 300 g de farine\n\n3 oeufs\n' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.ingredients.map((g) => [g.amount, g.amount_unit]), [[300, 'g'], [3, 'pc']]);
  assert.equal((await thomas.post(`${h}/recipe-import`, { text: ' ' })).status, 400);
  page.close();
});
