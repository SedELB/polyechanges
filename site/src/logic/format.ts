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

/** Cycle d’études d’un cours d’accueil, tel qu’affiché. */
export const CYCLE_LABEL: Record<HostCourseOut['level'], string> = { undergrad: '1er cycle', grad: 'Cycles supérieurs' };
