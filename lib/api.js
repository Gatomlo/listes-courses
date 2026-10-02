// API JSON (montee sur /api). Droits : toute route /h/:hid/... passe par
// householdMember (membre du foyer) ; les routes de gestion ajoutent `manager`.
const express = require('express');
const auth = require('./auth');
const mailer = require('./mailer');
const H = require('./households');
const C = require('./catalog');
const { db } = require('./db');
const { httpError, str, asyncHandler: a } = require('./util');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const { householdMember: member, manager } = auth;

function me(user) {
  const row = db.prepare('SELECT id, email, name, last_household_id FROM users WHERE id = ?').get(user.id);
  const households = H.householdsOf(user.id);
  const current = households.find((h) => h.id === row.last_household_id) || households[0] || null;
  return { id: row.id, email: row.email, name: row.name, households, householdId: current ? current.id : null };
}

// Nom par defaut d'un nouveau compte : partie locale de l'adresse ("lea.dupont" -> "Lea").
const nameFromEmail = (email) => {
  const s = email.split('@')[0].split(/[._+-]/)[0] || 'Moi';
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function router() {
  const api = express.Router();

  // ---------- Connexion ----------
  api.post('/auth/request', a(async (req, res) => {
    const email = str(req.body.email, 120).toLowerCase();
    if (!EMAIL.test(email)) throw httpError(400, 'Adresse e-mail invalide.');
    const token = auth.createLoginToken(email);
    const invite = str(req.body.invite, 100);
    const url = `${auth.publicUrl(req)}/?login=${token}${invite ? `&invite=${encodeURIComponent(invite)}` : ''}`;
    await mailer.send({
      to: email, subject: 'Le Cabas — votre lien de connexion', url, button: 'Se connecter',
      intro: 'Bonjour, voici votre lien pour vous connecter au Cabas. Il est valable 15 minutes et ne sert qu\'une fois.',
      outro: 'Si vous n\'avez rien demandé, ignorez ce message.',
    });
    res.json({ ok: true });
  }));

  api.post('/auth/verify', (req, res) => {
    const email = auth.consumeLoginToken(req.body.token);
    let user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (!user) {
      const id = Number(db.prepare('INSERT INTO users (email, name, created_at) VALUES (?, ?, ?)').run(email, nameFromEmail(email), Date.now()).lastInsertRowid);
      user = { id };
    }
    auth.createSession(req, res, user.id);
    res.json(me(user));
  });

  api.post('/auth/logout', (req, res) => {
    auth.destroySession(req, res);
    res.json({ ok: true });
  });

  // ---------- Compte ----------
  api.get('/me', auth.requireAuth, (req, res) => res.json(me(req.user)));

  api.patch('/me', auth.requireAuth, (req, res) => {
    if (req.body.name != null) {
      const name = str(req.body.name, 60);
      if (!name) throw httpError(400, 'Nom requis.');
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
    }
    if (req.body.householdId != null) {
      const hid = Number(req.body.householdId);
      if (!auth.roleIn(req.user.id, hid)) throw httpError(404, 'Foyer introuvable.');
      db.prepare('UPDATE users SET last_household_id = ? WHERE id = ?').run(hid, req.user.id);
    }
    res.json(me(req.user));
  });

  api.post('/households', auth.requireAuth, (req, res) => {
    const name = str(req.body.name, 80);
    if (!name) throw httpError(400, 'Nom du foyer requis.');
    H.createHousehold(req.user.id, name);
    res.status(201).json(me(req.user));
  });

  // ---------- Invitations (lecture publique, acceptation connectee) ----------
  api.get('/invitations/:token', (req, res) => {
    const inv = H.findInvitation(req.params.token);
    res.json({ household: inv.household, inviter: inv.inviter, role: inv.role, email: inv.email });
  });

  api.post('/invitations/:token/accept', auth.requireAuth, (req, res) => {
    H.acceptInvitation(req.params.token, req.user.id);
    res.json(me(req.user));
  });

  // ---------- Foyer ----------
  const h = express.Router({ mergeParams: true });
  api.use('/h/:hid', member, h);

  // Tout ce dont l'interface a besoin pour le foyer, en une requete.
  h.get('/', (req, res) => {
    res.json({
      household: H.getHousehold(req.hid), role: req.role,
      members: H.members(req.hid, req.user.id), stores: C.stores(req.hid), categories: C.categories(req.hid), units: C.UNITS,
    });
  });
  h.patch('/', manager, (req, res) => res.json(H.updateHousehold(req.hid, req.body)));

  h.patch('/members/:uid', manager, (req, res) => {
    H.updateMember(req.hid, Number(req.params.uid), req.body);
    res.json(H.members(req.hid, req.user.id));
  });
  // Un gestionnaire retire un membre ; chacun peut quitter le foyer.
  h.delete('/members/:uid', (req, res) => {
    const uid = Number(req.params.uid);
    if (uid !== req.user.id && req.role !== 'manager') throw httpError(403, 'Réservé aux gestionnaires du foyer.');
    H.removeMember(req.hid, uid);
    res.json({ ok: true });
  });

  h.post('/invitations', manager, a(async (req, res) => {
    const email = str(req.body.email, 120).toLowerCase();
    if (email && !EMAIL.test(email)) throw httpError(400, 'Adresse e-mail invalide.');
    const role = req.body.role === 'manager' ? 'manager' : 'member';
    const { token, expiresAt } = H.createInvitation(req.hid, req.user.id, { email, role });
    const url = `${auth.publicUrl(req)}/?invite=${token}`;
    const hh = H.getHousehold(req.hid);
    if (email) {
      await mailer.send({
        to: email, subject: `Le Cabas — invitation au foyer « ${hh.name} »`, url, button: 'Rejoindre le foyer',
        intro: `${req.user.name} vous invite à rejoindre le foyer « ${hh.name} » sur Le Cabas, pour partager les listes de courses et les menus.`,
        outro: 'Invitation valable 7 jours.',
      });
    }
    res.status(201).json({ url, expiresAt, sent: !!email });
  }));

  // ---------- Magasins et rayons ----------
  h.get('/stores', (req, res) => res.json(C.stores(req.hid)));
  h.post('/stores', manager, (req, res) => { C.createStore(req.hid, req.body); res.status(201).json(C.stores(req.hid)); });
  h.patch('/stores/:sid', manager, (req, res) => { C.updateStore(req.hid, Number(req.params.sid), req.body); res.json(C.stores(req.hid)); });
  h.put('/stores/:sid/order', manager, (req, res) => { C.setCategoryOrder(req.hid, Number(req.params.sid), req.body.categoryIds); res.json(C.stores(req.hid)); });

  h.get('/categories', (req, res) => res.json(C.categories(req.hid)));
  h.post('/categories', manager, (req, res) => { C.createCategory(req.hid, req.body); res.status(201).json({ categories: C.categories(req.hid), stores: C.stores(req.hid) }); });
  h.patch('/categories/:cid', manager, (req, res) => { C.renameCategory(req.hid, Number(req.params.cid), req.body); res.json(C.categories(req.hid)); });
  h.delete('/categories/:cid', manager, (req, res) => {
    C.deleteCategory(req.hid, Number(req.params.cid), req.query.moveTo);
    res.json({ categories: C.categories(req.hid), stores: C.stores(req.hid) });
  });

  // ---------- Produits ----------
  h.get('/products', (req, res) => res.json(C.products(req.hid)));
  // Tout membre peut creer un produit (a la volee depuis une liste ou un plat).
  h.post('/products', (req, res) => res.status(201).json(C.createProduct(req.hid, req.body)));
  h.get('/products/:pid', (req, res) => res.json(C.product(req.hid, Number(req.params.pid))));
  h.patch('/products/:pid', manager, (req, res) => res.json(C.updateProduct(req.hid, Number(req.params.pid), req.body)));
  h.delete('/products/:pid', manager, (req, res) => { C.deleteProduct(req.hid, Number(req.params.pid)); res.json({ ok: true }); });
  h.post('/products/:pid/merge', manager, (req, res) => res.json(C.mergeProduct(req.hid, Number(req.params.pid), Number(req.body.into))));
  // Releves : tout membre (en magasin, saisie manuelle).
  h.post('/products/:pid/records', (req, res) => res.status(201).json(C.addRecord(req.hid, Number(req.params.pid), req.user.id, req.body)));
  h.delete('/products/:pid/records/:rid', manager, (req, res) => res.json(C.deleteRecord(req.hid, Number(req.params.pid), Number(req.params.rid))));

  return api;
}

module.exports = { router };
