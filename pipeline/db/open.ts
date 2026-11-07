import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';

export type Db = import('better-sqlite3').Database;

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/** Ouvre la base et applique le schéma. `':memory:'` pour les tests. */
export function openDb(path: string): Db {
  const db = new Database(path);
  if (path !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  return db;
}
