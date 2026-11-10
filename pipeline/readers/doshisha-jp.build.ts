// Construit data/manual/doshisha-jp.json à partir de la liste officielle des cours du Global Education Module
// (cours donnés en anglais pour les étudiants d'échange de l'Université Doshisha, PDF publié par le bureau des
// étudiants internationaux). La liste ne donne ni description ni heures de contact : seulement le code, la classe,
// le titre, l'enseignant, le campus, le trimestre et les crédits. Seuls l'informatique et les mathématiques
// (statistiques comprises) sont retenus.
// À lancer à la main : npx tsx pipeline/readers/doshisha-jp.build.ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HostCourseInput, HostTerm, Provenance } from '../../shared/types.js';
import { createPoliteFetcher } from '../fetch/politeFetch.js';
import { normalizeText, snapshotText } from '../provenance/snapshotText.js';

export const LIST_URL = 'https://intad.doshisha.ac.jp/file/2026_GEM_course_List.pdf';

export interface GemRow {
  code: string;
  classCode: string;
  title: string;
  campus: 'I' | 'K';
  term: HostTerm;
  credits: number;
  page: number;
  line: number;
  /** La rangée entière, telle qu'elle apparaît dans le texte extrait. */
  quote: string;
}

const ROW = /^(\d{8}) (\d{3}) (.+) ([IK]) ([SF]) (\d+) Advanced Registration [△○✕]$/;
const CAPS_WORD = /^[A-Z][A-Z'-]+$/;

/** Retire le nom de l'enseignant (suffixe commençant par un mot en majuscules) et le numéro de classe répété. */
function titleOf(rest: string, classCode: string): string {
  const words = rest.split(' ');
  const firstCaps = words.findIndex((w) => CAPS_WORD.test(w));
  let title = firstCaps > 0 ? words.slice(0, firstCaps) : words;
  if (title.length > 1 && Number(title[title.length - 1]) === Number(classCode) && /^\d+$/.test(title[title.length - 1]!)) {
    title = title.slice(0, -1);
  }
  return title.join(' ');
}

/** Rangées de cours du texte extrait de la liste (pages puis lignes, numérotées à partir de 1). */
export function parseGemRows(pages: string[][]): GemRow[] {
  const rows: GemRow[] = [];
  pages.forEach((lines, p) => {
    lines.forEach((raw, l) => {
      const quote = normalizeText(raw);
      const m = quote.match(ROW);
      if (!m) return;
      const [, code, classCode, rest, campus, term, credits] = m as unknown as string[];
      rows.push({
        code: code!,
        classCode: classCode!,
        title: titleOf(rest!, classCode!),
        campus: campus as 'I' | 'K',
        term: term === 'S' ? 'spring' : 'fall',
        credits: Number(credits),
        page: p + 1,
        line: l + 1,
        quote,
      });
    });
  });
  return rows;
}

const SCOPE = /computer science|information technology|mathematics|statistics|quantitative data analysis/i;

/** Informatique, mathématiques et statistiques. */
export function isInScope(title: string): boolean {
  return SCOPE.test(title);
}

export interface MergedCourse {
  code: string;
  title: string;
  credits: number;
  terms: HostTerm[];
  /** Première rangée rencontrée du code (celle qui sert de source). */
  first: GemRow;
}

/** Un cours par code : trimestres fusionnés (automne avant printemps), première rangée conservée. */
export function mergeRows(rows: GemRow[]): MergedCourse[] {
  const byCode = new Map<string, MergedCourse>();
  for (const r of rows) {
    const existing = byCode.get(r.code);
    if (!existing) byCode.set(r.code, { code: r.code, title: r.title, credits: r.credits, terms: [r.term], first: r });
    else if (!existing.terms.includes(r.term)) existing.terms.push(r.term);
  }
  for (const c of byCode.values()) c.terms.sort((a, b) => (a === b ? 0 : a === 'fall' ? -1 : 1));
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function toCourse(
  c: MergedCourse,
  url: string,
  sha256: string,
  retrievedAt: string,
): HostCourseInput & { provenance: Provenance } {
  return {
    code: c.code,
    title: c.title,
    description: '',
    outline: null,
    credits: c.credits,
    contactHours: null,
    language: 'en',
    terms: c.terms,
    level: 'undergrad',
    sourceUrl: url,
    provenance: { url, retrievedAt, sha256, locator: { page: c.first.page, line: c.first.line }, quote: c.first.quote },
  };
}

export async function build(rawDir: string): Promise<HostCourseInput[]> {
  const res = await createPoliteFetcher().get(LIST_URL);
  const sha = createHash('sha256').update(res.body).digest('hex');
  const full = join(rawDir, 'doshisha-jp', `${sha}.pdf`);
  if (!existsSync(full)) {
    mkdirSync(join(rawDir, 'doshisha-jp'), { recursive: true });
    writeFileSync(full, res.body);
  }
  const rows = parseGemRows(await snapshotText(res.body, 'application/pdf'));
  console.log(`${rows.length} rangées dans la liste`);
  const kept = mergeRows(rows.filter((r) => isInScope(r.title)));
  const retrievedAt = new Date().toISOString();
  return kept.map((c) => toCourse(c, LIST_URL, sha, retrievedAt));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const courses = await build(join('data', 'raw'));
  mkdirSync(join('data', 'manual'), { recursive: true });
  writeFileSync(join('data', 'manual', 'doshisha-jp.json'), JSON.stringify(courses, null, 2) + '\n');
  console.log(`${courses.length} cours écrits dans data/manual/doshisha-jp.json`);
}
