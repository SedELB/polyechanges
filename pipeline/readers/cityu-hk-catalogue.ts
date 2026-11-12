import type { HostCourseInput } from '../../shared/types.js';
import { registerReader, type AsyncReader } from '../collect/readers.js';
import { snapshotText } from '../provenance/snapshotText.js';

/** Première ligne d'une fiche : « CS3103 - Operating Systems ». */
const TITLE_LINE = /^([A-Z]{2,4}\d{4}) - (.+)$/;
const CREDITS_LINE = /^Credit Units (\d+(?:\.\d+)?)$/;
const AIMS_HEADING = 'Course Aims';
/** Fin de la rubrique des objectifs. */
const AIMS_END = /^Assessment\b/;

export interface CatalogueSheet {
  code: string;
  title: string;
  credits: number | null;
  /** « Course Aims », lignes recollées par une espace. */
  description: string;
}

/** Lit une fiche du catalogue de CityU (texte extrait : pages, puis lignes). Null sans ligne de titre. */
export function parseCatalogueSheet(pages: string[][]): CatalogueSheet | null {
  const lines = pages.flat();
  const head = lines.findIndex((l) => TITLE_LINE.test(l));
  if (head < 0) return null;
  const [, code, title] = lines[head].match(TITLE_LINE)!;
  const creditsLine = lines.find((l) => CREDITS_LINE.test(l));
  const credits = creditsLine ? Number(creditsLine.match(CREDITS_LINE)![1]) : null;
  const start = lines.indexOf(AIMS_HEADING, head);
  const aims: string[] = [];
  if (start >= 0) {
    for (const line of lines.slice(start + 1)) {
      if (AIMS_END.test(line)) break;
      aims.push(line);
    }
  }
  return { code: code!, title: title!.trim(), credits: credits !== null && credits > 0 ? credits : null, description: aims.join(' ').trim() };
}

/**
 * Lecteur des fiches du catalogue de 1er cycle de CityU (source `enrich`) : description (« Course Aims ») et crédits.
 * La fiche ne donne aucune heure de contact, aucune langue ; ses trimestres (« Course Offering Term ») sont ceux de
 * l'année du catalogue, la liste des échanges fait foi : `terms` vide.
 */
export const readCityuCatalogue: AsyncReader = async (pages) => {
  const courses: HostCourseInput[] = [];
  for (const page of pages) {
    const sheet = parseCatalogueSheet(await snapshotText(page.body, page.contentType));
    if (!sheet) throw new Error(`Fiche du catalogue illisible : ${page.url}`);
    courses.push({
      code: sheet.code,
      title: sheet.title,
      description: sheet.description,
      outline: null,
      credits: sheet.credits,
      contactHours: null,
      language: 'unknown',
      terms: [],
      level: 'undergrad',
      sourceUrl: page.url,
    });
  }
  return courses;
};

registerReader('cityu-hk-catalogue', readCityuCatalogue);
