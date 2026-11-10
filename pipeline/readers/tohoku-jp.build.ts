// Construit data/manual/tohoku-jp.json à partir des deux listes officielles « JYPE Course Information » (automne
// 2026, printemps 2026) du programme d'échange en anglais de l'Université du Tohoku, puis du syllabus PDF de chaque
// cours retenu (titre, crédits, langue, semestre, description). Seuls l'informatique, le génie électrique et les
// mathématiques sont retenus ; la liste des codes retenus est fixée à la main d'après les titres.
// À lancer à la main : npx tsx pipeline/readers/tohoku-jp.build.ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import type { HostCourseInput, HostTerm, Provenance } from '../../shared/types.js';
import { createPoliteFetcher, type PoliteFetcher } from '../fetch/politeFetch.js';
import { findQuote, normalizeText, snapshotText } from '../provenance/snapshotText.js';

const SITE = 'https://www.insc.tohoku.ac.jp';
export const LISTS: readonly { url: string; term: HostTerm }[] = [
  { url: `${SITE}/english/jype-course-information-2026-fall/`, term: 'fall' },
  { url: `${SITE}/english/jype-course-information-2026-spring/`, term: 'spring' },
];

/** Informatique, génie électrique et mathématiques, d'après le titre des cours des listes JYPE 2026. */
const SCOPE_CODES = new Set(['VJ254F83', 'SB1117', 'VJ251S8', 'TB15204', 'TB15212']);

export function isInScope(code: string): boolean {
  return SCOPE_CODES.has(code);
}

export interface ListedRow {
  code: string;
  title: string;
  /** Adresse du syllabus PDF. */
  url: string;
}

const CODE = /^[A-Z][A-Z0-9]{4,}$/;

/** Rangées de cours de la page : le lien vers le syllabus PDF dans la cellule du titre, le code dans la cellule suivante. */
export function parseList(html: string, base: string): ListedRow[] {
  const $ = cheerio.load(html);
  const rows: ListedRow[] = [];
  $('tr').each((_, tr) => {
    const cells = $(tr).children('td').toArray();
    cells.forEach((td, i) => {
      const a = $(td).find('a[href$=".pdf"]').first();
      const next = cells[i + 1];
      if (!a.length || !next) return;
      const code = normalizeText($(next).text());
      if (!CODE.test(code)) return;
      rows.push({ code, title: normalizeText(a.text()), url: new URL(a.attr('href')!, base).href });
    });
  });
  return rows;
}

export interface Syllabus {
  title: string;
  credits: number | null;
  /** Vide quand le syllabus ne la donne pas. */
  language: string;
  term: HostTerm;
  description: string;
  /** Position (1-based) de la ligne du titre dans le texte extrait. */
  titleLine: { page: number; line: number };
}

const SEMESTER = /^(First|Second) semester \d{4}$/;
const CREDITS = /^(\d+(?:\.\d+)?)\s*Credits?$/;
const JAPANESE = /[⺀-⿟぀-ヺー-ヿ㐀-鿿＀-￯]/;
const SKIPPED = /Google Classroom|Class code|class code/;
const METADATA_ONLY = /^(English|Japanese|○|[A-Z]{3}-[A-Z]{3}\d+[A-Z]?|Undergraduate .*|[A-Z][A-Z ,.'-]+)$/;
/** Début du plan, des modalités ou du pied de page : la description s'arrête. */
const STOP =
  /^(\d{1,2}\.\s|\[|[A-Za-z]+ ["“].*\/ ?[A-Z]|Prerequisites|Review |Students (are|will be) |Report|No textbook|Study |Please see|Textbooks|Title Author|\d{4}\/\d{2}\/\d{2} )/;

/** Fiche d'un syllabus (PDF du système UNIPA) : titre sous la ligne du semestre, crédits, langue, description. */
export function parseSyllabus(pages: string[][]): Syllabus {
  const lines = pages[0] ?? [];
  const s = lines.findIndex((l) => SEMESTER.test(l));
  const c = lines.findIndex((l) => CREDITS.test(l));
  if (s < 0 || c < 0) throw new Error('Syllabus inattendu : semestre ou crédits introuvables');
  const title = lines[s + 1]!;
  const credits = Number(lines[c]!.match(CREDITS)![1]);
  let language = '';
  const description: string[] = [];
  let started = false;
  for (const line of lines.slice(c + 1)) {
    if (!started) {
      if (language === '' && /^(English|Japanese)$/.test(line)) language = line;
      if (METADATA_ONLY.test(line) || line === title || SKIPPED.test(line) || JAPANESE.test(line)) continue;
      started = true;
    }
    if (STOP.test(line)) break;
    if (SKIPPED.test(line) || JAPANESE.test(line)) continue;
    description.push(line);
  }
  return {
    title,
    credits,
    language,
    term: lines[s]!.startsWith('First') ? 'spring' : 'fall',
    description: description.join('\n'),
    titleLine: { page: 1, line: s + 2 },
  };
}

export function toCourse(
  code: string,
  s: Syllabus,
  url: string,
  sha256: string,
  retrievedAt: string,
): HostCourseInput & { provenance: Provenance } {
  return {
    code,
    title: s.title,
    description: s.description,
    outline: null,
    credits: s.credits,
    contactHours: null,
    language: 'en',
    terms: [s.term],
    level: 'undergrad',
    sourceUrl: url,
    provenance: { url, retrievedAt, sha256, locator: s.titleLine, quote: s.title },
  };
}

function store(rawDir: string, body: Buffer, ext: string): string {
  const sha = createHash('sha256').update(body).digest('hex');
  const full = join(rawDir, 'tohoku-jp', `${sha}.${ext}`);
  if (!existsSync(full)) {
    mkdirSync(join(rawDir, 'tohoku-jp'), { recursive: true });
    writeFileSync(full, body);
  }
  return sha;
}

export async function build(fetcher: PoliteFetcher, rawDir: string): Promise<HostCourseInput[]> {
  const byCode = new Map<string, HostCourseInput & { provenance: Provenance }>();
  for (const { url, term } of LISTS) {
    const list = await fetcher.get(url);
    store(rawDir, list.body, 'html');
    const rows = parseList(list.body.toString('utf8'), url).filter((r) => isInScope(r.code));
    console.log(`${term} : ${rows.length} cours retenus`);
    for (const row of rows) {
      const res = await fetcher.get(row.url);
      const pages = await snapshotText(res.body, 'application/pdf');
      const s = parseSyllabus(pages);
      if (s.term !== term) throw new Error(`Semestre inattendu pour ${row.code} : ${s.term} au lieu de ${term}`);
      if (s.language !== '' && s.language !== 'English') {
        console.log(`${row.code} : langue « ${s.language} », ignoré`);
        continue;
      }
      const sha = store(rawDir, res.body, 'pdf');
      const found = findQuote(pages, s.title);
      if (found.length === 0) throw new Error(`Extrait introuvable pour ${row.code}`);
      const course = toCourse(row.code, s, row.url, sha, new Date().toISOString());
      course.provenance.locator = { page: found[0]!.page, line: found[0]!.line };
      const previous = byCode.get(row.code);
      if (previous) previous.terms = [...new Set([...previous.terms, ...course.terms])];
      else byCode.set(row.code, course);
    }
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const courses = await build(createPoliteFetcher(), join('data', 'raw'));
  mkdirSync(join('data', 'manual'), { recursive: true });
  writeFileSync(join('data', 'manual', 'tohoku-jp.json'), JSON.stringify(courses, null, 2) + '\n');
  console.log(`${courses.length} cours écrits dans data/manual/tohoku-jp.json`);
}
