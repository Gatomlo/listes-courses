// Tickets de caisse : la lecture (Tesseract.js) et le rapprochement se font sur le
// telephone ; le serveur enregistre le ticket valide :
//  - une ligne « a creer » cree le produit (ou reprend celui du meme nom) ;
//  - chaque libelle associe a un produit est memorise pour ce magasin ;
//  - chaque ligne retenue devient un releve de prix (source ocr, promo si remise) ;
//  - les articles correspondants de la liste (ouverte) sont coches « achetes ».
const { db, tx, normalize } = require('./db');
const { httpError, isoDate, today, str } = require('./util');
const C = require('./catalog');

// Libelle de ticket normalise (cle des correspondances).
const labelKey = (s) => normalize(s).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function aliases(hid) {
  return db.prepare(`SELECT a.store_id, a.label_norm, a.product_id FROM store_aliases a JOIN stores s ON s.id = a.store_id
    JOIN products p ON p.id = a.product_id WHERE s.household_id = ? AND p.deleted_at IS NULL`).all(hid);
}

// b = { store_id, list_id?, date?, raw_text?, lines: [{ label, qty, unit_price, promo, product_id?, create?: { name, category_id, subcategory_id?, unit }, ignore? }] }
function saveReceipt(hid, userId, b) {
  const sid = Number(b.store_id);
  if (!db.prepare('SELECT 1 FROM stores WHERE id = ? AND household_id = ?').get(sid, hid)) throw httpError(404, 'Magasin introuvable.');
  const list = b.list_id ? db.prepare('SELECT id, status FROM lists WHERE id = ? AND household_id = ?').get(Number(b.list_id), hid) : null;
  const lines = Array.isArray(b.lines) ? b.lines.slice(0, 200) : [];
  const date = isoDate(b.date) || today();
  return tx(() => {
    const rid = Number(db.prepare('INSERT INTO receipts (household_id, store_id, list_id, date, raw_text, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(hid, sid, list ? list.id : null, date, str(b.raw_text, 20000) || null, userId, Date.now()).lastInsertRowid);
    const out = { records: 0, checked: 0, created: 0, ignored: 0 };
    for (const l of lines) {
      const label = str(l.label, 120);
      const qty = Math.max(0.01, Math.min(999, Number(l.qty) || 1));
      let pid = l.product_id ? Number(l.product_id) : null;
      let status = 'matched';
      if (l.ignore || (!pid && !l.create)) {
        db.prepare("INSERT INTO receipt_lines (receipt_id, label, qty, status) VALUES (?, ?, ?, 'ignored')").run(rid, label || '?', qty);
        out.ignored++;
        continue;
      }
      if (!pid) {
        const name = str(l.create.name, 80);
        const ex = db.prepare('SELECT id FROM products WHERE household_id = ? AND name_norm = ? AND deleted_at IS NULL').get(hid, normalize(name));
        pid = ex ? ex.id : C.createProduct(hid, { name, category_id: l.create.category_id, subcategory_id: l.create.subcategory_id, unit: l.create.unit, cont_n: l.create.cont_n, cont_u: l.create.cont_u }).id;
        if (!ex) { status = 'created'; out.created++; }
      } else if (!db.prepare('SELECT 1 FROM products WHERE id = ? AND household_id = ? AND deleted_at IS NULL').get(pid, hid)) {
        throw httpError(404, 'Produit introuvable.');
      }
      if (label) {
        db.prepare(`INSERT INTO store_aliases (store_id, label_norm, product_id, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(store_id, label_norm) DO UPDATE SET product_id = excluded.product_id, updated_at = excluded.updated_at`).run(sid, labelKey(label), pid, Date.now());
      }
      const unit = l.unit_price != null && l.unit_price !== '' ? Math.round(Number(String(l.unit_price).replace(',', '.')) * 100) : null;
      if (unit && unit > 0 && unit < 100000) {
        db.prepare(`INSERT INTO price_records (product_id, store_id, price_cents, date, source, promo, user_id, created_at)
          VALUES (?, ?, ?, ?, 'ocr', ?, ?, ?)`).run(pid, sid, unit, date, l.promo ? 1 : 0, userId, Date.now());
        out.records++;
      }
      db.prepare('INSERT INTO receipt_lines (receipt_id, label, qty, unit_cents, promo, product_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(rid, label || '?', qty, unit, l.promo ? 1 : 0, pid, status);
      if (list) {
        if (list.status !== 'closed') {
          const r = db.prepare("UPDATE list_items SET status = 'bought', bought_store_id = ?, updated_at = ? WHERE list_id = ? AND product_id = ? AND suggestion IS NULL AND status <> 'bought'")
            .run(sid, Date.now(), list.id, pid);
          out.checked += r.changes;
        }
        // Le ticket dit ou l'article a ete pris (peut differer du conseil ou du cochage).
        db.prepare("UPDATE list_items SET bought_store_id = ? WHERE list_id = ? AND product_id = ? AND suggestion IS NULL AND status = 'bought'").run(sid, list.id, pid);
      }
    }
    return { receiptId: rid, listId: list ? list.id : null, ...out };
  });
}

module.exports = { saveReceipt, aliases, labelKey };
