// Menus (periodes debut -> fin) et deplacement d'un repas.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');

let server, thomas, lea, h;
before(async () => { server = await start(); ({ thomas, lea, h } = await household()); });
after(() => server.close());

const at = async (d) => (await thomas.get(`${h}/menu?at=${d}`)).data.period;
const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
const days = (p) => Math.round((Date.parse(p.end) - Date.parse(p.start)) / 86400000) + 1;

test('periode proposee : 15 jours a partir du lundi, puis reglages du foyer', async () => {
  const today = new Date().toISOString().slice(0, 10);
  let p = await at(today);
  assert.equal(p.saved, false);
  assert.equal(dow(p.start), 1);
  assert.equal(days(p), 15);
  assert.ok(p.start <= today && today <= p.end);
  // Periodes suivante et precedente : jointives.
  const next = await at(new Date(Date.parse(p.end) + 86400000).toISOString().slice(0, 10));
  assert.equal(Date.parse(next.start) - Date.parse(p.end), 86400000);

  assert.equal((await lea.patch(h, { menu_days: 10 })).status, 403);
  const f = (await thomas.patch(h, { menu_days: 14, menu_start_dow: 5 })).data;
  assert.equal(f.menu_days, 14);
  p = await at(today);
  assert.equal(dow(p.start), 5);
  assert.equal(days(p), 14);
});

test('menus enregistres : dates libres, pas de chevauchement, suite proposee', async () => {
  assert.equal((await lea.post(`${h}/menus`, { start: '2030-03-01', end: '2030-03-15' })).status, 403);
  const a = (await thomas.post(`${h}/menus`, { start: '2030-03-01', end: '2030-03-15' })).data;
  assert.deepEqual([a.start, a.end, a.saved], ['2030-03-01', '2030-03-15', true]);
  assert.equal((await thomas.post(`${h}/menus`, { start: '2030-03-10', end: '2030-03-20' })).status, 409);
  assert.equal((await thomas.post(`${h}/menus`, { start: '2030-03-20', end: '2030-03-10' })).status, 400);
  // Suite : commence le lendemain, duree par defaut (14), coupee avant le menu suivant.
  let p = await at('2030-03-16');
  assert.deepEqual([p.start, p.end, p.saved], ['2030-03-16', '2030-03-29', false]);
  await thomas.post(`${h}/menus`, { start: '2030-03-22', end: '2030-04-02' });
  p = await at('2030-03-16');
  assert.deepEqual([p.start, p.end], ['2030-03-16', '2030-03-21']);
  // Avant le premier menu : tranches en remontant.
  p = await at('2030-02-20');
  assert.deepEqual([p.start, p.end], ['2030-02-15', '2030-02-28']);
  // Modification, suppression.
  assert.equal((await thomas.patch(`${h}/menus/${a.id}`, { start: '2030-02-28', end: '2030-03-14' })).data.start, '2030-02-28');
  assert.equal((await thomas.del(`${h}/menus/${a.id}`)).status, 200);
  assert.equal((await at('2030-03-05')).saved, false);
  const r = (await thomas.get(`${h}/menu?at=2030-03-25`)).data;
  assert.deepEqual([r.from, r.to], ['2030-03-22', '2030-04-02']);
});

test('deplacer un repas : vers un creneau libre, echange avec un creneau occupe', async () => {
  const cat = (await thomas.get(h)).data.categories[0].id;
  const pid = (await thomas.post(`${h}/products`, { name: 'Pâtes', category_id: cat })).data.id;
  const d1 = (await thomas.post(`${h}/dishes`, { name: 'Bolo', portions: 4, ingredients: [{ product_id: pid, qty: 1 }] })).data.id;
  const d2 = (await thomas.post(`${h}/dishes`, { name: 'Soupe', portions: 4, ingredients: [] })).data.id;
  const m1 = (await thomas.post(`${h}/meals`, { date: '2030-05-06', slot: 'soir', dish_id: d1 })).data.id;
  const m2 = (await thomas.post(`${h}/meals`, { date: '2030-05-07', slot: 'midi', dish_id: d2 })).data.id;
  const meals = async () => Object.fromEntries((await thomas.get(`${h}/menu?from=2030-05-06&days=3`)).data.meals.map((m) => [m.id, `${m.date} ${m.slot}`]));

  await thomas.patch(`${h}/meals/${m1}`, { date: '2030-05-08', slot: 'soir' });
  assert.deepEqual(await meals(), { [m1]: '2030-05-08 soir', [m2]: '2030-05-07 midi' });
  await thomas.patch(`${h}/meals/${m1}`, { date: '2030-05-07', slot: 'midi' });
  assert.deepEqual(await meals(), { [m1]: '2030-05-07 midi', [m2]: '2030-05-08 soir' });
  assert.equal((await lea.patch(`${h}/meals/${m1}`, { date: '2030-05-06' })).status, 403);
});

test('remarques du menu : par premier jour, gestionnaire, vide = supprimee', async () => {
  const note = async () => (await thomas.get(`${h}/menu?from=2030-06-03&days=7`)).data.note;
  assert.equal(await note(), '');
  assert.equal((await lea.put(`${h}/menu-note`, { start: '2030-06-03', note: 'x' })).status, 403);
  assert.equal((await thomas.put(`${h}/menu-note`, { start: '2030-06-03', note: ' Anniv mamie samedi ' })).data.note, 'Anniv mamie samedi');
  assert.equal(await note(), 'Anniv mamie samedi');
  assert.equal((await thomas.get(`${h}/menu?from=2030-06-04&days=7`)).data.note, '');
  await thomas.put(`${h}/menu-note`, { start: '2030-06-03', note: '' });
  assert.equal(await note(), '');
});
