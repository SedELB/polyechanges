import type { Db } from './open.js';

export interface SnapshotRow {
  id: number;
  sourceId: string;
  url: string;
  fetchedAt: string;
  sha256: string;
  path: string;
  contentType: string;
}

export function insertSnapshot(db: Db, s: Omit<SnapshotRow, 'id'>): SnapshotRow {
  const info = db
    .prepare(
      'INSERT INTO snapshots (source_id, url, fetched_at, sha256, path, content_type) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(s.sourceId, s.url, s.fetchedAt, s.sha256, s.path, s.contentType);
  return { id: Number(info.lastInsertRowid), ...s };
}

export function getSnapshot(db: Db, id: number): SnapshotRow | undefined {
  const r = db
    .prepare(
      'SELECT id, source_id AS sourceId, url, fetched_at AS fetchedAt, sha256, path, content_type AS contentType FROM snapshots WHERE id = ?',
    )
    .get(id) as SnapshotRow | undefined;
  return r;
}
