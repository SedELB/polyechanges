import type { Level, Workload } from '../../shared/types.js';
import { round3 } from '../../shared/workload.js';
import { contentBand, contentScore, levelFor } from '../criterion/levels.js';
import type { Db } from '../db/open.js';
import { parsePairId } from './sample.js';

export type Judgment = Level | 'pas_equivalent';
export const JUDGMENTS: Judgment[] = ['elevee', 'moyenne', 'faible', 'pas_equivalent'];

export interface Thresholds {
  detectThreshold: number;
  bandHigh: number;
  bandLow: number;
}

/** Seuils de départ (critère v0) : à accord égal, la calibration garde la combinaison la plus proche. */
export const V0_THRESHOLDS: Thresholds = { detectThreshold: 0.55, bandHigh: 0.7, bandLow: 0.4 };

/** Accord visé entre le niveau calculé et le jugement à l'aveugle. */
export const TARGET_AGREEMENT = 0.8;

const steps = (from: number, to: number): number[] => {
  const out: number[] = [];
  for (let i = 0; ; i++) {
    const v = Math.round((from + i * 0.05) * 100) / 100;
    if (v > to) return out;
    out.push(v);
  }
};

/** Grille de la calibration, par pas de 0.05. */
export const GRID = {
  detectThreshold: steps(0.4, 0.7),
  bandHigh: steps(0.6, 0.85),
  bandLow: steps(0.3, 0.5),
};

/** Part des paires où le niveau calculé est celui du juge, arrondie à trois décimales. */
export function agreement(pairs: { computed: Judgment; judged: Judgment }[]): number {
  if (pairs.length === 0) return 0;
  return round3(pairs.filter((p) => p.computed === p.judged).length / pairs.length);
}

interface StoredPair {
  pairId: string;
  sims: number[];
  workload: Workload;
}

function storedPairs(db: Db, version: string, pairIds: string[]): StoredPair[] {
  const stmt = db.prepare(
    'SELECT notion_sims, workload FROM matches WHERE criterion_version = ? AND poly_sigle = ? AND host_course_id = ?',
  );
  return pairIds.map((pairId) => {
    const { polySigle, hostCourseId } = parsePairId(pairId);
    const r = stmt.get(version, polySigle, hostCourseId) as { notion_sims: string; workload: Workload } | undefined;
    if (!r) throw new Error(`La paire ${pairId} n'a pas été comparée par le critère ${version}`);
    return { pairId, sims: Object.values(JSON.parse(r.notion_sims) as Record<string, number>), workload: r.workload };
  });
}

/** Niveau qu'aurait donné le critère avec ces seuils ; une paire de bande « aucun » vaut « pas_equivalent ». */
function judge(p: StoredPair, t: Thresholds): Judgment {
  const found = p.sims.filter((s) => s >= t.detectThreshold).length;
  const band = contentBand(contentScore(found, p.sims.length), t.bandHigh, t.bandLow);
  return levelFor(band, p.workload) ?? 'pas_equivalent';
}

/** Niveau calculé de chaque paire, à partir des similarités déjà enregistrées par la version. */
export function computedJudgments(db: Db, version: string, pairIds: string[], t: Thresholds): Record<string, Judgment> {
  return Object.fromEntries(storedPairs(db, version, pairIds).map((p) => [p.pairId, judge(p, t)]));
}

const distanceToV0 = (t: Thresholds): number =>
  round3(
    Math.abs(t.detectThreshold - V0_THRESHOLDS.detectThreshold) +
      Math.abs(t.bandHigh - V0_THRESHOLDS.bandHigh) +
      Math.abs(t.bandLow - V0_THRESHOLDS.bandLow),
  );

/**
 * Cherche les seuils qui donnent le meilleur accord avec les jugements. À accord égal, garde la combinaison
 * la plus proche des seuils v0 (somme des écarts absolus), puis la première de la grille.
 */
export function gridSearch(
  db: Db,
  version: string,
  judgments: Record<string, Judgment>,
): { detectThreshold: number; bandHigh: number; bandLow: number; agreement: number } {
  const pairIds = Object.keys(judgments).sort();
  if (pairIds.length === 0) throw new Error('Aucun jugement : la calibration a besoin de paires jugées');
  const pairs = storedPairs(db, version, pairIds);
  let best: (Thresholds & { agreement: number; distance: number }) | null = null;
  for (const detectThreshold of GRID.detectThreshold) {
    for (const bandHigh of GRID.bandHigh) {
      for (const bandLow of GRID.bandLow) {
        if (bandLow >= bandHigh) continue;
        const t = { detectThreshold, bandHigh, bandLow };
        const a = agreement(pairs.map((p) => ({ computed: judge(p, t), judged: judgments[p.pairId] })));
        const distance = distanceToV0(t);
        if (!best || a > best.agreement || (a === best.agreement && distance < best.distance)) {
          best = { ...t, agreement: a, distance };
        }
      }
    }
  }
  const { distance: _distance, ...result } = best as Thresholds & { agreement: number; distance: number };
  return result;
}

/** Écart minimal entre l'accord du gagnant et celui du critère trivial (tout « pas_equivalent »). */
export const MIN_MARGIN = 0.15;

/** Accord d'un critère qui ne retiendrait aucune paire. */
export function trivialAgreement(judged: Judgment[]): number {
  return agreement(judged.map((j) => ({ computed: 'pas_equivalent', judged: j })));
}

/** Le gel exige l'accord visé et une avance suffisante sur le critère trivial. */
export function meetsTarget(winnerAgreement: number, trivial: number): boolean {
  return winnerAgreement >= TARGET_AGREEMENT && winnerAgreement >= round3(trivial + MIN_MARGIN);
}

/** Kappa de Cohen non pondéré sur les 4 classes, arrondi ; 0 quand l'accord dû au hasard vaut déjà 1. */
export function cohenKappa(pairs: { computed: Judgment; judged: Judgment }[]): number {
  if (pairs.length === 0) return 0;
  const n = pairs.length;
  const observed = pairs.filter((p) => p.computed === p.judged).length / n;
  const chance = JUDGMENTS.reduce(
    (sum, k) => sum + (pairs.filter((p) => p.computed === k).length / n) * (pairs.filter((p) => p.judged === k).length / n),
    0,
  );
  return chance >= 1 ? 0 : round3((observed - chance) / (1 - chance));
}

/** Matrice de confusion : `m[jugé][calculé]` = nombre de paires. */
export function confusionMatrix(pairs: { computed: Judgment; judged: Judgment }[]): Record<Judgment, Record<Judgment, number>> {
  const m = Object.fromEntries(JUDGMENTS.map((j) => [j, Object.fromEntries(JUDGMENTS.map((c) => [c, 0]))])) as Record<
    Judgment,
    Record<Judgment, number>
  >;
  for (const p of pairs) m[p.judged][p.computed]++;
  return m;
}

/** Meilleur accord ; à égalité, le plus petit modèle (plus rapide à relancer chaque année), puis le nom de version. */
export function pickWinner(results: { version: string; sizeMillions: number; agreement: number }[]): string {
  if (results.length === 0) throw new Error('Aucun candidat à départager');
  return [...results].sort(
    (a, b) => b.agreement - a.agreement || a.sizeMillions - b.sizeMillions || a.version.localeCompare(b.version),
  )[0].version;
}
