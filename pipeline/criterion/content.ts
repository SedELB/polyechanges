import type { Notion } from '../../shared/types.js';
import { round3 } from '../../shared/workload.js';
import type { Embedder } from './embedder.js';

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export interface NotionMatch {
  found: string[];
  missing: string[];
  maxSim: Record<string, number>;
}

/** Règle de détection, à partir de vecteurs déjà calculés : cosinus maximal, arrondi à trois décimales, seuil inclus. */
export function scoreNotions(notions: Notion[], notionVecs: number[][], passageVecs: number[][], threshold: number): NotionMatch {
  const found: string[] = [];
  const missing: string[] = [];
  const maxSim: Record<string, number> = {};
  notions.forEach((n, i) => {
    let best = 0;
    passageVecs.forEach((p, j) => {
      const s = cosine(notionVecs[i], p);
      if (j === 0 || s > best) best = s;
    });
    maxSim[n.id] = round3(best);
    (maxSim[n.id] >= threshold ? found : missing).push(n.id);
  });
  return { found, missing, maxSim };
}

/** Cherche chaque notion de la grille dans les passages d'un cours. */
export async function detectNotions(
  notions: Notion[],
  passages: string[],
  embedder: Embedder,
  threshold: number,
): Promise<NotionMatch> {
  const notionVecs = await embedder.embed(notions.map((n) => n.en), 'notion');
  const passageVecs = passages.length > 0 ? await embedder.embed(passages, 'passage') : [];
  return scoreNotions(notions, notionVecs, passageVecs, threshold);
}
