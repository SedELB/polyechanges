import type { Db } from './open.js';

export interface StoredCriterionVersion {
  version: string;
  paramsHash: string;
  frozenAt: string | null;
}

export function getCriterionVersion(db: Db, version: string): StoredCriterionVersion | null {
  const r = db.prepare('SELECT version, params_hash, frozen_at FROM criterion_versions WHERE version = ?').get(version) as
    | { version: string; params_hash: string; frozen_at: string | null }
    | undefined;
  return r ? { version: r.version, paramsHash: r.params_hash, frozenAt: r.frozen_at } : null;
}

/** Enregistre ou met à jour une version ; la date de gel n'est jamais touchée ici. */
export function upsertCriterionVersion(db: Db, version: string, paramsHash: string, paramsJson: string): void {
  db.prepare(
    `INSERT INTO criterion_versions (version, params_hash, params_json, frozen_at) VALUES (?, ?, ?, NULL)
     ON CONFLICT(version) DO UPDATE SET params_hash = excluded.params_hash, params_json = excluded.params_json`,
  ).run(version, paramsHash, paramsJson);
}

export function setFrozen(db: Db, version: string, now: string): void {
  db.prepare('UPDATE criterion_versions SET frozen_at = ? WHERE version = ?').run(now, version);
}
