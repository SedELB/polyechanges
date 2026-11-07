import type { Db } from '../db/open.js';
import { listPolyCourses, upsertPolyCourses } from '../db/polyCourses.js';
import { recordRun } from '../db/runs.js';
import { readSnapshot, takeSavedSnapshot } from '../fetch/snapshots.js';
import { checkGuards } from '../collect/guards.js';
import { recordFailure, type CollectResult } from '../collect/collect.js';
import type { SourceFile } from '../collect/sourceFile.js';
import type { PolyCourse } from '../../shared/types.js';
import { readPolyCourses } from './readPoly.js';

/** Contenu comparé champ par champ (l'ordre des clés ne compte pas ; la date de collecte est ignorée). */
const fingerprint = (c: PolyCourse): string =>
  JSON.stringify([
    c.title,
    c.description,
    c.credits,
    c.triplet,
    c.prerequisites,
    c.status,
    c.eligible,
    c.ineligibleReason,
    c.compared,
    c.groups,
    c.sourceUrl,
  ]);

/**
 * Collecte les cours de Poly depuis les pages enregistrées à la main : copies brutes, lecture,
 * admissibilité, garde-fous, puis une seule transaction. Les cours absents de la nouvelle lecture
 * passent à `active = 0` (jamais supprimés). Rien n'est téléchargé.
 */
export async function collectPoly(db: Db, source: SourceFile, rawDir: string, now: string): Promise<CollectResult> {
  db.prepare(
    `INSERT INTO sources (id, university_id, kind, url, reader) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET university_id = excluded.university_id, kind = excluded.kind,
       url = excluded.url, reader = excluded.reader`,
  ).run(source.id, source.universityId, source.kind, source.urls[0] ?? `saved:${source.id}`, source.reader);

  const before = new Map(listPolyCourses(db).map((c) => [c.sigle, c]));
  const previous = before.size;

  let found: PolyCourse[];
  try {
    if (source.kind !== 'saved' || !source.files) throw new Error(`La source ${source.id} n'est pas une page enregistrée`);
    const bySigle = new Map<string, PolyCourse>();
    for (const [i, file] of source.files.entries()) {
      const snap = takeSavedSnapshot(db, source.id, source.urls[i], file, rawDir);
      const html = readSnapshot(snap, rawDir).toString('utf8');
      for (const c of readPolyCourses(html, source.urls[i], snap.fetchedAt)) {
        const seen = bySigle.get(c.sigle);
        if (seen) seen.groups.push(...c.groups.filter((g) => !seen.groups.includes(g)));
        else bySigle.set(c.sigle, c);
      }
    }
    found = [...bySigle.values()];
  } catch (err) {
    return recordFailure(db, source, now, err instanceof Error ? err.message : String(err), previous);
  }

  const guard = checkGuards(found, previous);
  if (!guard.ok) return recordFailure(db, source, now, guard.reason, previous);

  const diff = db.transaction(() => {
    upsertPolyCourses(db, found);
    const foundSigles = new Set(found.map((c) => c.sigle));
    const deactivate = db.prepare('UPDATE poly_courses SET active = 0 WHERE sigle = ?');
    const d = { added: [] as string[], removed: [] as string[], modified: [] as string[] };
    for (const [sigle] of before) {
      if (!foundSigles.has(sigle)) {
        deactivate.run(sigle);
        d.removed.push(sigle);
      }
    }
    for (const c of found) {
      const old = before.get(c.sigle);
      if (!old) d.added.push(c.sigle);
      else if (fingerprint(old) !== fingerprint(c)) d.modified.push(c.sigle);
    }
    d.added.sort();
    d.removed.sort();
    d.modified.sort();
    recordRun(db, {
      sourceId: source.id,
      startedAt: now,
      status: 'ok',
      coursesFound: found.length,
      previousCount: previous,
      added: d.added.length,
      removed: d.removed.length,
      modified: d.modified.length,
      failureReason: null,
    });
    return d;
  })();
  return { status: 'ok', diff, reason: null };
}

/** Chiffres de synthèse des cours de Poly actifs, pour le rapport. */
export function polySummary(db: Db): { imported: number; compared: number; ineligible: number; obligatoire: number; comparedSigles: string[] } {
  const all = listPolyCourses(db);
  return {
    imported: all.length,
    compared: all.filter((c) => c.compared).length,
    ineligible: all.filter((c) => !c.eligible).length,
    obligatoire: all.filter((c) => c.status === 'obligatoire').length,
    comparedSigles: all.filter((c) => c.compared).map((c) => c.sigle),
  };
}
