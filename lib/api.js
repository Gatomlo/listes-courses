// API JSON (montee sur /api). Droits : toute route /h/:hid/... passe par
// householdMember (membre du foyer) ; les routes de gestion ajoutent `manager`.
const express = require('express');
const auth = require('./auth');
const mailer = require('./mailer');
const H = require('./households');
const C = require('./catalog');
const L = require('./lists');
const events = require('./events');
const { applyOps } = require('./sync');
const M = require('./meals');
const { db } = require('./db');
const { httpError, str, asyncHandler: a } = require('./util');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const { householdMember: member, manager } = auth;

function me(user) {
  const row = db.prepare('SELECT id, email, name, last_household_id, password_hash IS NOT NULL AS has_password FROM users WHERE id = ?').get(user.id);
  const households = H.householdsOf(user.id);
  const current = households.find((h) => h.id === row.last_household_id) || households[0] || null;
  return { id: row.id, email: row.email, name: row.name, hasPassword: !!row.has_password, households, householdId: current ? current.id : null };
}

// Nom par defaut d'un nouveau compte : partie locale de l'adresse ("lea.dupont" -> "Lea").
const nameFromEmail = (email) => {
  const s = email.split('@')[0].split(/[._+-]/)[0] || 'Moi';
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function router() {
  const api = express.Router();

  // ---------- Connexion ----------
  // Ce que la page de connexion propose : premier compte a creer, lien par e-mail.
  api.get('/auth/options', (req, res) => {
    res.json({ mail: mailer.enabled(), setup: !db.prepare('SELECT 1 FROM users LIMIT 1').get() });
  });

  const newUser = async (name, email, password) => {
    const n = str(name, 60), e = str(email, 120).toLowerCase();
    if (!n) throw httpError(400, 'Votre nom est requis.');
    if (!EMAIL.test(e)) throw httpError(400, 'Adresse e-mail invalide.');
    const hash = await auth.hashPassword(password);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(e)) throw httpError(409, 'Un compte existe déjà avec cette adresse : connectez-vous.');
    return Number(db.prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)').run(e, n, hash, Date.now()).lastInsertRowid);
  };

  // Premier compte de l'installation (aucun compte encore) : cree librement.
  api.post('/auth/setup', a(async (req, res) => {
    if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) throw httpError(403, 'Des comptes existent déjà : connectez-vous ou demandez une invitation.');
    const id = await newUser(req.body.name, req.body.email, req.body.password);
    auth.createSession(req, res, id);
    res.status(201).json(me({ id }));
  }));

  api.post('/auth/login', a(async (req, res) => {
    const email = str(req.body.email, 120).toLowerCase();
    if (auth.tooManyFailures(email)) throw httpError(429, 'Trop d\'essais : réessayez dans 15 minutes.');
    const row = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
    if (!(await auth.verifyPassword(req.body.password, row && row.password_hash))) {
      auth.recordFailure(email);
      await new Promise((r) => setTimeout(r, auth.failureDelay()));
      throw httpError(401, 'Adresse ou mot de passe incorrect.');
    }
    auth.failures.hit('ok'); // rien a nettoyer : les echecs expirent seuls
    auth.createSession(req, res, row.id);
    res.json(me({ id: row.id }));
  }));

  // Creation de compte par un lien d'invitation (sans e-mail) : rejoint le foyer.
  api.post('/auth/register', a(async (req, res) => {
    H.findInvitation(req.body.invite);
    const id = await newUser(req.body.name, req.body.email, req.body.password);
    H.acceptInvitation(req.body.invite, id);
    auth.createSession(req, res, id);
    res.status(201).json(me({ id }));
  }));

  // Nouveau mot de passe par un lien de reinitialisation (cree par un gestionnaire).
  api.post('/auth/reset', a(async (req, res) => {
    const hash = await auth.hashPassword(req.body.password);
    const uid = auth.consumeResetToken(req.body.token);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, uid);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
    auth.createSession(req, res, uid);
    res.json(me({ id: uid }));
  }));

  api.post('/auth/request', a(async (req, res) => {
    if (!mailer.enabled()) throw httpError(400, 'Connexion par e-mail indisponible : utilisez votre mot de passe.');
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

  api.patch('/me', auth.requireAuth, a(async (req, res) => {
    if (req.body.password != null) {
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
      if (row.password_hash && !(await auth.verifyPassword(req.body.current_password, row.password_hash))) throw httpError(401, 'Mot de passe actuel incorrect.');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await auth.hashPassword(req.body.password), req.user.id);
    }
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
  }));

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

  // ---------- Lien d'affichage du menu (public, lecture seule) ----------
  api.get('/public/menu/:token', (req, res) => res.json(M.publicMenu(req.params.token, req.query.from, req.query.days)));

  // ---------- Foyer ----------
  const h = express.Router({ mergeParams: true });
  api.use('/h/:hid', member, events.notifyChanges, h);

  // Tout ce dont l'interface a besoin pour le foyer, en une requete.
  h.get('/', (req, res) => {
    res.json({
      household: H.getHousehold(req.hid), role: req.role,
      members: H.members(req.hid, req.user.id), stores: C.stores(req.hid), categories: C.categories(req.hid), units: C.UNITS, tags: M.tags(req.hid),
      pending: L.pendingCount(req.hid) + M.pendingMeals(req.hid).length + M.pendingWishes(req.hid).length,
      menuToken: req.role === 'manager' ? require('./db').db.prepare('SELECT menu_token FROM households WHERE id = ?').get(req.hid).menu_token : undefined,
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

  h.post('/members/:uid/reset-link', manager, (req, res) => {
    const uid = Number(req.params.uid);
    if (!auth.roleIn(uid, req.hid)) throw httpError(404, 'Membre introuvable.');
    res.json({ url: `${auth.publicUrl(req)}/?reset=${auth.createResetToken(uid)}` });
  });

  h.post('/invitations', manager, a(async (req, res) => {
    const email = str(req.body.email, 120).toLowerCase();
    if (email && !EMAIL.test(email)) throw httpError(400, 'Adresse e-mail invalide.');
    const role = req.body.role === 'manager' ? 'manager' : 'member';
    const { token, expiresAt } = H.createInvitation(req.hid, req.user.id, { email, role });
    const url = `${auth.publicUrl(req)}/?invite=${token}`;
    const hh = H.getHousehold(req.hid);
    if (email && mailer.enabled()) {
      await mailer.send({
        to: email, subject: `Le Cabas — invitation au foyer « ${hh.name} »`, url, button: 'Rejoindre le foyer',
        intro: `${req.user.name} vous invite à rejoindre le foyer « ${hh.name} » sur Le Cabas, pour partager les listes de courses et les menus.`,
        outro: 'Invitation valable 7 jours.',
      });
    }
    res.status(201).json({ url, expiresAt, sent: !!email && mailer.enabled() });
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
  h.post('/products/import', manager, (req, res) => res.json(require('./csvimport').importProducts(req.hid, req.user.id, str(req.body.csv, 900000), { dry: !!req.body.dry })));
  h.get('/products/:pid', (req, res) => res.json(C.product(req.hid, Number(req.params.pid))));
  h.patch('/products/:pid', manager, (req, res) => res.json(C.updateProduct(req.hid, Number(req.params.pid), req.body)));
  h.delete('/products/:pid', manager, (req, res) => { C.deleteProduct(req.hid, Number(req.params.pid)); res.json({ ok: true }); });
  h.post('/products/:pid/merge', manager, (req, res) => res.json(C.mergeProduct(req.hid, Number(req.params.pid), Number(req.body.into))));
  // Releves : tout membre (en magasin, saisie manuelle).
  h.post('/products/:pid/records', (req, res) => res.status(201).json(C.addRecord(req.hid, Number(req.params.pid), req.user.id, req.body)));
  h.delete('/products/:pid/records/:rid', manager, (req, res) => res.json(C.deleteRecord(req.hid, Number(req.params.pid), Number(req.params.rid))));

  // ---------- Listes ----------
  const num = (v) => Number(v);
  h.get('/lists', (req, res) => res.json(L.summary(req.hid)));
  h.get('/lists/new', manager, (req, res) => res.json(L.preview(req.hid, req.query.date)));
  h.post('/lists', manager, (req, res) => res.status(201).json(L.getList(req.hid, L.createList(req.hid, req.user.id, req.body))));
  h.get('/lists/:lid', (req, res) => res.json(L.getList(req.hid, num(req.params.lid))));
  h.patch('/lists/:lid', manager, (req, res) => { L.updateList(req.hid, num(req.params.lid), req.body); res.json(L.getList(req.hid, num(req.params.lid))); });
  h.delete('/lists/:lid', manager, (req, res) => { L.deleteList(req.hid, num(req.params.lid)); res.json({ ok: true }); });
  h.post('/lists/:lid/close', manager, (req, res) => res.json(L.closeList(req.hid, num(req.params.lid), req.body.fates || {})));
  h.post('/lists/:lid/copy-to-backlog', manager, (req, res) => res.json({ copied: L.copyToBacklog(req.hid, num(req.params.lid)) }));
  // Ajout : direct pour un gestionnaire, suggestion pour un membre.
  h.post('/lists/:lid/items', (req, res) => {
    L.addItem(req.hid, num(req.params.lid), req.user, req.role, req.body);
    res.status(201).json(L.getList(req.hid, num(req.params.lid)));
  });
  const withList = (req, res, fn) => {
    const listId = L.itemList(req.hid, num(req.params.iid));
    fn();
    res.json(L.getList(req.hid, listId));
  };
  h.patch('/items/:iid', (req, res) => withList(req, res, () => L.updateItem(req.hid, num(req.params.iid), req.user, req.role, req.body)));
  h.delete('/items/:iid', (req, res) => withList(req, res, () => L.deleteItem(req.hid, num(req.params.iid), req.user, req.role)));
  h.post('/items/:iid/move', manager, (req, res) => withList(req, res, () => L.moveItem(req.hid, num(req.params.iid), num(req.body.list_id))));
  h.post('/items/:iid/accept', manager, (req, res) => withList(req, res, () => L.acceptSuggestion(req.hid, num(req.params.iid))));
  h.post('/items/:iid/refuse', manager, (req, res) => withList(req, res, () => L.refuseSuggestion(req.hid, num(req.params.iid))));
  h.get('/suggestions', (req, res) => res.json(L.pendingSuggestions(req.hid).concat(M.pendingMeals(req.hid).map((m) => ({ ...m, kind: 'meal' })), M.pendingWishes(req.hid).map((w) => ({ ...w, kind: 'wish' })))));
  // Correspondances libelle de ticket -> produit (rapprochement fait sur le telephone).
  h.get('/aliases', (req, res) => res.json(require('./receipts').aliases(req.hid)));
  // ---------- Temps reel et synchronisation (mode courses, hors-ligne) ----------
  h.get('/events', events.subscribe);
  // Rejoue des operations ; renvoie leur resultat et les listes touchees, a jour.
  h.post('/sync', (req, res) => {
    const results = applyOps(req.hid, req.user, req.role, req.body.ops);
    const ids = [...new Set(results.map((r) => r.listId).filter(Boolean))].slice(0, 5);
    res.locals.listId = ids[0] || null;
    res.json({ results, lists: ids.map((id) => L.getList(req.hid, id)) });
  });
  // ---------- Plats et menu ----------
  h.get('/dishes', (req, res) => res.json(M.dishes(req.hid)));
  h.get('/dishes/:did', (req, res) => res.json(M.dish(req.hid, num(req.params.did))));
  h.post('/dishes', manager, (req, res) => res.status(201).json(M.dish(req.hid, M.saveDish(req.hid, null, req.body))));
  h.put('/dishes/:did', manager, (req, res) => res.json(M.dish(req.hid, M.saveDish(req.hid, num(req.params.did), req.body))));
  h.get('/tags', (req, res) => res.json(M.tags(req.hid)));
  h.patch('/tags/:tid', manager, (req, res) => { M.renameTag(req.hid, num(req.params.tid), req.body.name); res.json(M.tags(req.hid)); });
  h.delete('/tags/:tid', manager, (req, res) => { M.deleteTag(req.hid, num(req.params.tid)); res.json(M.tags(req.hid)); });
  h.post('/tags/:tid/merge', manager, (req, res) => { M.mergeTag(req.hid, num(req.params.tid), num(req.body.into)); res.json(M.tags(req.hid)); });
  h.delete('/dishes/:did', manager, (req, res) => { M.deleteDish(req.hid, num(req.params.did)); res.json({ ok: true }); });
  h.post('/recipe-import', manager, a(async (req, res) => res.json(await require('./recipes').importRecipe(str(req.body.url, 500)))));
  h.get('/menu', (req, res) => res.json(M.menu(req.hid, req.query.from, req.query.days, req.query.at)));
  h.post('/menus', manager, (req, res) => res.status(201).json(M.saveMenu(req.hid, null, req.body)));
  h.patch('/menus/:id', manager, (req, res) => res.json(M.saveMenu(req.hid, num(req.params.id), req.body)));
  h.delete('/menus/:id', manager, (req, res) => { M.deleteMenu(req.hid, num(req.params.id)); res.json({ ok: true }); });
  // Gestionnaire : ajoute ; membre : suggestion.
  h.post('/meals', (req, res) => res.status(201).json({ id: M.createMeal(req.hid, req.user, req.role, req.body) }));
  h.patch('/meals/:mid', (req, res) => { M.updateMeal(req.hid, num(req.params.mid), req.user, req.role, req.body); res.json({ ok: true }); });
  h.delete('/meals/:mid', (req, res) => { M.deleteMeal(req.hid, num(req.params.mid), req.user, req.role); res.json({ ok: true }); });
  h.post('/meals/:mid/accept', manager, (req, res) => { M.acceptMeal(req.hid, num(req.params.mid)); res.json({ ok: true }); });
  h.post('/items/:iid/in-stock', manager, (req, res) => res.json(L.getList(req.hid, M.itemInStock(req.hid, num(req.params.iid)))));
  h.get('/wishes', (req, res) => res.json(M.wishes(req.hid)));
  h.post('/wishes', (req, res) => { M.addWish(req.hid, req.user, req.role, req.body); res.status(201).json(M.wishes(req.hid)); });
  h.post('/wishes/:id/accept', manager, (req, res) => { M.acceptWish(req.hid, num(req.params.id), req.body.dish_id); res.json(M.wishes(req.hid)); });
  h.delete('/wishes/:id', (req, res) => { M.deleteWish(req.hid, num(req.params.id), req.user, req.role); res.json(M.wishes(req.hid)); });
  h.put('/menu-note', manager, (req, res) => res.json(M.saveMenuNote(req.hid, req.body.start, req.body.note)));
  h.post('/menu-share', manager, (req, res) => res.json({ token: M.shareToken(req.hid, req.body.action) }));
  h.post('/lists/:lid/assign', manager, (req, res) => { L.assignAll(req.hid, num(req.params.lid), req.body.store_id); res.json(L.getList(req.hid, num(req.params.lid))); });

  // ---------- Promos (tout membre) ----------
  h.get('/promos', (req, res) => res.json(require('./pricing').listPromos(req.hid)));
  h.post('/promos', (req, res) => { L.savePromo(req.hid, req.user.id, req.body); res.status(201).json(require('./pricing').listPromos(req.hid)); });
  h.delete('/promos/:id', (req, res) => { L.deletePromo(req.hid, num(req.params.id)); res.json(require('./pricing').listPromos(req.hid)); });

  return api;
}

module.exports = { router };
