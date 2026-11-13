import type { PolyTerm, TermDates } from '../../../shared/types';

/**
 * Année du départ : l'automne commence en septembre (avant septembre, c'est l'année en cours),
 * l'hiver suivant commence l'année d'après.
 */
export function departureYear(term: PolyTerm, now: Date = new Date()): number {
  const fall = now.getMonth() < 8 ? now.getFullYear() : now.getFullYear() + 1;
  return term === 'automne' ? fall : fall + 1;
}

/**
 * « 2026-2027 » quand les dates datent d'une année antérieure au départ, sinon null. Sans début publié, la première
 * date publiée (fin, puis fin des examens) sert : une fin d'automne avant juillet appartient au trimestre commencé l'année d'avant.
 */
export function outdatedYears(dates: TermDates, term: PolyTerm, year: number): string | null {
  const first = dates.start ?? dates.end ?? dates.examsEnd;
  if (first === null) return null;
  let startYear = Number(first.slice(0, 4));
  if (dates.start === null && term === 'automne' && Number(first.slice(5, 7)) < 7) startYear -= 1;
  if (!Number.isFinite(startYear) || startYear >= year) return null;
  return term === 'automne' ? `${startYear}-${startYear + 1}` : `${startYear - 1}-${startYear}`;
}
