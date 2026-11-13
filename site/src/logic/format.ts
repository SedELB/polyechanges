import type { HostCourseOut } from '../../../shared/siteData';

/** Nombre au dixième, virgule décimale. */
export const formatNumber = (n: number): string => String(Math.round(n * 10) / 10).replace('.', ',');

// Évite les résidus de virgule flottante (74,75 × 10 = 747,5 exactement ; 0,3 × 10 = 3,0000000000000004).
const tenths = (n: number): number => Math.round(n * 10 * 1e6) / 1e6;

/** Borne basse d’une plage, arrondie vers l’intérieur (au dixième supérieur). */
export const formatLow = (n: number): string => String(Math.ceil(tenths(n)) / 10).replace('.', ',');

/** Borne haute d’une plage, arrondie vers l’intérieur (au dixième inférieur). */
export const formatHigh = (n: number): string => String(Math.floor(tenths(n)) / 10).replace('.', ',');

/** Écart relatif en pourcentage signé. */
export const formatGap = (g: number): string => `${g > 0 ? '+' : g < 0 ? '−' : ''}${formatNumber(Math.abs(g) * 100)} %`;

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/**
 * « 2026-11-13T02:28:59Z » devient « 12 novembre 2026 » : le jour à Montréal d’un horodatage. Une date sans heure
 * (« 2026-11-02 ») garde son jour. Un texte qui n’est pas une date est rendu tel quel.
 */
export function formatDay(iso: string): string {
  let ymd = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
  if (ymd === null && /^\d{4}-\d{2}-\d{2}T/.test(iso) && !Number.isNaN(Date.parse(iso))) {
    // fr-CA écrit AAAA-MM-JJ.
    ymd = new Intl.DateTimeFormat('fr-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  }
  if (ymd === null) return iso;
  const [year, month, day] = ymd.split('-').map(Number);
  if (!year || !month || !day || month > 12) return iso;
  return `${day === 1 ? '1er' : day} ${MONTHS[month - 1]} ${year}`;
}

/** Cycle d’études d’un cours d’accueil, tel qu’affiché. */
export const CYCLE_LABEL: Record<HostCourseOut['level'], string> = { undergrad: '1er cycle', grad: 'Cycles supérieurs' };
