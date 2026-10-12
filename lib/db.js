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
  // Etape 6 : plats, ingredients, repas planifies. Les ingredients des repas deviennent
  // des articles de liste : list_items.qty = part ajoutee a la main, meal_qty = part des
  // repas (recalculee, detail dans list_item_meals).
  `CREATE TABLE dishes (
     id INTEGER PRIMARY KEY,
     household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     name_norm TEXT NOT NULL,
     portions INTEGER NOT NULL DEFAULT 4,
     time_text TEXT,
     url TEXT,
     steps TEXT,
     notes TEXT,
     created_at INTEGER NOT NULL,
     deleted_at INTEGER
   );
   CREATE TABLE dish_ingredients (
     id INTEGER PRIMARY KEY,
     dish_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
     product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
     qty REAL,
     note TEXT,
     position INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE planned_meals (
     id INTEGER PRIMARY KEY,
     household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     date TEXT NOT NULL,
     slot TEXT NOT NULL CHECK (slot IN ('pdj','midi','soir','coll')),
     dish_id INTEGER NOT NULL REFERENCES dishes(id),
     persons INTEGER NOT NULL DEFAULT 4,
     list_id INTEGER REFERENCES lists(id) ON DELETE SET NULL,
     suggestion TEXT CHECK (suggestion IN ('pending')),
     suggested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX planned_meals_date ON planned_meals(household_id, date);
   CREATE TABLE planned_meal_skips (
     meal_id INTEGER NOT NULL REFERENCES planned_meals(id) ON DELETE CASCADE,
     product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
     PRIMARY KEY (meal_id, product_id)
   );
   CREATE TABLE list_item_meals (
     item_id INTEGER NOT NULL REFERENCES list_items(id) ON DELETE CASCADE,
     meal_id INTEGER NOT NULL REFERENCES planned_meals(id) ON DELETE CASCADE,
     qty REAL NOT NULL,
     PRIMARY KEY (item_id, meal_id)
   );
   ALTER TABLE list_items ADD COLUMN meal_qty REAL NOT NULL DEFAULT 0;
   ALTER TABLE households ADD COLUMN menu_token TEXT;`,
  // Connexion par mot de passe (sans e-mail) et liens de reinitialisation.
  `ALTER TABLE users ADD COLUMN password_hash TEXT;
   CREATE TABLE reset_tokens (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at INTEGER NOT NULL,
     used_at INTEGER
   );`,
  // Menus : periodes (debut -> fin) ; duree et premier jour proposes par defaut (0 = dimanche).
  `CREATE TABLE menus (
     id INTEGER PRIMARY KEY,
     household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     start TEXT NOT NULL,
     end TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX menus_household ON menus(household_id, start);
   ALTER TABLE households ADD COLUMN menu_days INTEGER NOT NULL DEFAULT 15;
   ALTER TABLE households ADD COLUMN menu_start_dow INTEGER NOT NULL DEFAULT 1;`,
  // Variantes de plats : groupes de choix (grp) et options ; ingredient d'une option
  // (option_id) ou commun (NULL) ; choix de chaque repas (sinon 1re option du groupe).
  `CREATE TABLE dish_options (
     id INTEGER PRIMARY KEY,
     dish_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
     grp TEXT NOT NULL,
     name TEXT NOT NULL,
     position INTEGER NOT NULL DEFAULT 0
   );
   ALTER TABLE dish_ingredients ADD COLUMN option_id INTEGER REFERENCES dish_options(id) ON DELETE CASCADE;
   CREATE TABLE planned_meal_options (
     meal_id INTEGER NOT NULL REFERENCES planned_meals(id) ON DELETE CASCADE,
     option_id INTEGER NOT NULL REFERENCES dish_options(id) ON DELETE CASCADE,
     PRIMARY KEY (meal_id, option_id)
   );`,
  // Tags des plats (libres, geres depuis le foyer : renommer, supprimer, fusionner).
  `CREATE TABLE tags (
     id INTEGER PRIMARY KEY,
     household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     name_norm TEXT NOT NULL,
     UNIQUE (household_id, name_norm)
   );
   CREATE TABLE dish_tags (
     dish_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
     tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
     PRIMARY KEY (dish_id, tag_id)
   );`,
  // Unites des ingredients (NULL = emballages ; g, ml, pc) et poids d'une piece du produit
  // (g ou ml) ; quantite reelle de chaque part repas d'un article. Les anciennes notes
  // « 400 g » d'un ingredient a 1 emballage deviennent la quantite.
  (c) => {
    c.exec(`ALTER TABLE products ADD COLUMN piece_qty REAL;
      ALTER TABLE dish_ingredients ADD COLUMN unit TEXT CHECK (unit IN ('g','ml','pc'));
      ALTER TABLE list_item_meals ADD COLUMN amount REAL;
      ALTER TABLE list_item_meals ADD COLUMN amount_unit TEXT;`);
    const { normalizeAmount, toBase } = require('./units');
    for (const r of c.prepare('SELECT id, note FROM dish_ingredients WHERE qty = 1 AND note IS NOT NULL').all()) {
      const m = r.note.trim().match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|gr|grammes?|mg|l|litres?|dl|cl|ml)$/i);
      const a = m && toBase(...Object.values(normalizeAmount(Number(m[1].replace(',', '.')), m[2])));
      if (a) c.prepare('UPDATE dish_ingredients SET qty = ?, unit = ?, note = NULL WHERE id = ?').run(a.qty, a.unit, r.id);
    }
  },
  // Remarques imprimees avec le menu (cle = premier jour de la periode affichee).
  `CREATE TABLE menu_notes (
     household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     start TEXT NOT NULL,
     note TEXT NOT NULL,
     PRIMARY KEY (household_id, start)
   );`,
  // Envies de plats sans date : plat existant (dish_id) ou nom libre (name) ;
  // 'pending' = proposee par un membre, 'ok' = validee par un gestionnaire.
  `CREATE TABLE dish_wishes (
     id INTEGER PRIMARY KEY,
     household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     dish_id INTEGER REFERENCES dishes(id) ON DELETE CASCADE,
     name TEXT,
     status TEXT NOT NULL CHECK (status IN ('pending','ok')),
     created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX dish_wishes_household ON dish_wishes(household_id);`,
  // Fiche brouillon : plat propose par un membre (draft_by), a valider par un gestionnaire ;
  // les envies a nom libre deviennent des brouillons.
  (c) => {
    c.exec(`ALTER TABLE dishes ADD COLUMN draft INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE dishes ADD COLUMN draft_by INTEGER REFERENCES users(id) ON DELETE SET NULL;`);
    for (const w of c.prepare('SELECT id, household_id, name, created_by, created_at FROM dish_wishes WHERE dish_id IS NULL').all()) {
      const same = c.prepare('SELECT id FROM dishes WHERE household_id = ? AND name_norm = ? AND deleted_at IS NULL').get(w.household_id, normalize(w.name));
      const did = same ? same.id : Number(c.prepare('INSERT INTO dishes (household_id, name, name_norm, created_at, draft, draft_by) VALUES (?, ?, ?, ?, 1, ?)')
        .run(w.household_id, w.name, normalize(w.name), w.created_at, w.created_by).lastInsertRowid);
      c.prepare('UPDATE dish_wishes SET dish_id = ?, name = NULL WHERE id = ?').run(did, w.id);
    }
  },
  // Unites des ingredients elargies (kg, cl, l, cuilleres cc / cs) : nouvelle contrainte.
  `ALTER TABLE dish_ingredients ADD COLUMN unit_new TEXT CHECK (unit_new IN ('g','kg','ml','cl','l','pc','cc','cs'));
   UPDATE dish_ingredients SET unit_new = unit;
   ALTER TABLE dish_ingredients DROP COLUMN unit;
   ALTER TABLE dish_ingredients RENAME COLUMN unit_new TO unit;`,
  // Plats composes : un plat (ex. Mezze) regroupe d'autres plats (recettes), un seul
  // niveau ; portions = portions du composant utilisees pour les portions du plat compose.
  // Composant ecarte d'un repas (« pas cette fois »).
  `CREATE TABLE dish_parts (
     id INTEGER PRIMARY KEY,
     dish_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
     part_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
     portions REAL NOT NULL,
     position INTEGER NOT NULL DEFAULT 0,
     UNIQUE (dish_id, part_id)
   );
   CREATE INDEX dish_parts_part ON dish_parts(part_id);
   CREATE TABLE planned_meal_part_skips (
     meal_id INTEGER NOT NULL REFERENCES planned_meals(id) ON DELETE CASCADE,
     part_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
     PRIMARY KEY (meal_id, part_id)
   );`,
  // Photo d'un plat : nom du fichier dans <donnees>/photos.
  'ALTER TABLE dishes ADD COLUMN photo TEXT;',
  // Repas possibles d'un plat (« pdj,midi » ; NULL = midi et soir) et delai minimal entre
  // deux fois le meme plat pour la generation d'un menu.
  `ALTER TABLE dishes ADD COLUMN slots TEXT;
   ALTER TABLE households ADD COLUMN menu_gap_days INTEGER NOT NULL DEFAULT 14;`,
  // Types de plats (poisson, pates…) et modeles de semaine pour la generation du menu :
  // regles « exactement / au plus N repas de ce type par semaine », repas vise facultatif.
  `CREATE TABLE dish_types (
     id INTEGER PRIMARY KEY,
     household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     name_norm TEXT NOT NULL,
     UNIQUE (household_id, name_norm)
   );
   CREATE TABLE dish_type_links (
     dish_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
     type_id INTEGER NOT NULL REFERENCES dish_types(id) ON DELETE CASCADE,
     PRIMARY KEY (dish_id, type_id)
   );
   CREATE TABLE menu_models (
     id INTEGER PRIMARY KEY,
     household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE menu_model_rules (
     id INTEGER PRIMARY KEY,
     model_id INTEGER NOT NULL REFERENCES menu_models(id) ON DELETE CASCADE,
     type_id INTEGER NOT NULL REFERENCES dish_types(id) ON DELETE CASCADE,
     n INTEGER NOT NULL,
     mode TEXT NOT NULL CHECK (mode IN ('exact','max')),
     slot TEXT CHECK (slot IN ('pdj','midi','soir','coll')),
     position INTEGER NOT NULL DEFAULT 0
   );`,
];

function migrate() {
  const version = conn.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    tx(() => {
      if (typeof MIGRATIONS[v] === 'function') MIGRATIONS[v](conn);
      else conn.exec(MIGRATIONS[v]);
      conn.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
migrate();

module.exports = { db, tx, normalize, DATA_DIR };
