// Repas a l'exterieur : mention sur un creneau du menu, a la place d'un plat.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');

let server, thomas, lea, h;
before(async () => { server = await start(); ({ thomas, lea, h } = await household()); });
after(() => server.close());

const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const menuOf = async (d, days = 1) => (await thomas.get(`${h}/menu?from=${d}&days=${days}`)).data;

test('creneau a l exterieur : remplace le repas, note, retrait, deplacement', async () => {
  const a = (await thomas.post(`${h}/dishes`, { name: 'Gratin' })).data.id;
  const b = (await thomas.post(`${h}/dishes`, { name: 'Soupe' })).data.id;
  const d1 = day(3), d2 = day(4);
  await thomas.post(`${h}/meals`, { date: d1, slot: 'soir', dish_id: a });
  assert.equal((await lea.put(`${h}/outings`, { date: d1, slot: 'soir' })).status, 403);
  assert.equal((await thomas.put(`${h}/outings`, { date: d1, slot: 'nuit' })).status, 400);
  let o = (await thomas.put(`${h}/outings`, { date: d1, slot: 'soir', note: 'Chez Mamie' })).data;
  assert.equal(o.note, 'Chez Mamie');
  let m = await menuOf(d1);
  assert.equal(m.meals.length, 0);
  assert.deepEqual(m.outings.map((x) => [x.slot, x.note]), [['soir', 'Chez Mamie']]);
  // Modifier la note (meme creneau).
  o = (await thomas.put(`${h}/outings`, { date: d1, slot: 'soir', note: '' })).data;
  assert.equal(o.note, null);
  assert.equal((await menuOf(d1)).outings.length, 1);

  // Deplacer un repas vers le creneau : la mention prend sa place.
  const mid = (await thomas.post(`${h}/meals`, { date: d2, slot: 'midi', dish_id: b })).data.id;
  await thomas.patch(`${h}/meals/${mid}`, { date: d1, slot: 'soir' });
  m = await menuOf(d1, 2);
  assert.deepEqual(m.meals.map((x) => [x.date, x.slot]), [[d1, 'soir']]);
  assert.deepEqual(m.outings.map((x) => [x.date, x.slot]), [[d2, 'midi']]);

  // Ajouter un plat sur le creneau retire la mention ; la generation l'ignore.
  await thomas.post(`${h}/meals`, { date: d2, slot: 'midi', dish_id: a });
  assert.equal((await menuOf(d2)).outings.length, 0);
  o = (await thomas.put(`${h}/outings`, { date: d2, slot: 'midi' })).data;
  const g = (await thomas.post(`${h}/menu/generate`, { from: d2, to: d2, slots: ['midi'], gap_days: 0 })).data;
  assert.equal(g.meals.length + g.empty.length, 0);
  const n = (await thomas.post(`${h}/menu/generate/apply`, { meals: [{ date: d2, slot: 'midi', dish_id: b }] })).data.added;
  assert.equal(n, 0);

  // Suggestion acceptee : la mention disparait.
  const s = (await lea.post(`${h}/meals`, { date: d2, slot: 'midi', dish_id: b })).data.id;
  await thomas.post(`${h}/meals/${s}/accept`);
  assert.equal((await menuOf(d2)).outings.length, 0);

  o = (await thomas.put(`${h}/outings`, { date: day(5), slot: 'midi', note: 'Restaurant' })).data;
  assert.equal((await lea.del(`${h}/outings/${o.id}`)).status, 403);
  assert.equal((await thomas.del(`${h}/outings/${o.id}`)).status, 200);
  assert.equal((await thomas.del(`${h}/outings/${o.id}`)).status, 404);
});

test('affichage public : mentions comprises', async () => {
  const d = day(6);
  await thomas.put(`${h}/outings`, { date: d, slot: 'midi', note: 'Pique-nique' });
  const token = (await thomas.post(`${h}/menu-share`, {})).data.token;
  const p = (await thomas.get(`/api/public/menu/${token}?from=${d}&days=1`)).data;
  assert.deepEqual(p.outings, [{ date: d, slot: 'midi', note: 'Pique-nique' }]);
});

test('restes : creneau sans achat, plat facultatif', async () => {
  const a = (await thomas.post(`${h}/dishes`, { name: 'Lasagnes' })).data.id;
  const d = day(9);
  assert.equal((await lea.put(`${h}/outings`, { date: d, slot: 'midi', rest: true })).status, 403);
  assert.equal((await thomas.put(`${h}/outings`, { date: d, slot: 'midi', rest: true, dish_id: 99999 })).status, 404);
  let o = (await thomas.put(`${h}/outings`, { date: d, slot: 'midi', rest: true, dish_id: a, persons: 2 })).data;
  assert.equal(o.rest, true); assert.equal(o.dish, 'Lasagnes'); assert.equal(o.persons, 2);
  o = (await thomas.put(`${h}/outings`, { date: d, slot: 'soir', rest: true, note: 'frigo' })).data;
  assert.equal(o.rest, true); assert.equal(o.dish_id, null); assert.equal(o.note, 'frigo');
  const m = await menuOf(d);
  assert.equal(m.meals.length, 0);
  assert.deepEqual(m.outings.map((x) => [x.slot, x.rest]), [['midi', true], ['soir', true]]);
});
