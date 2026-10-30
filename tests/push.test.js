// Rappels (notifications) : reglages par utilisateur, abonnements, contenu des deux
// rappels de la veille, planificateur (heure, une fois par jour, abonnements expires).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, household } = require('./helpers');
const P = require('../lib/push');

let server, thomas, lea, h, hid;
before(async () => { server = await start(); ({ thomas, lea, h, hid } = await household()); });
after(() => server.close());

const sent = [];
P.setSender(async (sub, payload) => {
  if (sub.endpoint.includes('expire')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
  sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) });
});
const sub = (name) => ({ endpoint: `https://push.exemple.org/${name}`, keys: { p256dh: 'BKey', auth: 'auth' } });
// 10 mars 2030, 17 h 45 UTC = 18 h 45 a Bruxelles (heure d'hiver) ; lendemain = 11 mars.
const AT = new Date('2030-03-10T17:45:00Z'), D = '2030-03-11';

test('reglages, abonnements et droits', async () => {
  assert.ok((await thomas.get('/api/push/key')).data.key.length > 40);
  let p = (await thomas.get(`${h}/push`)).data;
  assert.deepEqual([p.menu_on, p.menu_time, p.devices], [false, '19:00', 0]);
  assert.equal((await thomas.put(`${h}/push`, { menu_time: '25:00' })).status, 400);
  assert.equal((await thomas.post(`${h}/push/subscribe`, { endpoint: 'http://x', keys: {} })).status, 400);
  p = (await thomas.post(`${h}/push/subscribe`, sub('thomas'))).data;
  assert.equal(p.devices, 1);
  // Reglages propres a chacun : un membre regle les siens.
  p = (await lea.put(`${h}/push`, { menu_on: true, menu_time: '18:00' })).data;
  assert.deepEqual([p.menu_on, p.menu_time], [true, '18:00']);
  assert.equal((await thomas.get(`${h}/push`)).data.menu_on, false);
  // Essai sans abonnement : refuse.
  assert.equal((await lea.post(`${h}/push/test`, {})).status, 409);
  const t = await thomas.post(`${h}/push/test`, {});
  assert.equal(t.data.sent, 1);
  assert.equal(sent.pop().title, 'Demain au menu');
  p = (await thomas.post(`${h}/push/unsubscribe`, { endpoint: sub('thomas').endpoint })).data;
  assert.equal(p.devices, 0);
});

test('contenu : menu du lendemain puis a faire a l avance, un seul message (composants compris)', async () => {
  const lasagnes = (await thomas.post(`${h}/dishes`, { name: 'Lasagnes', ahead: 'Sortir le haché du congélateur' })).data;
  assert.equal(lasagnes.ahead, 'Sortir le haché du congélateur');
  // Enregistrer sans `ahead` : inchange.
  assert.equal((await thomas.put(`${h}/dishes/${lasagnes.id}`, { name: 'Lasagnes' })).data.ahead, 'Sortir le haché du congélateur');
  const houmous = (await thomas.post(`${h}/dishes`, { name: 'Houmous', ahead: 'Faire tremper les pois chiches' })).data.id;
  const taboule = (await thomas.post(`${h}/dishes`, { name: 'Taboulé' })).data.id;
  const mezze = (await thomas.post(`${h}/dishes`, { name: 'Mezze', parts: [{ dish_id: houmous, portions: 4 }, { dish_id: taboule, portions: 4 }] })).data.id;
  await thomas.post(`${h}/meals`, { date: D, slot: 'midi', dish_id: mezze, persons: 6 });
  await thomas.post(`${h}/meals`, { date: D, slot: 'soir', dish_id: lasagnes.id });
  // Suggestion d'un membre : ignoree.
  await lea.post(`${h}/meals`, { date: D, slot: 'pdj', dish_id: taboule });

  const menu = P.content(hid, 'menu', D);
  assert.equal(menu.body, 'Midi : Mezze · 6 pers.\nSoir : Lasagnes\nÀ préparer : Houmous (midi) : Faire tremper les pois chiches\nLasagnes (soir) : Sortir le haché du congélateur');
  const ahead = P.content(hid, 'ahead', D);
  assert.equal(ahead.title, 'À préparer pour demain');
  assert.equal(ahead.body, 'Houmous (midi) : Faire tremper les pois chiches\nLasagnes (soir) : Sortir le haché du congélateur');
  assert.equal(ahead.url, '#/menu');
  assert.equal(P.content(hid, 'menu', '2030-03-12'), null);
  assert.equal(P.content(hid, 'ahead', '2030-03-12'), null);
});

test('remarque propre a un repas : delai en jours, ce repas seulement', async () => {
  const salade = (await thomas.post(`${h}/dishes`, { name: 'Salade verte' })).data.id;
  const mid = (await thomas.post(`${h}/meals`, { date: '2031-05-12', slot: 'soir', dish_id: salade, note: 'Acheter une salade fraîche', note_days: 1 })).data.id;
  assert.equal(P.content(hid, 'menu', '2031-05-12').body, 'Soir : Salade verte\nÀ préparer : Salade verte (soir) : Acheter une salade fraîche');
  assert.equal(P.content(hid, 'menu', '2031-05-11'), null);
  await thomas.patch(`${h}/meals/${mid}`, { note_days: 2 });
  assert.equal(P.content(hid, 'menu', '2031-05-12').body, 'Soir : Salade verte');
  const m = P.content(hid, 'menu', '2031-05-11');
  assert.equal(m.title, 'À préparer pour demain');
  assert.match(m.body, /^Salade verte \(\S+ soir\) : Acheter une salade fraîche$/);
  await thomas.patch(`${h}/meals/${mid}`, { note: '' });
  assert.equal(P.content(hid, 'menu', '2031-05-11'), null);
});

test('planificateur : a l heure, une fois par jour, abonnements expires oublies', async () => {
  sent.length = 0;
  await thomas.post(`${h}/push/subscribe`, sub('thomas-tel'));
  await thomas.post(`${h}/push/subscribe`, sub('thomas-expire'));
  await lea.post(`${h}/push/subscribe`, sub('lea'));
  await thomas.put(`${h}/push`, { menu_on: true, menu_time: '18:30' });
  await lea.put(`${h}/push`, { menu_on: true, menu_time: '21:00' });

  let r = await P.tick(AT);
  assert.deepEqual(r.map((x) => x.kind), ['menu']);
  assert.deepEqual(sent.map((s) => [s.endpoint.split('/').pop(), s.title]), [['thomas-tel', 'Demain au menu']]);
  assert.equal((await thomas.get(`${h}/push`)).data.devices, 1); // abonnement expire retire

  // Meme jour : rien de plus ; 21 h : le rappel de lea.
  sent.length = 0;
  assert.equal((await P.tick(new Date('2030-03-10T18:10:00Z'))).length, 0);
  r = await P.tick(new Date('2030-03-10T20:05:00Z'));
  assert.deepEqual(sent.map((s) => s.endpoint.split('/').pop()), ['lea']);
  // Plus de 2 h apres l'heure : trop tard, rien.
  await thomas.put(`${h}/push`, { menu_time: '10:00' });
  assert.equal((await P.tick(new Date('2030-03-11T17:00:00Z'))).length, 0);
});
