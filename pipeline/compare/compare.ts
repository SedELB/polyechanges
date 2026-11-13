import { checkWorkload, hostContactHours } from '../../shared/workload.js';
import type { University } from '../../shared/types.js';
import { scoreNotions } from '../criterion/content.js';
import type { Embedder } from '../criterion/embedder.js';
import { createCachedEmbedder } from '../criterion/embeddingCache.js';
import { capLevel, contentBand, contentScore, levelFor } from '../criterion/levels.js';
import type { ModelConfig } from '../criterion/embedder.js';
import { CriterionFrozenError, writeFrozenMark } from '../criterion/frozen.js';
import { CRITERION_DIR, loadCriterion, type LoadedCriterion } from '../criterion/loadCriterion.js';
import { splitPassages } from '../criterion/passages.js';
import { getCriterionVersion, setFrozen, upsertCriterionVersion } from '../db/criterion.js';
import { activeHostCourses } from '../db/hostCourses.js';
import { replaceMatches, type MatchRow } from '../db/matches.js';
import type { Db } from '../db/open.js';
import { listPolyCourses } from '../db/polyCourses.js';
import { getUniversity } from '../db/universities.js';

export { CriterionFrozenError } from '../criterion/frozen.js';

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

  const polys = listPolyCourses(db).filter((p) => p.compared && (criterion.notions[p.sigle]?.length ?? 0) > 0);
  // Une seule demande de vecteurs par grille et par cours d'accueil : les paires n'ont plus qu'à calculer des cosinus.
  const notionVecs = new Map<string, number[][]>();
  for (const poly of polys) {
    notionVecs.set(poly.sigle, await cached.embed(criterion.notions[poly.sigle].map((n) => n.en), 'notion'));
  }

  const rowsByPoly = new Map<string, MatchRow[]>(polys.map((p) => [p.sigle, []]));
  for (const host of hosts) {
    const university = universityOf(host.universityId);
    if (!university) continue;
    const passages = splitPassages(host);
    const textUsed = textUsedFor(host);
    // Un titre seul ne permet pas de vérifier le contenu : le critère peut plafonner le niveau de ces paires.
    const maxLevel = textUsed === 'titre' ? params.titleOnlyMaxLevel : undefined;
    const passageVecs = passages.length > 0 ? await cached.embed(passages, 'passage') : [];
    for (const poly of polys) {
      const notions = criterion.notions[poly.sigle];
      const { found, missing, maxSim } = scoreNotions(
        notions,
        notionVecs.get(poly.sigle) as number[][],
        passageVecs,
        params.detectThreshold,
      );
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
      (rowsByPoly.get(poly.sigle) as MatchRow[]).push({
        polySigle: poly.sigle,
        hostCourseId: host.id,
        notionsFound: found,
        notionsMissing: missing,
        notionSims: maxSim,
        contentScore: score,
        contentBand: band,
        workload,
        level: capLevel(levelFor(band, workload), maxLevel),
        textUsed,
      });
    }
  }
  const rows = polys.flatMap((p) => rowsByPoly.get(p.sigle) as MatchRow[]);

  db.transaction(() => {
    upsertCriterionVersion(db, params.version, paramsHash, JSON.stringify(params));
    // Une base neuve apprend le gel versionné dans le dépôt.
    if (criterion.frozen && !stored?.frozenAt) setFrozen(db, params.version, criterion.frozen.frozenAt);
    replaceMatches(db, params.version, rows);
  })();
  return { pairs: rows.length };
}

/** Charge la version (refusée si elle est gelée et que ses fichiers ont changé), puis compare. */
export async function compareVersion(
  db: Db,
  version: string,
  embedderFor: (model: ModelConfig) => Promise<Embedder>,
  criterionDir: string = CRITERION_DIR,
): Promise<{ pairs: number }> {
  const criterion = loadCriterion(version, criterionDir);
  return runCompare(db, criterion, await embedderFor(criterion.params.model));
}

/**
 * Gèle une version : écrit `<criterionDir>/<version>/FROZEN.json` (date et hachage, versionnés avec le code) et le note
 * dans la base. Les paires en base doivent venir des fichiers actuels. Une date de gel déjà connue (dépôt ou base) est
 * gardée : regeler ne change rien.
 */
export function freezeCriterion(
  db: Db,
  version: string,
  now: string,
  criterionDir: string = CRITERION_DIR,
): { frozenAt: string; paramsHash: string } {
  const criterion = loadCriterion(version, criterionDir);
  const stored = getCriterionVersion(db, version);
  if (!stored) {
    throw new Error(`Le critère ${version} n'a jamais été calculé : lance d'abord « npm run compare -- ${version} »`);
  }
  if (stored.paramsHash !== criterion.paramsHash) {
    throw new Error(
      `Les paires en base ont été calculées avec d'autres réglages que les fichiers de ${version} : relance « npm run compare -- ${version} » avant de geler`,
    );
  }
  const frozenAt = criterion.frozen?.frozenAt ?? stored.frozenAt ?? now;
  if (!stored.frozenAt) setFrozen(db, version, frozenAt);
  if (!criterion.frozen) writeFrozenMark(criterionDir, { version, frozenAt, paramsHash: criterion.paramsHash });
  return { frozenAt, paramsHash: criterion.paramsHash };
}

/** Texte réellement comparé : le plan s'ajoute à la description ; sans l'un ni l'autre, il ne reste que le titre. */
function textUsedFor(host: { description: string; outline: string | null }): MatchRow['textUsed'] {
  if (host.outline && host.outline.trim() !== '') return 'description+plan';
  return host.description.trim() === '' ? 'titre' : 'description';
}
