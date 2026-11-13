import type { HostCourseInput } from '../../shared/types.js';
import { registerReader, type AsyncReader } from '../collect/readers.js';
import { HANGUL } from '../collect/merge.js';
import { snapshotText } from '../provenance/snapshotText.js';


/** Lignes répétées sur chaque page du catalogue : bandeau du département, séparateurs, numéro de page, légende des crédits. */
const PAGE_FURNITURE = [/^(공과대학|자연과학대학)\(/, /^`$/, /^[·.]{5,}$/, /^- \d+ -$/, /^학점구조는/, /^hours” per week/];

/** Première ligne d'une fiche : « 4190.101* 이산수학 3-3-0 » (numéro de cours, astérisque facultatif, titre coréen, crédits-cours-labo). */
const ENTRY = /^(\d{3,4}\.\d{3}[A-Z]?)\*?\s+\S.*\s\d{1,2}-\d{1,2}-\d{1,2}$/;

/** Colle des lignes d'un paragraphe : un trait d'union de fin de ligne suivi d'une minuscule coupe un mot. */
function joinLines(lines: string[]): string {
  let text = '';
  for (const line of lines) {
    if (text === '') text = line;
    else if (/[A-Za-z]-$/.test(text) && /^[a-z]/.test(line)) text = text.slice(0, -1) + line;
    else text += ` ${line}`;
  }
  return text.replace(/\s+/g, ' ').trim();
}

export interface CatalogueEntry {
  code: string;
  title: string;
  description: string;
}

/**
 * Fiches d'un catalogue de département de SNU (PDF bilingue : titre coréen, titre anglais, description coréenne,
 * description anglaise). Le titre anglais suit la première ligne ; la description anglaise est ce qui suit la
 * dernière ligne contenant du hangul.
 */
export function parseCatalogue(pages: string[][]): CatalogueEntry[] {
  const lines = pages.flat().filter((l) => !PAGE_FURNITURE.some((re) => re.test(l)));
  const entries: CatalogueEntry[] = [];
  let current: { code: string; body: string[] } | null = null;
  const close = () => {
    if (!current) return;
    const { body } = current;
    const first = body.findIndex((l) => HANGUL.test(l));
    const last = body.map((l) => HANGUL.test(l)).lastIndexOf(true);
    const titleLines = first < 0 ? body.slice(0, 1) : body.slice(0, first);
    const descLines = first < 0 ? body.slice(1) : body.slice(last + 1);
    entries.push({ code: current.code, title: joinLines(titleLines), description: joinLines(descLines) });
  };
  for (const line of lines) {
    const match = line.match(ENTRY);
    if (match) {
      close();
      current = { code: match[1], body: [] };
    } else current?.body.push(line);
  }
  close();
  return entries;
}

/**
 * Lecteur des catalogues de départements de SNU (source `enrich`) : titre anglais et description anglaise, associés
 * au cours de l'export par le numéro de cours exact. Pas de crédits, de langue ni de trimestre : l'export fait foi.
 * Un numéro présent deux fois garde la description la plus longue.
 */
export const readSnuCatalogue: AsyncReader = async (pages) => {
  const byCode = new Map<string, HostCourseInput>();
  for (const page of pages) {
    const text = await snapshotText(page.body, page.contentType);
    for (const entry of parseCatalogue(text)) {
      if (entry.title === '') continue;
      const kept = byCode.get(entry.code);
      if (kept && kept.description.length >= entry.description.length) continue;
      byCode.set(entry.code, {
        code: entry.code,
        title: entry.title,
        description: entry.description,
        outline: null,
        credits: null,
        contactHours: null,
        language: 'unknown',
        terms: [],
        level: 'undergrad',
        sourceUrl: page.url,
      });
    }
  }
  return [...byCode.values()];
};

registerReader('snu-kr-catalog', readSnuCatalogue);
