import type { Db } from './open.js';

export interface RunRecord {
  sourceId: string;
  startedAt: string;
  status: 'ok' | 'failed';
  coursesFound: number;
  previousCount: number | null;
  added: number;
  removed: number;
  modified: number;
  failureReason: string | null;
}

export function recordRun(db: Db, r: RunRecord): void {
  db.prepare(
    `INSERT INTO collection_runs (source_id, started_at, status, courses_found, previous_count,
       added, removed, modified, failure_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    r.sourceId,
    r.startedAt,
    r.status,
    r.coursesFound,
    r.previousCount,
    r.added,
    r.removed,
    r.modified,
    r.failureReason,
  );
}

export function lastRun(db: Db, sourceId: string): { status: 'ok' | 'failed'; startedAt: string } | null {
  const row = db
    .prepare(
      'SELECT status, started_at AS startedAt FROM collection_runs WHERE source_id = ? ORDER BY started_at DESC, id DESC LIMIT 1',
    )
    .get(sourceId) as { status: 'ok' | 'failed'; startedAt: string } | undefined;
  return row ?? null;
}
