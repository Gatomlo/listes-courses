// Generation d'un menu (repas possibles, delai, tags, envies) et import CSV de plats.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');

let server, thomas, lea, h;
before(async () => { server = await start(); ({ thomas, lea, h } = await household()); });
after(() => server.close());

const addDays = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dish = async (b) => (await thomas.post(`${h}/dishes`, b)).data;

test('repas possibles d\'un plat : défaut midi et soir', async () => {
  const p = await dish({ name: 'Porridge', slots: ['pdj', 'xx'] });
  assert.deepEqual(p.slots, ['pdj']);
  const q = await dish({ name: 'Quiche' });
  assert.deepEqual(q.slots, ['midi', 'soir']);
  await thomas.put(`${h}/dishes/${q.id}`, { name: 'Quiche', slots: ['soir', 'midi', 'coll'] });
  assert.deepEqual((await thomas.get(`${h}/dishes`)).data.find((d) => d.name === 'Quiche').slots, ['midi', 'soir', 'coll']);
  // Sans « slots » : inchange.
  await thomas.put(`${h}/dishes/${q.id}`, { name: 'Quiche' });
  assert.deepEqual((await thomas.get(`${h}/dishes/${q.id}`)).data.slots, ['midi', 'soir', 'coll']);
  await thomas.del(`${h}/dishes/${q.id}`);
});

test('génération : tags (tous > certains > aucun), envies, délai, créneaux occupés', async () => {
  // Réglage du foyer.
  assert.equal((await thomas.patch(h, { menu_gap_days: 30 })).data.menu_gap_days, 30);
  const a = await dish({ name: 'Wok', tags: ['rapide', 'végé'] });
  const b = await dish({ name: 'Croque', tags: ['Rapide'] });
  await dish({ name: 'Couscous' });
  const w = await dish({ name: 'Raclette' });
  await thomas.post(`${h}/wishes`, { dish_id: w.id });

  const from = addDays(10), to = addDays(12);
  const body = { from, to, slots: ['midi', 'soir'], tags: ['RAPIDE', 'végé'] };
  assert.equal((await lea.post(`${h}/menu/generate`, body)).status, 403);
  let g = (await thomas.post(`${h}/menu/generate`, body)).data;
  assert.equal(g.gap_days, 30);
  // L'envie d'abord (même sans tag), puis tous les tags, au moins un, aucun.
  assert.deepEqual(g.meals.map((m) => [m.date, m.slot, m.dish]), [
    [from, 'midi', 'Raclette'], [from, 'soir', 'Wok'], [addDays(11), 'midi', 'Croque'], [addDays(11), 'soir', 'Couscous'],
  ]);
  assert.deepEqual(g.wishes_skipped, []);
  assert.ok(g.meals.find((m) => m.dish === 'Raclette').wish);
  assert.equal(g.empty.length, 2);
  // Porridge (petit-déjeuner seulement) n'est jamais proposé le midi ou le soir.
  assert.ok(!g.meals.some((m) => m.dish === 'Porridge'));

  // Délai réduit à la génération : les plats reviennent.
  g = (await thomas.post(`${h}/menu/generate`, { ...body, gap_days: 1 })).data;
  assert.equal(g.meals.length, 6);
  assert.equal(g.empty.length, 0);

  // Créneau occupé : laissé tel quel ; plat déjà prévu dans le délai : écarté.
  await thomas.post(`${h}/meals`, { date: from, slot: 'midi', dish_id: a.id });
  g = (await thomas.post(`${h}/menu/generate`, body)).data;
  assert.ok(!g.meals.some((m) => m.date === from && m.slot === 'midi'));
  assert.ok(!g.meals.some((m) => m.dish === 'Wok'));
  assert.equal(g.meals[0].dish, 'Raclette');
  // Envie servie dans le délai : non placée, raison donnée.
  const g4 = (await thomas.post(`${h}/menu/generate`, { ...body, slots: ['pdj'] })).data;
  assert.match(g4.wishes_skipped[0].reason, /repas non demandés/);

  // Petit-déjeuner sans délai : le porridge chaque jour.
  g = (await thomas.post(`${h}/menu/generate`, { from, to, slots: ['pdj'], gap_days: 0 })).data;
  assert.deepEqual(g.meals.map((m) => m.dish), ['Porridge', 'Porridge', 'Porridge']);
  assert.equal((await thomas.post(`${h}/menu/generate`, { from, to, slots: [] })).status, 400);

  // Enregistrement : repas créés, envie retirée, créneau pris entre-temps ignoré.
  g = (await thomas.post(`${h}/menu/generate`, body)).data;
  const r = await thomas.post(`${h}/menu/generate/apply`, { meals: [...g.meals, { date: from, slot: 'midi', dish_id: b.id }], persons: 3 });
  assert.equal(r.data.added, g.meals.length);
  const menu = (await thomas.get(`${h}/menu?from=${from}&days=3`)).data.meals;
  assert.equal(menu.find((m) => m.date === from && m.slot === 'midi').dish, 'Wok');
  assert.ok(menu.filter((m) => m.dish !== 'Wok').every((m) => m.persons === 3));
  assert.ok(!(await thomas.get(`${h}/wishes`)).data.some((x) => x.dish_id === w.id));
});

