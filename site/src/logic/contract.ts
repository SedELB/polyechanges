import type { HostCourseOut, SiteMeta } from '../../../shared/siteData';
import type { PolyCourse, University, Workload } from '../../../shared/types';
import { explainWorkload, hostContactHours, type WorkloadExplanation } from '../../../shared/workload';
import type { PairResult } from './rank';

export const MIN_FULL_TIME_CREDITS = 12;
export const MAX_OUTSIDE_ENGINEERING_CREDITS = 6;

export const WARNING_FULL_TIME = 'Moins de 12 crédits Poly : temps plein non atteint';
export const WARNING_OUTSIDE = 'Plus de 6 crédits hors génie (SSH500x)';
export const WARNING_MANUAL = 'Les cours ajoutés à la main ne sont pas inclus dans la vérification de charge';

export interface ManualEntry {
  kind: 'orientation' | 'hors_genie';
  hostCode: string;
  hostTitle: string;
  hostCredits: number | null;
  polyCredits: number;
}

/** Code Poly d’un cours ajouté à la main : ING500x (orientation personnalisée) ou SSH500x (hors génie), x = crédits Poly (guide des contrats d’études hors Québec). */
export function manualPolyCode(e: ManualEntry): string {
  return `${e.kind === 'orientation' ? 'ING500' : 'SSH500'}${e.polyCredits}`;
}

export interface ContractRow {
  hostCode: string;
  hostTitle: string;
  hostCredits: number | null;
  polyCode: string;
  polyTitle: string;
  polyCredits: number;
  manual: boolean;
}

export interface ContractDraft {
  rows: ContractRow[];
  totalPolyCredits: number;
  workloadTotal: Workload;
  /** Détail de la vérification de charge du total (lignes appariées seulement). */
  explanation: WorkloadExplanation;
  warnings: string[];
}

const MANUAL_TITLE: Record<ManualEntry['kind'], string> = {
  orientation: 'Cours d’orientation personnalisée',
  hors_genie: 'Cours hors génie',
};

export function buildContractDraft(input: {
  university: University;
  pairs: PairResult[];
  polyCourses: PolyCourse[];
  manual: ManualEntry[];
  meta: SiteMeta;
}): ContractDraft {
  const { university, pairs, polyCourses, manual, meta } = input;
  const polyBySigle = new Map(polyCourses.map((c) => [c.sigle, c]));

  const matched: { host: HostCourseOut; poly: PolyCourse }[] = [];
  const usedHosts = new Set<number>();
  for (const pair of pairs) {
    const poly = polyBySigle.get(pair.polySigle);
    // Sécurité : un cours d’accueil ne compte jamais deux fois (le classement l’évite déjà).
    if (pair.best && poly && !usedHosts.has(pair.best.course.id)) {
      usedHosts.add(pair.best.course.id);
      matched.push({ host: pair.best.course, poly });
    }
  }

  const rows: ContractRow[] = [
    ...matched.map(
      ({ host, poly }): ContractRow => ({
        hostCode: host.code,
        hostTitle: host.title,
        hostCredits: host.credits,
        polyCode: poly.sigle,
        polyTitle: poly.title,
        polyCredits: poly.credits,
        manual: false,
      }),
    ),
    ...manual.map(
      (e): ContractRow => ({
        hostCode: e.hostCode,
        hostTitle: e.hostTitle,
        hostCredits: e.hostCredits,
        polyCode: manualPolyCode(e),
        polyTitle: MANUAL_TITLE[e.kind],
        polyCredits: e.polyCredits,
        manual: true,
      }),
    ),
  ];

  const totalPolyCredits = rows.reduce((s, r) => s + r.polyCredits, 0);
  const outsideCredits = manual.filter((e) => e.kind === 'hors_genie').reduce((s, e) => s + e.polyCredits, 0);
  const explanation = explainTotal(university, matched, meta);

  const warnings: string[] = [];
  if (totalPolyCredits < MIN_FULL_TIME_CREDITS) warnings.push(WARNING_FULL_TIME);
  if (outsideCredits > MAX_OUTSIDE_ENGINEERING_CREDITS) warnings.push(WARNING_OUTSIDE);
  if (manual.length > 0) warnings.push(WARNING_MANUAL);

  return { rows, totalPolyCredits, workloadTotal: explanation.status, explanation, warnings };
}

function explainTotal(
  university: University,
  matched: { host: HostCourseOut; poly: PolyCourse }[],
  meta: SiteMeta,
): WorkloadExplanation {
  const sum = (values: (number | null)[]): number | null =>
    values.length === 0 || values.some((v) => v === null) ? null : values.reduce<number>((s, v) => s + (v ?? 0), 0);

  if (university.creditSystem === 'ECTS') {
    return explainWorkload(
      {
        system: 'ECTS',
        hostEcts: sum(matched.map((m) => m.host.credits)),
        polyCredits: matched.reduce((s, m) => s + m.poly.credits, 0),
      },
      meta.workloadTolerance,
    );
  }
  const triplet: [number, number, number] = [0, 0, 0];
  for (const { poly } of matched) {
    triplet[0] += poly.triplet[0];
    triplet[1] += poly.triplet[1];
    triplet[2] += poly.triplet[2];
  }
  return explainWorkload(
    {
      system: 'local',
      hostContactHours: sum(matched.map((m) => hostContactHours(m.host, university.contactHoursPerCredit))),
      polyTriplet: triplet,
      polyWeeks: meta.polyWeeks,
    },
    meta.workloadTolerance,
  );
}
