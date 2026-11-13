import type { Db } from '../db/open.js';
import { listPolyCourses, upsertPolyCourses } from '../db/polyCourses.js';
import { recordRun } from '../db/runs.js';
import type { RawSnapshot } from '../fetch/snapshots.js';
import { checkGuards } from '../collect/guards.js';
import { lossLines, recordFailure, skippedResult, withLines, type CollectResult } from '../collect/collect.js';
import { upsertSource } from '../db/sources.js';
import { missingSavedPages, staleSavedWarning, takeSavedSnapshots } from '../collect/saved.js';
import type { SourceFile } from '../collect/sourceFile.js';
import type { PolyCourse } from '../../shared/types.js';
import { findCode, snapshotText } from '../provenance/snapshotText.js';
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
 * passent à `active = 0` (jamais supprimés). Rien n'est téléchargé. `acceptLoss` : baisse voulue.
 */
export async function collectPoly(
  db: Db,
  source: SourceFile,
  rawDir: string,
  now: string,
  opts?: { acceptLoss?: string },
): Promise<CollectResult> {
  upsertSource(db, { ...source, url: source.urls[0] ?? `saved:${source.id}` });

  const before = new Map(listPolyCourses(db).map((c) => [c.sigle, c]));
  const previous = before.size;

  // Pages enregistrées absentes : ignorée (les cours de Poly en base restent), ce n'est pas un échec.
  const absent = missingSavedPages(source).map((m) => m.file);
  if (absent.length > 0) return skippedResult(absent);

  let found: PolyCourse[];
  let snapshots: RawSnapshot[] = [];
  try {
    const saved = takeSavedSnapshots(db, source, rawDir);
    snapshots = saved.map((s) => s.snapshot);
    const bySigle = new Map<string, PolyCourse>();
    for (const [i, { snapshot: snap, body }] of saved.entries()) {
      // Les positions ne doivent jamais faire échouer la collecte : en cas d'erreur, elles restent nulles.
      let text: string[][] = [];
      try {
        text = await snapshotText(body, snap.contentType);
      } catch {
        text = [];
      }
      for (const c of readPolyCourses(body.toString('utf8'), source.urls[i], snap.fetchedAt)) {
        let hit: { page: number; line: number } | undefined;
        try {
          hit = findCode(text, c.sigle)[0];
        } catch {
          hit = undefined;
        }
        const here = hit ? { sha256: snap.sha256, page: hit.page, line: hit.line } : null;
        const seen = bySigle.get(c.sigle);
        if (seen) {
          seen.groups.push(...c.groups.filter((g) => !seen.groups.includes(g)));
          seen.sourceLocator ??= here;
        } else bySigle.set(c.sigle, { ...c, sourceLocator: here });
      }
    }
    found = [...bySigle.values()];
  } catch (err) {
    return recordFailure(db, source, now, err instanceof Error ? err.message : String(err), previous);
  }

  const stale = staleSavedWarning(source.id, snapshots, now);
  const warnings = stale ? [stale] : [];
  const guard = checkGuards(found, previous, { acceptLoss: opts?.acceptLoss !== undefined, target: source.id });
  if (!guard.ok) return withLines(recordFailure(db, source, now, guard.reason, previous), warnings, []);

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
  const loss = lossLines(opts?.acceptLoss, guard, diff.removed, now);
  return withLines({ status: 'ok', diff, reason: null }, warnings, loss.notes, loss.permanent);
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
