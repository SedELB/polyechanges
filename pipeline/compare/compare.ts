import { checkWorkload, hostContactHours } from '../../shared/workload.js';
import type { University } from '../../shared/types.js';
import { detectNotions } from '../criterion/content.js';
import type { Embedder } from '../criterion/embedder.js';
import { createCachedEmbedder } from '../criterion/embeddingCache.js';
import { contentBand, contentScore, levelFor } from '../criterion/levels.js';
import type { LoadedCriterion } from '../criterion/loadCriterion.js';
import { splitPassages } from '../criterion/passages.js';
import { getCriterionVersion, setFrozen, upsertCriterionVersion } from '../db/criterion.js';
import { activeHostCourses } from '../db/hostCourses.js';
import { replaceMatches, type MatchRow } from '../db/matches.js';
import type { Db } from '../db/open.js';
import { listPolyCourses } from '../db/polyCourses.js';
import { getUniversity } from '../db/universities.js';

export class CriterionFrozenError extends Error {}

/** Compare chaque cours de Poly doté d'une grille à chaque cours d'accueil actif en anglais ou de langue inconnue. */
export async function runCompare(db: Db, criterion: LoadedCriterion, embedder: Embedder): Promise<{ pairs: number }> {
  const { params, paramsHash } = criterion;
  const stored = getCriterionVersion(db, params.version);
  if (stored?.frozenAt && stored.paramsHash !== paramsHash) {
    throw new CriterionFrozenError(`Le critère ${params.version} est gelé : crée une nouvelle version`);
  }

  const cached = createCachedEmbedder(db, embedder);
  const hosts = activeHostCourses(db).filter((c) => c.language === 'en' || c.language === 'unknown');
  const universities = new Map<string, University | null>();
  const universityOf = (id: string): University | null => {
    if (!universities.has(id)) universities.set(id, getUniversity(db, id));
    return universities.get(id) ?? null;
  };

  const rows: MatchRow[] = [];
  for (const poly of listPolyCourses(db)) {
    const notions = criterion.notions[poly.sigle];
    if (!poly.compared || !notions || notions.length === 0) continue;
    for (const host of hosts) {
      const university = universityOf(host.universityId);
      if (!university) continue;
      const passages = splitPassages(host);
      const { found, missing, maxSim } = await detectNotions(notions, passages, cached, params.detectThreshold);
      const score = contentScore(found.length, notions.length);
      const band = contentBand(score, params.bandHigh, params.bandLow);
      const workload =
        university.creditSystem === 'ECTS'
          ? checkWorkload({ system: 'ECTS', hostEcts: host.credits, polyCredits: poly.credits }, params.workloadTolerance)
          : checkWorkload(
              {
                system: 'local',
                hostContactHours: hostContactHours(host, university.contactHoursPerCredit),
                polyTriplet: poly.triplet,
                polyWeeks: params.polyWeeks,
              },
              params.workloadTolerance,
            );
      rows.push({
        polySigle: poly.sigle,
        hostCourseId: host.id,
        notionsFound: found,
        notionsMissing: missing,
        notionSims: maxSim,
        contentScore: score,
        contentBand: band,
        workload,
        level: levelFor(band, workload),
        textUsed: host.outline && host.outline.trim() !== '' ? 'description+plan' : 'description',
      });
    }
  }

  db.transaction(() => {
    upsertCriterionVersion(db, params.version, paramsHash, JSON.stringify(params));
    replaceMatches(db, params.version, rows);
  })();
  return { pairs: rows.length };
}

/** Gèle une version : ses paramètres ne pourront plus changer. */
export function freezeCriterion(db: Db, version: string, now: string): void {
  if (!getCriterionVersion(db, version)) {
    throw new Error(`Le critère ${version} n'a jamais été calculé : lance d'abord « npm run compare -- ${version} »`);
  }
  setFrozen(db, version, now);
}
