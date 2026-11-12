import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setFrozen } from '../db/criterion.js';
import { putEmbeddings } from '../db/embeddings.js';
import type { Db } from '../db/open.js';
import { cleanContest } from './clean.js';
import { seedContestDb } from './testDb.js';

/** Base temporaire sur le disque : v1 gelé, deux versions du concours, vecteurs de trois modèles. */
function base(frozen: boolean): Db {
  const db = seedContestDb(['v1', 'contest-a', 'contest-b'], (v) => v, join(mkdtempSync(join(tmpdir(), 'polyechanges-clean-')), 'db.sqlite'));
  if (frozen) setFrozen(db, 'v1', '2026-11-12');
  const vectors = (n: number) => Array.from({ length: n }, (_, i) => ({ hash: `h${i}`, vector: Array.from({ length: 384 }, () => 0.5) }));
  putEmbeddings(db, 'gardé@r@fp32@00000000', 'passage', vectors(50));
  putEmbeddings(db, 'autre@r@fp32@00000000', 'passage', vectors(200));
  putEmbeddings(db, 'troisième@r@fp32@00000000', 'notion', vectors(10));
  return db;
}
const count = (db: Db, sql: string) => (db.prepare(sql).get() as { n: number }).n;

describe('cleanContest', () => {
  it('supprime les résultats du concours et les vecteurs des autres modèles, puis compacte la base', () => {
    const db = base(true);
    const pagesBefore = db.pragma('page_count', { simple: true }) as number;
    const removed = cleanContest(db, ['gardé@r@fp32@00000000']);
    expect(removed).toEqual({ matches: 2 * 6 * 27, versions: 2, embeddings: 210 });
    expect(count(db, "SELECT COUNT(*) AS n FROM matches WHERE criterion_version LIKE 'contest-%'")).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS n FROM matches WHERE criterion_version = 'v1'")).toBe(6 * 27);
    expect(count(db, "SELECT COUNT(*) AS n FROM criterion_versions WHERE version LIKE 'contest-%'")).toBe(0);
    expect(count(db, 'SELECT COUNT(*) AS n FROM embeddings')).toBe(50);
    expect(count(db, "SELECT COUNT(*) AS n FROM embeddings WHERE model_key = 'gardé@r@fp32@00000000'")).toBe(50);
    expect(db.pragma('page_count', { simple: true }) as number).toBeLessThan(pagesBefore);
    db.close();
  });

  it('refuse tant qu’aucune version vN n’est gelée', () => {
    const db = base(false);
    expect(() => cleanContest(db, ['gardé@r@fp32@00000000'])).toThrow(/gelée/);
    expect(count(db, "SELECT COUNT(*) AS n FROM matches WHERE criterion_version LIKE 'contest-%'")).toBe(2 * 6 * 27);
    db.close();
  });

  it('refuse une liste de modèles à garder vide', () => {
    const db = base(true);
    expect(() => cleanContest(db, [])).toThrow();
    db.close();
  });
});
