// Connexion sans e-mail : premier compte, mot de passe, inscription par invitation,
// lien de reinitialisation, changement de mot de passe.
process.env.CABAS_MAIL = 'off';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client } = require('./helpers');

let server, thomas, h, inviteUrl;
before(async () => { server = await start(); });
after(() => server.close());

test('premier compte : propose tant qu\'aucun compte n\'existe, puis ferme', async () => {
  const anon = client();
  assert.deepEqual((await anon.get('/api/auth/options')).data, { mail: false, setup: true });
  assert.equal((await anon.post('/api/auth/request', { email: 'x@exemple.be' })).status, 400, 'pas de lien par e-mail');
  assert.equal((await anon.post('/api/auth/setup', { name: 'Thomas', email: 'thomas@exemple.be', password: 'court' })).status, 400);
  thomas = client();
  const r = await thomas.post('/api/auth/setup', { name: 'Thomas', email: 'Thomas@Exemple.be', password: 'motdepasse1' });
  assert.equal(r.status, 201);
  assert.equal(r.data.hasPassword, true);
  assert.equal((await client().post('/api/auth/setup', { name: 'Pirate', email: 'p@exemple.be', password: 'motdepasse1' })).status, 403);
  assert.equal((await anon.get('/api/auth/options')).data.setup, false);
  h = `/api/h/${(await thomas.post('/api/households', { name: 'Foyer Phoenix' })).data.householdId}`;
});

test('connexion par mot de passe ; erreurs ; blocage apres 8 echecs', async () => {
  const c = client();
  assert.equal((await c.post('/api/auth/login', { email: 'thomas@exemple.be', password: 'mauvais!!' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: 'inconnu@exemple.be', password: 'motdepasse1' })).status, 401);
  const ok = await c.post('/api/auth/login', { email: 'THOMAS@exemple.be', password: 'motdepasse1' });
  assert.equal(ok.status, 200);
  assert.equal((await c.get('/api/me')).data.name, 'Thomas');
  const b = client();
  for (let i = 0; i < 8; i++) await b.post('/api/auth/login', { email: 'bloque@exemple.be', password: 'xxxxxxxx' });
  assert.equal((await b.post('/api/auth/login', { email: 'bloque@exemple.be', password: 'xxxxxxxx' })).status, 429);
});

test('invitation par lien : creation du compte, rejoint le foyer ; adresse deja prise', async () => {
  const inv = await thomas.post(`${h}/invitations`, { email: 'lea@exemple.be', role: 'member' });
  assert.equal(inv.data.sent, false, 'aucun e-mail envoye');
  inviteUrl = inv.data.url;
  const token = new URL(inviteUrl).searchParams.get('invite');
  const lea = client();
  assert.equal((await lea.post('/api/auth/register', { invite: token, name: 'Léa', email: 'thomas@exemple.be', password: 'motdepasse2' })).status, 409);
  const r = await lea.post('/api/auth/register', { invite: token, name: 'Léa', email: 'lea@exemple.be', password: 'motdepasse2' });
  assert.equal(r.status, 201);
  assert.equal(r.data.households[0].role, 'member');
  assert.equal((await client().post('/api/auth/register', { invite: token, name: 'X', email: 'x@exemple.be', password: 'motdepasse3' })).status, 404, 'usage unique');
});

test('lien de reinitialisation cree par un gestionnaire', async () => {
  const members = (await thomas.get(h)).data.members;
  const lea = members.find((m) => m.email === 'lea@exemple.be');
  const leaClient = client();
  await leaClient.post('/api/auth/login', { email: 'lea@exemple.be', password: 'motdepasse2' });
  assert.equal((await leaClient.post(`${h}/members/${members.find((m) => m.me).id}/reset-link`)).status, 403, 'membre : refuse');
  const r = await thomas.post(`${h}/members/${lea.id}/reset-link`);
  const token = new URL(r.data.url).searchParams.get('reset');
  const c = client();
  assert.equal((await c.post('/api/auth/reset', { token, password: 'nouveau-mdp' })).status, 200);
  assert.equal((await c.post('/api/auth/reset', { token, password: 'encore-un' })).status, 400, 'usage unique');
  assert.equal((await leaClient.get('/api/me')).status, 401, 'anciennes sessions fermees');
  assert.equal((await client().post('/api/auth/login', { email: 'lea@exemple.be', password: 'nouveau-mdp' })).status, 200);
});

test('changer son mot de passe : l\'actuel est exige', async () => {
  assert.equal((await thomas.patch('/api/me', { password: 'autre-mdp-1', current_password: 'faux' })).status, 401);
  assert.equal((await thomas.patch('/api/me', { password: 'autre-mdp-1', current_password: 'motdepasse1' })).status, 200);
  assert.equal((await client().post('/api/auth/login', { email: 'thomas@exemple.be', password: 'autre-mdp-1' })).status, 200);
});
