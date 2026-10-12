// Foyers, membres et invitations.
const { db, tx } = require('./db');
const { httpError } = require('./util');
const { sha256, newToken } = require('./auth');

const DEFAULT_STORES = [['Intermarché', '#c8313b'], ['Colruyt', '#e08a12']];
const DEFAULT_CATEGORIES = ['Fruits & légumes', 'Boulangerie', 'Frais', 'Boucherie', 'Surgelés', 'Épicerie', 'Boissons', 'Droguerie', 'Hygiène'];
const INVITE_TTL = 7 * 24 * 3600 * 1000;

// Nouveau foyer : son createur en est gestionnaire ; magasins et rayons par defaut.
function createHousehold(userId, name) {
  return tx(() => {
    const hid = Number(db.prepare('INSERT INTO households (name, created_at) VALUES (?, ?)').run(name, Date.now()).lastInsertRowid);
    db.prepare("INSERT INTO memberships (user_id, household_id, role, joined_at) VALUES (?, ?, 'manager', ?)").run(userId, hid, Date.now());
    const cats = DEFAULT_CATEGORIES.map((n) => Number(db.prepare('INSERT INTO categories (household_id, name) VALUES (?, ?)').run(hid, n).lastInsertRowid));
    DEFAULT_STORES.forEach(([n, color], i) => {
      const sid = Number(db.prepare('INSERT INTO stores (household_id, name, color, position) VALUES (?, ?, ?, ?)').run(hid, n, color, i).lastInsertRowid);
      cats.forEach((cid, pos) => db.prepare('INSERT INTO store_category_order (store_id, category_id, position) VALUES (?, ?, ?)').run(sid, cid, pos));
    });
    db.prepare('UPDATE users SET last_household_id = ? WHERE id = ?').run(hid, userId);
    return hid;
  });
}

function householdsOf(userId) {
  return db.prepare(`SELECT h.id, h.name, m.role,
      (SELECT COUNT(*) FROM memberships x WHERE x.household_id = h.id) AS members
    FROM households h JOIN memberships m ON m.household_id = h.id
    WHERE m.user_id = ? ORDER BY h.name COLLATE NOCASE`).all(userId);
}

function getHousehold(hid) {
  return db.prepare('SELECT id, name, threshold_cents, avg_records, rhythm_days, menu_days, menu_start_dow, menu_gap_days FROM households WHERE id = ?').get(hid);
}

function updateHousehold(hid, b) {
  const h = getHousehold(hid);
  const name = b.name != null ? String(b.name).trim().slice(0, 80) : h.name;
  if (!name) throw httpError(400, 'Nom du foyer requis.');
  const int = (v, min, max, def) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  db.prepare('UPDATE households SET name = ?, threshold_cents = ?, avg_records = ?, rhythm_days = ?, menu_days = ?, menu_start_dow = ?, menu_gap_days = ? WHERE id = ?').run(
    name, int(b.threshold_cents, 0, 100000, h.threshold_cents), int(b.avg_records, 1, 20, h.avg_records), int(b.rhythm_days, 1, 90, h.rhythm_days),
    int(b.menu_days, 1, 62, h.menu_days), int(b.menu_start_dow, 0, 6, h.menu_start_dow), int(b.menu_gap_days, 0, 365, h.menu_gap_days), hid);
  return getHousehold(hid);
}

// ---------- Membres ----------
function members(hid, meId) {
  return db.prepare(`SELECT u.id, u.email, COALESCE(m.display_name, u.name) AS name, m.role
    FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.household_id = ?
    ORDER BY m.role = 'manager' DESC, name COLLATE NOCASE`).all(hid).map((r) => ({ ...r, me: r.id === meId }));
}

const managerCount = (hid) => db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE household_id = ? AND role = 'manager'").get(hid).n;

function updateMember(hid, uid, b) {
  const m = db.prepare('SELECT role FROM memberships WHERE household_id = ? AND user_id = ?').get(hid, uid);
  if (!m) throw httpError(404, 'Membre introuvable.');
  if (b.role != null) {
    if (!['manager', 'member'].includes(b.role)) throw httpError(400, 'Profil inconnu.');
    if (m.role === 'manager' && b.role === 'member' && managerCount(hid) === 1) throw httpError(409, 'Il faut au moins un gestionnaire dans le foyer.');
    db.prepare('UPDATE memberships SET role = ? WHERE household_id = ? AND user_id = ?').run(b.role, hid, uid);
  }
  if (b.display_name != null) {
    const n = String(b.display_name).trim().slice(0, 60);
    db.prepare('UPDATE memberships SET display_name = ? WHERE household_id = ? AND user_id = ?').run(n || null, hid, uid);
  }
}

function removeMember(hid, uid) {
  const m = db.prepare('SELECT role FROM memberships WHERE household_id = ? AND user_id = ?').get(hid, uid);
  if (!m) throw httpError(404, 'Membre introuvable.');
  if (m.role === 'manager' && managerCount(hid) === 1) throw httpError(409, 'Le dernier gestionnaire ne peut pas quitter le foyer.');
  db.prepare('DELETE FROM memberships WHERE household_id = ? AND user_id = ?').run(hid, uid);
  db.prepare('UPDATE users SET last_household_id = NULL WHERE id = ? AND last_household_id = ?').run(uid, hid);
}

// ---------- Invitations ----------
function createInvitation(hid, invitedBy, { email, role }) {
  if (!['manager', 'member'].includes(role)) throw httpError(400, 'Profil inconnu.');
  const token = newToken();
  db.prepare('DELETE FROM invitations WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO invitations (token_hash, household_id, email, role, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sha256(token), hid, email || null, role, invitedBy, Date.now() + INVITE_TTL);
  return { token, expiresAt: Date.now() + INVITE_TTL };
}

function findInvitation(token) {
  const inv = db.prepare(`SELECT i.household_id, i.email, i.role, i.expires_at, i.used_at, h.name AS household, u.name AS inviter
    FROM invitations i JOIN households h ON h.id = i.household_id LEFT JOIN users u ON u.id = i.invited_by
    WHERE i.token_hash = ?`).get(sha256(String(token || '')));
  if (!inv || inv.used_at || inv.expires_at < Date.now()) throw httpError(404, 'Invitation expirée ou déjà utilisée.');
  return inv;
}

function acceptInvitation(token, userId) {
  const inv = findInvitation(token);
  return tx(() => {
    db.prepare('UPDATE invitations SET used_at = ? WHERE token_hash = ?').run(Date.now(), sha256(String(token)));
    db.prepare('INSERT OR IGNORE INTO memberships (user_id, household_id, role, joined_at) VALUES (?, ?, ?, ?)').run(userId, inv.household_id, inv.role, Date.now());
    db.prepare('UPDATE users SET last_household_id = ? WHERE id = ?').run(inv.household_id, userId);
    return inv.household_id;
  });
}

module.exports = {
  createHousehold, householdsOf, getHousehold, updateHousehold, members, updateMember, removeMember,
  createInvitation, findInvitation, acceptInvitation, DEFAULT_CATEGORIES,
};
