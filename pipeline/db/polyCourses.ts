import type { Db } from './open.js';
import type { PolyCourse } from '../../shared/types.js';

export function upsertPolyCourses(db: Db, courses: PolyCourse[]): void {
  const stmt = db.prepare(
    `INSERT INTO poly_courses (sigle, title, description, credits, triplet_json, prerequisites,
       status, eligible, ineligible_reason, compared, groups_json, active, source_url, collected_at)
     VALUES (@sigle, @title, @description, @credits, @triplet, @prerequisites,
       @status, @eligible, @ineligibleReason, @compared, @groups, 1, @sourceUrl, @collectedAt)
     ON CONFLICT(sigle) DO UPDATE SET
       title = excluded.title, description = excluded.description, credits = excluded.credits,
       triplet_json = excluded.triplet_json, prerequisites = excluded.prerequisites,
       status = excluded.status, eligible = excluded.eligible,
       ineligible_reason = excluded.ineligible_reason, compared = excluded.compared,
       groups_json = excluded.groups_json, active = 1,
       source_url = excluded.source_url, collected_at = excluded.collected_at`,
  );
  db.transaction((rows: PolyCourse[]) => {
    for (const c of rows) {
      stmt.run({
        sigle: c.sigle,
        title: c.title,
        description: c.description,
        credits: c.credits,
        triplet: JSON.stringify(c.triplet),
        prerequisites: c.prerequisites,
        status: c.status,
        eligible: c.eligible ? 1 : 0,
        ineligibleReason: c.ineligibleReason,
        compared: c.compared ? 1 : 0,
        groups: JSON.stringify(c.groups),
        sourceUrl: c.sourceUrl,
        collectedAt: c.collectedAt,
      });
    }
  })(courses);
}

interface PolyCourseRow {
  sigle: string;
  title: string;
  description: string;
  credits: number;
  triplet_json: string;
  prerequisites: string;
  status: PolyCourse['status'];
  eligible: number;
  ineligible_reason: string | null;
  compared: number;
  groups_json: string;
  source_url: string;
  collected_at: string;
}

/** Cours de Poly encore présents sur la page du programme. */
export function listPolyCourses(db: Db): PolyCourse[] {
  const rows = db.prepare('SELECT * FROM poly_courses WHERE active = 1 ORDER BY sigle').all() as PolyCourseRow[];
  return rows.map((r) => ({
    sigle: r.sigle,
    title: r.title,
    description: r.description,
    credits: r.credits,
    triplet: JSON.parse(r.triplet_json) as [number, number, number],
    prerequisites: r.prerequisites,
    status: r.status,
    eligible: r.eligible === 1,
    ineligibleReason: r.ineligible_reason,
    compared: r.compared === 1,
    groups: JSON.parse(r.groups_json) as string[],
    sourceUrl: r.source_url,
    collectedAt: r.collected_at,
  }));
}
