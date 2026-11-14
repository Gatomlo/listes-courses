// Derriere node-gateway, c'est elle qui authentifie : le premier visiteur (anonyme ou simple membre) ne peut plus creer
// le premier compte et s'approprier l'outil ; l'admin de la passerelle le peut. Hors passerelle : comportement inchange.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
require('./helpers'); // donnees temporaires
const express = require('express');
const app = require('../server');
const gw = (role, user) => ({ 'x-test-gateway': JSON.stringify({ app: 'cabas', role, user: user === undefined ? { login: 'anim', name: 'Anim', email: 'anim@exemple.be', isSuper: false } : user }) });

test('creation du premier compte derriere la passerelle', async () => {
  const outer = express();
  outer.use((req, res, next) => { const h = req.get('x-test-gateway'); if (h) req.gateway = JSON.parse(h); next(); });
  outer.use('/cabas', app);
  const srv = http.createServer(outer);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const setup = (h) => fetch(`http://127.0.0.1:${srv.address().port}/cabas/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify({ name: 'Thomas', email: 'thomas@exemple.be', password: 'motdepasse1' }) });
  try {
    assert.equal((await setup(gw(null, null))).status, 403, 'anonyme');
    assert.equal((await setup(gw('member'))).status, 403, 'simple membre');
    assert.equal(require('../lib/db').db.prepare('SELECT COUNT(*) n FROM users').get().n, 0, 'rien cree');
    assert.equal((await setup(gw('admin'))).status, 201, 'admin de la passerelle');
  } finally { srv.close(); }
});
