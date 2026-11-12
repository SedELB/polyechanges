import type { Db } from '../db/open.js';

/**
 * Fin du concours : supprime les résultats des versions `contest-*` et les vecteurs des modèles qui ne sont pas gardés,
 * puis compacte la base. Refuse tant qu'aucune version vN n'est gelée : le concours n'est pas fini.
 */
export function cleanContest(db: Db, keepModelKeys: string[]): { matches: number; versions: number; embeddings: number } {
  if (keepModelKeys.length === 0) throw new Error('Aucun modèle à garder : le cache des vecteurs serait vidé');
  const frozen = db.prepare('SELECT version FROM criterion_versions WHERE frozen_at IS NOT NULL').all() as { version: string }[];
  if (!frozen.some((r) => /^v\d+$/.test(r.version))) {
    throw new Error('Aucune version vN gelée : gèle le critère choisi avant de nettoyer le concours');
  }
  const keep = keepModelKeys.map(() => '?').join(', ');
  const removed = db.transaction(() => ({
    matches: db.prepare("DELETE FROM matches WHERE criterion_version LIKE 'contest-%'").run().changes,
    versions: db.prepare("DELETE FROM criterion_versions WHERE version LIKE 'contest-%'").run().changes,
    embeddings: db.prepare(`DELETE FROM embeddings WHERE model_key NOT IN (${keep})`).run(...keepModelKeys).changes,
  }))();
  db.exec('VACUUM');
  // En mode WAL, le journal garde une copie des pages : il est vidé pour que la taille du fichier baisse vraiment.
  db.pragma('wal_checkpoint(TRUNCATE)');
  return removed;
}
