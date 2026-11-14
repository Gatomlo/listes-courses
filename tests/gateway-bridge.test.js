// Pont avec la connexion centralisee de node-gateway : req.gateway (pose par la passerelle) ouvre une
// session locale COURTE pour le compte de meme e-mail, sans jamais creer de compte. Hors passerelle : inchange.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { start, client } = require('./helpers');
const express = require('express');
const app = require('../server');

let server, bridge, base;
const gw = (email, role = 'member') => ({ 'x-test-gateway': JSON.stringify({ app: 'cabas', role, user: { login: 'x', name: 'X', email, isSuper: false } }) });
const me = (headers = {}) => fetch(base + '/api/me', { headers });

before(async () => {
  server = await start();
  try {
    const r = await client().post('/api/auth/setup', { name: 'Thomas', email: 'thomas@exemple.be', password: 'motdepasse1' });
    assert.ok(r.status < 300, 'setup ' + r.status);
    const outer = express();
    outer.use((req, res, next) => { const h = req.get('x-test-gateway'); if (h) req.gateway = JSON.parse(h); next(); });
    outer.use('/cabas', app);
    bridge = http.createServer(outer);
    await new Promise((r2) => bridge.listen(0, r2));
    base = `http://127.0.0.1:${bridge.address().port}/cabas`;
  } catch (e) { server.close(); throw e; }
});
after(() => { if (bridge) bridge.close(); server.close(); });

test('e-mail de la passerelle -> compte local de meme e-mail (session courte, limitee au chemin)', async () => {
  const r = await me(gw('THOMAS@exemple.be'));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(String(j.email || (j.user && j.user.email) || '').toLowerCase(), 'thomas@exemple.be');
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /Path=\/cabas\//);
  assert.match(cookie, /Max-Age=7200\b/);
  assert.match(cookie, /HttpOnly/);
});

test('aucun compte cree : e-mail inconnu, sans e-mail, anonyme ou sans droit => pas connecte', async () => {
  for (const h of [gw('inconnu@exemple.be'), gw(''), {}, { 'x-test-gateway': JSON.stringify({ app: 'cabas', role: null, user: { login: 'x', email: 'thomas@exemple.be' } }) }]) {
    assert.equal((await me(h)).status, 401);
  }
  assert.equal(require('../lib/db').db.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
});
