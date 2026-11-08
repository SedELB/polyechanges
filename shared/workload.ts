import type { Workload } from './types.js';

export type WorkloadInput =
  | { system: 'ECTS'; hostEcts: number | null; polyCredits: number }
  | { system: 'local'; hostContactHours: number | null; polyTriplet: [number, number, number]; polyWeeks: number };

/** Arrondi à trois décimales. */
export const round3 = (x: number): number => Math.round(x * 1000) / 1000;

export interface WorkloadExplanation {
  kind: 'ECTS' | 'heures';
  expected: number;
  actual: number | null;
  low: number;
  high: number;
  /** Écart relatif (arrondi à trois décimales), null si la charge est inconnue. */
  gap: number | null;
  status: Workload;
}

/** Détaille la comparaison de charge : valeur attendue, bornes acceptées, écart et verdict. */
export function explainWorkload(input: WorkloadInput, tolerance: number): WorkloadExplanation {
  const kind = input.system === 'ECTS' ? 'ECTS' : 'heures';
  const actual = input.system === 'ECTS' ? input.hostEcts : input.hostContactHours;
  const expected =
    input.system === 'ECTS'
      ? 2 * input.polyCredits
      : (input.polyTriplet[0] + input.polyTriplet[1]) * input.polyWeeks;
  const low = round3(expected * (1 - tolerance));
  const high = round3(expected * (1 + tolerance));

  if (actual === null || !Number.isFinite(actual) || !Number.isFinite(expected) || expected <= 0) {
    return { kind, expected, actual: null, low, high, gap: null, status: 'inconnue' };
  }

  const gap = round3((actual - expected) / expected);
  const status = Math.abs(gap) <= tolerance ? 'conforme' : gap < 0 ? 'trop_legere' : 'trop_lourde';
  return { kind, expected, actual, low, high, gap, status };
}

/** Compare la charge de l'université d'accueil à celle attendue à Poly. */
export function checkWorkload(input: WorkloadInput, tolerance: number): Workload {
  return explainWorkload(input, tolerance).status;
}

/** Heures de contact : valeur publiée, sinon crédits × heures par crédit, sinon null. */
export function hostContactHours(
  course: { contactHours: number | null; credits: number | null },
  contactHoursPerCredit: number | null,
): number | null {
  if (course.contactHours !== null) return course.contactHours;
  if (course.credits !== null && contactHoursPerCredit !== null) {
    return course.credits * contactHoursPerCredit;
  }
  return null;
}
