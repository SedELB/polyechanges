import type { PolyTerm, TermDates } from '../../../shared/types';

/**
 * Année du départ : l'automne commence en septembre (avant septembre, c'est l'année en cours),
 * l'hiver suivant commence l'année d'après.
 */
export function departureYear(term: PolyTerm, now: Date = new Date()): number {
  const fall = now.getMonth() < 8 ? now.getFullYear() : now.getFullYear() + 1;
  return term === 'automne' ? fall : fall + 1;
}

/** « 2026-2027 » quand les dates datent d'une année antérieure au départ, sinon null. */
export function outdatedYears(dates: TermDates, term: PolyTerm, year: number): string | null {
  const startYear = Number(dates.start.slice(0, 4));
  if (!Number.isFinite(startYear) || startYear >= year) return null;
  return term === 'automne' ? `${startYear}-${startYear + 1}` : `${startYear - 1}-${startYear}`;
}
