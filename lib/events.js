// Temps reel par Server-Sent Events, par foyer : un seul processus (passerelle), la
// diffusion se fait en memoire. Messages :
//   { type: 'change', path, listId, by }   une modification (les autres rechargent)
//   { type: 'presence', users: [{ id, name, listId }] }   qui regarde quelle liste
const clients = new Map(); // hid -> Set<{ res, user, listId }>

function send(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function presence(hid) {
  const set = clients.get(hid);
  if (!set) return;
  const users = [...set].map((c) => ({ id: c.user.id, name: c.user.name, listId: c.listId }));
  for (const c of set) send(c.res, { type: 'presence', users });
}

// GET /api/h/:hid/events?list=<id>
function subscribe(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // pas de mise en tampon par un proxy nginx
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const client = { res, user: req.user, listId: Number(req.query.list) || null };
  if (!clients.has(req.hid)) clients.set(req.hid, new Set());
  clients.get(req.hid).add(client);
  presence(req.hid);
  // Commentaire periodique : garde la connexion ouverte a travers les proxys. Minuterie
  // propre a la connexion, liberee a sa fermeture (process partage avec la passerelle).
  const beat = setInterval(() => res.write(': ping\n\n'), 25000);
  beat.unref();
  req.on('close', () => {
    clearInterval(beat);
    const set = clients.get(req.hid);
    if (set) { set.delete(client); if (!set.size) clients.delete(req.hid); }
    presence(req.hid);
  });
}

function broadcast(hid, data) {
  const set = clients.get(hid);
  if (set) for (const c of set) send(c.res, data);
}

// Middleware : apres toute modification reussie d'un foyer, previent les autres.
function notifyChanges(req, res, next) {
  if (req.method === 'GET') return next();
  res.on('finish', () => {
    if (res.statusCode < 400 && req.hid) {
      const m = req.originalUrl.match(/\/lists\/(\d+)/);
      broadcast(req.hid, { type: 'change', path: req.path, listId: m ? Number(m[1]) : (res.locals.listId || null), by: req.user.id });
    }
  });
  next();
}

module.exports = { subscribe, broadcast, notifyChanges };
