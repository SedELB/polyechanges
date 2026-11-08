import type { ContentBand, Level, Workload } from '../../shared/types.js';
import { round3 } from '../../shared/workload.js';

export const contentScore = (found: number, total: number): number => (total === 0 ? 0 : round3(found / total));

export function contentBand(score: number, bandHigh: number, bandLow: number): ContentBand {
  if (score >= bandHigh) return 'tres';
  if (score >= bandLow) return 'partiel';
  return 'aucun';
}

export function levelFor(band: ContentBand, workload: Workload): Level | null {
  if (band === 'aucun') return null;
  if (workload === 'conforme') return band === 'tres' ? 'elevee' : 'moyenne';
  return band === 'tres' ? 'moyenne' : 'faible';
}
