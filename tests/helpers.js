// Outils de test : serveur sur une base temporaire (chaque fichier de test tourne dans
// son propre processus), clients avec leur cookie, connexion par lien.
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.CABAS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cabas-test-'));
process.env.CABAS_MAIL = process.env.CABAS_MAIL || 'log';
process.env.CABAS_QUIET = '1';
process.env.CABAS_PUSH = 'off';
const app = require('../server');
const { outbox } = require('../lib/mailer');
const { requests } = require('../lib/auth');

let base = '';
async function start() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return server;
}
const baseUrl = () => base;

const lastLink = (param) => new URL(outbox.at(-1).text.match(/https?:\S+/)[0]).searchParams.get(param);

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
  return {
    get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), patch: (u, b) => call('PATCH', u, b),
    put: (u, b) => call('PUT', u, b), del: (u) => call('DELETE', u), cookie: () => cookie,
    async login(email) {
      requests.clear();
      await call('POST', '/api/auth/request', { email });
      return call('POST', '/api/auth/verify', { token: lastLink('login') });
    },
  };
}

// Foyer avec un gestionnaire (thomas) et un membre (lea).
async function household(name = 'Foyer Phoenix') {
  const thomas = client();
  await thomas.login('thomas@exemple.be');
  const hid = (await thomas.post('/api/households', { name })).data.householdId;
  const inv = await thomas.post(`/api/h/${hid}/invitations`, { role: 'member' });
  const lea = client();
  await lea.login('lea@exemple.be');
  await lea.post(`/api/invitations/${new URL(inv.data.url).searchParams.get('invite')}/accept`);
  return { thomas, lea, hid, h: `/api/h/${hid}` };
}

module.exports = { start, baseUrl, client, household, lastLink, outbox };
