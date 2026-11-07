import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';

export type Db = import('better-sqlite3').Database;

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/**
 * Migrations numérotées, appliquées dans l'ordre selon `PRAGMA user_version`.
 * Ne jamais modifier une migration déjà livrée : en ajouter une nouvelle.
 */
const migrations: ((db: Db) => void)[] = [
  // 1 : schéma initial (idempotent : une base antérieure aux migrations a déjà ces tables)
  (db) => {
    db.exec(schema);
  },
  // 2 : source sans université (Poly) et type `saved` ; sections et état actif des cours de Poly
  (db) => {
    db.exec(`
      CREATE TABLE sources_new (
        id TEXT PRIMARY KEY,
        university_id TEXT REFERENCES universities(id),
        kind TEXT NOT NULL CHECK (kind IN ('html','pdf','manual','saved')),
        url TEXT NOT NULL,
        reader TEXT NOT NULL
      );
      INSERT INTO sources_new (id, university_id, kind, url, reader)
        SELECT id, university_id, kind, url, reader FROM sources;
      DROP TABLE sources;
      ALTER TABLE sources_new RENAME TO sources;
      ALTER TABLE poly_courses ADD COLUMN groups_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE poly_courses ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
    `);
  },
];

function migrate(db: Db): void {
  let version = db.pragma('user_version', { simple: true }) as number;
  if (version >= migrations.length) return;
  // La reconstruction d'une table exige que les clés étrangères soient désactivées pendant la migration.
  db.pragma('foreign_keys = OFF');
  try {
    for (; version < migrations.length; version++) {
      db.transaction(() => {
        migrations[version](db);
        db.pragma(`user_version = ${version + 1}`);
      })();
    }
    const broken = db.pragma('foreign_key_check') as unknown[];
    if (broken.length > 0) throw new Error(`Migration : clés étrangères violées (${broken.length})`);
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/** Ouvre la base et applique les migrations. `':memory:'` pour les tests. */
export function openDb(path: string): Db {
  const db = new Database(path);
  if (path !== ':memory:') db.pragma('journal_mode = WAL');
  migrate(db);
  db.pragma('foreign_keys = ON');
  return db;
}
