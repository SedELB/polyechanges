import type { Db } from './open.js';
import type { HostCourseInput, HostTerm } from '../../shared/types.js';

export interface CollectionDiff {
  added: string[];
  removed: string[];
  modified: string[];
}

export type StoredHostCourse = HostCourseInput & {
  id: number;
  universityId: string;
  collectedAt: string;
  snapshotId: number | null;
};

interface Row {
  id: number;
  university_id: string;
  code: string;
  title: string;
  description: string;
  outline: string | null;
  credits: number | null;
  contact_hours: number | null;
  language: HostCourseInput['language'];
  terms_json: string;
  level: HostCourseInput['level'];
  source_url: string;
  snapshot_id: number | null;
  collected_at: string;
}

function fromRow(r: Row): StoredHostCourse {
  return {
    id: r.id,
    universityId: r.university_id,
    code: r.code,
    title: r.title,
    description: r.description,
    outline: r.outline,
    credits: r.credits,
    contactHours: r.contact_hours,
    language: r.language,
    terms: JSON.parse(r.terms_json) as HostTerm[],
    level: r.level,
    sourceUrl: r.source_url,
    snapshotId: r.snapshot_id,
    collectedAt: r.collected_at,
  };
}

export function activeHostCourses(db: Db, universityId?: string): StoredHostCourse[] {
  const sql =
    'SELECT * FROM host_courses WHERE active = 1' +
    (universityId === undefined ? '' : ' AND university_id = ?') +
    ' ORDER BY university_id, code';
  const rows = (universityId === undefined ? db.prepare(sql).all() : db.prepare(sql).all(universityId)) as Row[];
  return rows.map(fromRow);
}

const sortedTerms = (terms: HostTerm[]) => JSON.stringify([...terms].sort());

function differs(a: HostCourseInput, b: HostCourseInput): boolean {
  return (
    a.title !== b.title ||
    a.description !== b.description ||
    a.credits !== b.credits ||
    a.contactHours !== b.contactHours ||
    a.language !== b.language ||
    sortedTerms(a.terms) !== sortedTerms(b.terms)
  );
}

/**
 * Applique une collecte réussie : ajoute, met à jour et désactive (`active = 0`, jamais de suppression).
 * À appeler dans une transaction. `snapshotFor` donne la copie brute d'où vient chaque cours.
 */
export function applyCollection(
  db: Db,
  universityId: string,
  found: HostCourseInput[],
  snapshotFor: (c: HostCourseInput) => number | null,
  collectedAt: string,
): CollectionDiff {
  const previous = new Map(activeHostCourses(db, universityId).map((c) => [c.code, c]));
  const diff: CollectionDiff = { added: [], removed: [], modified: [] };
  const upsert = db.prepare(
    `INSERT INTO host_courses (university_id, code, title, description, outline, credits, contact_hours,
       language, terms_json, level, source_url, snapshot_id, collected_at, active)
     VALUES (@universityId, @code, @title, @description, @outline, @credits, @contactHours,
       @language, @terms, @level, @sourceUrl, @snapshotId, @collectedAt, 1)
     ON CONFLICT(university_id, code) DO UPDATE SET
       title = excluded.title, description = excluded.description, outline = excluded.outline,
       credits = excluded.credits, contact_hours = excluded.contact_hours, language = excluded.language,
       terms_json = excluded.terms_json, level = excluded.level, source_url = excluded.source_url,
       snapshot_id = excluded.snapshot_id, collected_at = excluded.collected_at, active = 1`,
  );
  for (const c of found) {
    const before = previous.get(c.code);
    if (!before) diff.added.push(c.code);
    else if (differs(before, c)) diff.modified.push(c.code);
    upsert.run({
      universityId,
      code: c.code,
      title: c.title,
      description: c.description,
      outline: c.outline,
      credits: c.credits,
      contactHours: c.contactHours,
      language: c.language,
      terms: JSON.stringify(c.terms),
      level: c.level,
      sourceUrl: c.sourceUrl,
      snapshotId: snapshotFor(c),
      collectedAt,
    });
  }
  const foundCodes = new Set(found.map((c) => c.code));
  const deactivate = db.prepare('UPDATE host_courses SET active = 0 WHERE university_id = ? AND code = ?');
  for (const code of previous.keys()) {
    if (!foundCodes.has(code)) {
      diff.removed.push(code);
      deactivate.run(universityId, code);
    }
  }
  diff.added.sort();
  diff.removed.sort();
  diff.modified.sort();
  return diff;
}
