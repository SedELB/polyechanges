import type { PolyTerm, TermDates } from '../../../shared/types';

/** Année du prochain départ : l'automne commence en septembre, l'hiver en janvier. */
export function departureYear(term: PolyTerm, now: Date = new Date()): number {
  const year = now.getFullYear();
  if (term === 'automne') return now.getMonth() < 8 ? year : year + 1;
  return now.getMonth() < 1 ? year : year + 1;
}

/** « 2026-2027 » quand les dates datent d'une année antérieure au départ, sinon null. */
export function outdatedYears(dates: TermDates, term: PolyTerm, year: number): string | null {
  const startYear = Number(dates.start.slice(0, 4));
  if (!Number.isFinite(startYear) || startYear >= year) return null;
  return term === 'automne' ? `${startYear}-${startYear + 1}` : `${startYear - 1}-${startYear}`;
}