test('import CSV de plats : aperçu, création, mise à jour, erreurs', async () => {
  const csv = 'nom;portions;temps;repas;tags;lien;ingrédients;étapes\n'
    + 'Spaghetti bolo;4;45 min;midi, soir;rapide|pâtes;;Spaghetti : 500 g | Tomates pelées : 2 | Ail : 2 gousses | Sel;Cuire | Servir\n'
    + 'Pancakes;;;petit-déjeuner, collation;;https://exemple.be/p;Farine : 250 g;\n'
    + 'Wok;;;souper;asiatique;;;\n'
    + 'Truc;;;déjeuner;;;;\n'
    + ';;;;;;;\n';
  const dry = (await thomas.post(`${h}/dishes/import`, { csv, dry: true })).data;
  assert.equal(dry.dry, true);
  assert.deepEqual(dry.created, ['Spaghetti bolo', 'Pancakes']);
  assert.deepEqual(dry.updated, ['Wok']);
  assert.equal(dry.errors.length, 1);
  assert.match(dry.errors[0].msg, /déjeuner/);
  assert.ok(!(await thomas.get(`${h}/dishes`)).data.some((d) => d.name === 'Pancakes'));
  assert.equal((await lea.post(`${h}/dishes/import`, { csv })).status, 403);

  const r = (await thomas.post(`${h}/dishes/import`, { csv })).data;
  assert.deepEqual(r.products, ['Spaghetti', 'Tomates pelées', 'Ail', 'Sel', 'Farine']);
  const all = (await thomas.get(`${h}/dishes`)).data;
  const bolo = (await thomas.get(`${h}/dishes/${all.find((d) => d.name === 'Spaghetti bolo').id}`)).data;
  assert.equal(bolo.time_text, '45 min');
  assert.deepEqual(bolo.slots, ['midi', 'soir']);
  assert.deepEqual(bolo.tags, ['pâtes', 'rapide']);
  assert.equal(bolo.steps, 'Cuire\nServir');
  assert.deepEqual(bolo.ingredients.map((i) => [i.name, i.qty, i.iunit, i.note]), [
    ['Spaghetti', 500, 'g', null], ['Tomates pelées', 2, null, null], ['Ail', 1, null, '2 gousses'], ['Sel', 1, null, null],
  ]);
  assert.deepEqual(all.find((d) => d.name === 'Pancakes').slots, ['pdj', 'coll']);
  const wok = all.find((d) => d.name === 'Wok');
  assert.deepEqual(wok.slots, ['soir']);
  assert.deepEqual(wok.tags, ['asiatique', 'rapide', 'végé']);
  // Réimporter : rien de nouveau.
  assert.equal((await thomas.post(`${h}/dishes/import`, { csv })).data.created.length, 0);
});

test('import CSV de plats : colonne variantes', async () => {
  const csv = 'nom;ingrédients;variantes\n'
    + 'Stoemp;Pommes de terre : 1 kg;"Viande : saucisse (Saucisse : 4 pièces) / haché (Haché : 400 g + Chapelure : 1) | Légume : carottes (Carottes : 500 g) / nature"\n'
    + 'Raté;;Viande saucisse / haché\n'
    + 'Raté 2;;Viande : (Saucisse)\n';
  const r = (await thomas.post(`${h}/dishes/import`, { csv })).data;
  assert.deepEqual(r.created, ['Stoemp']);
  assert.deepEqual(r.errors.map((e) => e.line), [3, 4]);
  const id = (await thomas.get(`${h}/dishes`)).data.find((d) => d.name === 'Stoemp').id;
  const d = (await thomas.get(`${h}/dishes/${id}`)).data;
  assert.deepEqual(d.ingredients.map((i) => i.name), ['Pommes de terre']);
  assert.deepEqual(d.groups.map((g) => [g.name, g.options.map((o) => [o.name, o.ingredients.map((i) => `${i.name} ${i.qty}${i.iunit || ''}`)])]), [
    ['Viande', [['saucisse', ['Saucisse 4pc']], ['haché', ['Haché 400g', 'Chapelure 1']]]],
    ['Légume', [['carottes', ['Carottes 500g']], ['nature', []]]],
  ]);
});

test('génération : envie déjà servie dans le délai, raison donnée', async () => {
  const f = await dish({ name: 'Fondue' });
  const from = addDays(40), to = addDays(42);
  await thomas.post(`${h}/meals`, { date: addDays(38), slot: 'soir', dish_id: f.id });
  await thomas.post(`${h}/wishes`, { dish_id: f.id });
  const g = (await thomas.post(`${h}/menu/generate`, { from, to, slots: ['midi', 'soir'], gap_days: 30 })).data;
  const s = g.wishes_skipped.find((w) => w.dish === 'Fondue');
  assert.match(s.reason, /délai de 30 j/);
  assert.match(s.reason, new RegExp(addDays(38).split('-').reverse().join('/')));
});
