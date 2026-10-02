// Base SQLite unique data/cabas.db (module node:sqlite integre a Node >= 22.5 : aucun
// module natif a compiler sur l'hebergement mutualise), creee et migree au demarrage.
// CABAS_DATA_DIR change le dossier (tests, essais).
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.CABAS_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// Texte de recherche normalise (minuscules, sans accents) : LIKE de SQLite ne gere
// la casse que pour l'ASCII et ignore les accents.
function normalize(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const conn = new DatabaseSync(path.join(DATA_DIR, 'cabas.db'));
conn.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');

// Requetes preparees gardees : le meme SQL n'est compile qu'une fois.
const statements = new Map();
const db = {
  prepare(sql) {
    let st = statements.get(sql);
    if (!st) { st = conn.prepare(sql); statements.set(sql, st); }
    return st;
  },
  exec: (sql) => conn.exec(sql),
};

function tx(fn) {
  conn.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    conn.exec('COMMIT');
    return r;
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
}

// Chaque entree n'est jouee qu'une fois (PRAGMA user_version). Ne jamais modifier une
// entree deja deployee : en ajouter une nouvelle.
const MIGRATIONS = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY,
     email TEXT NOT NULL UNIQUE COLLATE NOCASE,
     name TEXT NOT NULL,
     last_household_id INTEGER,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at INTEGER NOT NULL
   );
   CREATE TABLE login_tokens (
     token_hash TEXT PRIMARY KEY,
     email TEXT NOT NULL,
     expires_at INTEGER NOT NULL,
     used_at INTEGER
   );
   CREATE TABLE households (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     threshold_cents INTEGER NOT NULL DEFAULT 500,
     avg_records INTEGER NOT NULL DEFAULT 5,
     rhythm_days INTEGER NOT NULL DEFAULT 15,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE memberships (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     role TEXT NOT NULL CHECK (role IN ('manager','member')),
     display_name TEXT,
     joined_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, household_id)
   );
   CREATE TABLE invitations (
     token_hash TEXT PRIMARY KEY,
     household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     email TEXT,
     role TEXT NOT NULL CHECK (role IN ('manager','member')),
     invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     expires_at INTEGER NOT NULL,
     used_at INTEGER
   );
   CREATE TABLE stores (
     id INTEGER PRIMARY KEY,
     household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     color TEXT NOT NULL DEFAULT '#5b4bb7',
     active INTEGER NOT NULL DEFAULT 1,
     position INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE categories (
     id INTEGER PRIMARY KEY,
     household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     name TEXT NOT NULL
   );
   CREATE TABLE store_category_order (
     store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
     category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
     position INTEGER NOT NULL,
     PRIMARY KEY (store_id, category_id)
   );
   CREATE TABLE products (
     id INTEGER PRIMARY KEY,
     household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     name_norm TEXT NOT NULL,
     category_id INTEGER NOT NULL REFERENCES categories(id),
     unit TEXT NOT NULL DEFAULT 'paquet',
     contenance TEXT,
     recurrence INTEGER,              -- NULL : non ; n : toutes les n listes
     is_base INTEGER NOT NULL DEFAULT 0,
     forced_store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX products_household ON products(household_id, name_norm);
   CREATE TABLE price_records (
     id INTEGER PRIMARY KEY,
     product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
     store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
     price_cents INTEGER NOT NULL,
     date TEXT NOT NULL,
     source TEXT NOT NULL CHECK (source IN ('check','manual','ocr')),
     promo INTEGER NOT NULL DEFAULT 0,
     user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX price_records_product ON price_records(product_id, store_id, date);`,
  // Etape 2 : listes et articles. store_id (magasin choisi, etape 3) et meal_id (repas
  // d'origine, etape 6) sont prevus des maintenant.
  `CREATE TABLE lists (
     id INTEGER PRIMARY KEY,
     household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     type TEXT NOT NULL CHECK (type IN ('backlog','dated')),
     date TEXT,
     status TEXT NOT NULL DEFAULT 'prep' CHECK (status IN ('prep','shopping','closed')),
     created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at INTEGER NOT NULL,
     closed_at INTEGER
   );
   CREATE UNIQUE INDEX lists_one_backlog ON lists(household_id) WHERE type = 'backlog';
   CREATE UNIQUE INDEX lists_one_per_date ON lists(household_id, date) WHERE type = 'dated';
   CREATE TABLE list_items (
     id INTEGER PRIMARY KEY,
     list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
     product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
     qty REAL NOT NULL DEFAULT 1,
     note TEXT,
     origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','recurring','suggestion','carried','meal')),
     status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','bought','unavailable')),
     suggestion TEXT CHECK (suggestion IN ('pending')),
     suggested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     carried_to INTEGER,              -- liste qui a recu l'article a la cloture (NULL : abandonne)
     store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL,
     meal_id INTEGER,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX list_items_list ON list_items(list_id);
   CREATE INDEX list_items_product ON list_items(product_id);`,
  // Produit supprime du catalogue mais garde pour l'historique des listes cloturees.
  'ALTER TABLE products ADD COLUMN deleted_at INTEGER;',
  // Etape 3 : promos saisies a la main. Valable pour une sortie de courses (list_id) ou
  // jusqu'a une date (valid_until). Prix facultatif (sans prix : simple rappel).
  `CREATE TABLE promos (
     id INTEGER PRIMARY KEY,
     household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
     store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
     price_cents INTEGER,
     list_id INTEGER REFERENCES lists(id) ON DELETE CASCADE,
     valid_until TEXT,
     note TEXT,
     created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at INTEGER NOT NULL,
     CHECK ((list_id IS NULL) <> (valid_until IS NULL))
   );
   CREATE INDEX promos_product ON promos(product_id, store_id);`,
  // Etape 4 : operations deja appliquees (rejeu hors-ligne idempotent).
  `CREATE TABLE applied_ops (
     op_id TEXT PRIMARY KEY,
     household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     result TEXT NOT NULL,
     at INTEGER NOT NULL
   );`,
  // Etape 5 : tickets scannes (texte lu, lignes validees) et correspondances
  // libelle du ticket -> produit, memorisees par magasin.
  `CREATE TABLE receipts (
     id INTEGER PRIMARY KEY,
     household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL,
     list_id INTEGER REFERENCES lists(id) ON DELETE SET NULL,
     date TEXT NOT NULL,
     raw_text TEXT,
     created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE receipt_lines (
     id INTEGER PRIMARY KEY,
     receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
     label TEXT NOT NULL,
     qty REAL NOT NULL DEFAULT 1,
     unit_cents INTEGER,
     promo INTEGER NOT NULL DEFAULT 0,
     product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
     status TEXT NOT NULL CHECK (status IN ('matched','created','ignored'))
   );
   CREATE TABLE store_aliases (
     store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
     label_norm TEXT NOT NULL,
     product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (store_id, label_norm)
   );`,
];

function migrate() {
  const version = conn.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    tx(() => {
      conn.exec(MIGRATIONS[v]);
      conn.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
migrate();

module.exports = { db, tx, normalize, DATA_DIR };
