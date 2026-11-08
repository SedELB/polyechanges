import type { ContentBand, Level, Workload } from '../../shared/types.js';
import type { Db } from './open.js';

export interface MatchRow {
  polySigle: string;
  hostCourseId: number;
  notionsFound: string[];
  notionsMissing: string[];
  notionSims: Record<string, number>;
  contentScore: number;
  contentBand: ContentBand;
  workload: Workload;
  level: Level | null;
  textUsed: 'description' | 'description+plan';
}

/** Remplace d'un coup toutes les lignes d'une version du critère. */
export function replaceMatches(db: Db, version: string, rows: MatchRow[]): void {
  const insert = db.prepare(
    `INSERT INTO matches (poly_sigle, host_course_id, criterion_version, notions_found, notions_missing,
       notion_sims, content_score, content_band, workload, level, text_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    db.prepare('DELETE FROM matches WHERE criterion_version = ?').run(version);
    for (const r of rows) {
      insert.run(
        r.polySigle,
        r.hostCourseId,
        version,
        JSON.stringify(r.notionsFound),
        JSON.stringify(r.notionsMissing),
        JSON.stringify(r.notionSims),
        r.contentScore,
        r.contentBand,
        r.workload,
        r.level,
        r.textUsed,
      );
    }
  })();
}
