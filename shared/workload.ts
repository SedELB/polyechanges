import type { Workload } from './types.js';

export type WorkloadInput =
  | { system: 'ECTS'; hostEcts: number | null; polyCredits: number }
  | { system: 'local'; hostContactHours: number | null; polyTriplet: [number, number, number]; polyWeeks: number };

/** Arrondi à trois décimales. */
export const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** Compare la charge de l'université d'accueil à celle attendue à Poly. */
export function checkWorkload(input: WorkloadInput, tolerance: number): Workload {
  const host = input.system === 'ECTS' ? input.hostEcts : input.hostContactHours;
  const expected =
    input.system === 'ECTS'
      ? 2 * input.polyCredits
      : (input.polyTriplet[0] + input.polyTriplet[1]) * input.polyWeeks;

  if (host === null || !Number.isFinite(host) || !Number.isFinite(expected) || expected <= 0) {
    return 'inconnue';
  }

  const gap = round3((host - expected) / expected);
  if (Math.abs(gap) <= tolerance) return 'conforme';
  return gap < 0 ? 'trop_legere' : 'trop_lourde';
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
