import type { HostCourseInput } from '../../shared/types.js';
import { registerReader, type AsyncReader } from '../collect/readers.js';
import { snapshotText } from '../provenance/snapshotText.js';

export const CITYU_LIST_URL = 'https://www.cs.cityu.edu.hk/en/academic-programmes/student-exchange/exchange-course-list';

/** Rangée de la liste : « CS3103 Operating Systems 3 » (code, titre, crédits). */
const ROW = /^([A-Z]{2,4}\d{4}) (.+) (\d+(?:\.\d+)?)$/;
/** Seuls les cours du département d'informatique : les cours de formation générale (GE…) sont des cours pour tous. */
const IN_SCOPE = /^CS\d{4}$/;

export interface ListRow {
  code: string;
  title: string;
  credits: number;
}

/** Toutes les rangées de cours de la liste (texte extrait : pages, puis lignes), cours de formation générale compris. */
export function parseListRows(pages: string[][]): ListRow[] {
  const rows: ListRow[] = [];
  for (const line of pages.flat()) {
    const m = line.match(ROW);
    if (m) rows.push({ code: m[1]!, title: m[2]!, credits: Number(m[3]) });
  }
  return rows;
}

/** Vrai pour un cours du département d'informatique (code CS + 4 chiffres). */
export const isInScope = (code: string): boolean => IN_SCOPE.test(code);

/**
 * Lecteur de la liste des cours offerts aux étudiants d'échange entrants du département d'informatique de CityU
 * (page enregistrée en PDF, terme 202602 = semestre B, soit `spring`). Seuls les cours CS sont gardés. La liste ne
 * donne ni langue, ni description, ni niveau : langue `unknown` (aucune page enregistrée ne dit que l'enseignement est
 * en anglais), niveau 1er cycle (cours de 1er cycle du catalogue). Les autres pages de la fiche (page d'admission des
 * étudiants d'échange, qui sert de source à un fait de l'université) ne sont pas des listes et sont ignorées.
 */
export const readCityuList: AsyncReader = async (pages) => {
  const courses: HostCourseInput[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    if (page.url !== CITYU_LIST_URL) continue;
    for (const row of parseListRows(await snapshotText(page.body, page.contentType))) {
      if (!isInScope(row.code) || seen.has(row.code)) continue;
      seen.add(row.code);
      courses.push({
        code: row.code,
        title: row.title,
        description: '',
        outline: null,
        credits: row.credits,
        contactHours: null,
        language: 'unknown',
        terms: ['spring'],
        level: 'undergrad',
        sourceUrl: page.url,
      });
    }
  }
  if (courses.length === 0) throw new Error(`Aucune rangée de cours lue dans la liste ${CITYU_LIST_URL}`);
  return courses;
};

registerReader('cityu-hk', readCityuList);
