// Construit data/manual/ntust-tw.json à partir de la recherche de cours de Taiwan Tech (querycourse.ntust.edu.tw).
// Le site est une application web qui interroge une interface JSON : la liste des cours demande une requête
// POST, que le moteur de collecte (adresses seulement) ne peut pas lire. Ce script interroge poliment
// l'interface, range les réponses de liste telles que reçues comme copies brutes et écrit la saisie manuelle.
// À lancer à la main : npx tsx pipeline/readers/ntust-tw.build.ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HostCourseInput, HostTerm, Provenance } from '../../shared/types.js';
import { createPoliteFetcher, type PoliteFetcher } from '../fetch/politeFetch.js';

export const CATALOG = 'https://querycourse.ntust.edu.tw/querycourse/';
const API = 'https://querycourse.ntust.edu.tw/QueryCourse/api/';
/** Dernier trimestre d'automne (1151, automne 2026) et dernier trimestre de printemps (1142, printemps 2026) publiés. */
export const SEMESTERS: readonly { semester: string; term: HostTerm }[] = [
  { semester: '1151', term: 'fall' },
  { semester: '1142', term: 'spring' },
];

/**
 * Départements (début du numéro de cours) : informatique (CS), génie électrique (EE), électronique et
 * informatique (ET), programme ECE (EC), licence internationale en TIC (IC), automatique et contrôle (AC),
 * semi-conducteurs avancés (AS).
 */
export const DEPARTMENTS: readonly string[] = ['CS', 'EE', 'ET', 'EC', 'IC', 'AC', 'AS'];

/** Étiquette officielle des cours donnés en anglais (« 英語授課 ») dans la colonne des remarques de la liste. */
const ENGLISH_TAG = 'English Program';

export interface ListedSection {
  /** Numéro de section, par exemple CS3004301. */
  courseNo: string;
  /** Code du cours sans le numéro de section (six premiers caractères), par exemple CS3004. */
  code: string;
  title: string;
  credits: number | null;
  level: 'undergrad' | 'grad';
  semester: string;
  /** Extrait mot pour mot de la réponse (du numéro de cours aux remarques, qui portent l'étiquette anglaise). */
  quote: string;
}

export function listForm(semester: string): Record<string, string> {
  return {
    Semester: semester, CourseNo: '', CourseName: '', CourseTeacher: '', Dimension: '', CourseNotes: 'eng',
    CampusNotes: '', ForeignLanguage: '0', OnlyIntensive: '0', OnlyGeneral: '0', OnleyNTUST: '0',
    OnlyMaster: '0', OnlyUnderGraduate: '0', OnlyNode: '0', Language: 'en',
  };
}

export function detailUrl(semester: string, courseNo: string): string {
  return `${API}coursedetials?semester=${semester}&course_no=${courseNo}&language=en`;
}

/** Après le département, un numéro qui commence par 5 ou plus désigne un cours de cycles supérieurs. */
export function levelOf(courseNo: string): 'undergrad' | 'grad' {
  return Number(courseNo.charAt(2)) >= 5 ? 'grad' : 'undergrad';
}

type Item = Record<string, unknown>;

/** Fragment de la réponse brute : du numéro de cours à la fin des remarques. */
function quoteOf(body: string, courseNo: string): string {
  const from = body.indexOf(`"CourseNo":"${courseNo}"`);
  if (from < 0) return '';
  const contents = body.indexOf('"Contents":"', from);
  if (contents < 0) return '';
  const end = body.indexOf('"', contents + '"Contents":"'.length);
  return body.slice(from, end + 1);
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Sections données en anglais des départements visés d'une réponse de liste. */
export function parseList(body: string): ListedSection[] {
  const items = JSON.parse(body) as Item[];
  const sections: ListedSection[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const courseNo = String(item.CourseNo ?? '');
    if (!DEPARTMENTS.includes(courseNo.slice(0, 2)) || seen.has(courseNo)) continue;
    if (!String(item.Contents ?? '').includes(ENGLISH_TAG)) continue;
    const quote = quoteOf(body, courseNo);
    if (!quote) continue;
    seen.add(courseNo);
    const credits = Number(item.CreditPoint);
    sections.push({
      courseNo,
      code: courseNo.slice(0, 6),
      title: clean(String(item.CourseName ?? '')),
      credits: Number.isFinite(credits) && credits > 0 ? credits : null,
      level: levelOf(courseNo),
      semester: String(item.Semester ?? ''),
      quote,
    });
  }
  return sections;
}

/** Texte du plan de cours : objectifs puis contenu. */
export function parseDescription(body: string): string {
  const json = JSON.parse(body) as Item[];
  const first = json[0] ?? {};
  const parts = [first.CourseObject, first.CourseContent].filter((p): p is string => typeof p === 'string');
  return parts
    .join('\n')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

export interface TermEntry {
  /** Première section rencontrée du cours à ce trimestre. */
  section: ListedSection;
  rawSha: string;
}

export interface Merged {
  code: string;
  title: string;
  credits: number | null;
  level: 'undergrad' | 'grad';
  terms: HostTerm[];
  byTerm: Partial<Record<HostTerm, TermEntry>>;
}

/** Un cours par code : sections et trimestres fusionnés, première section de chaque trimestre conservée. */
export function mergeSections(listed: { section: ListedSection; term: HostTerm; rawSha: string }[]): Merged[] {
  const byCode = new Map<string, Merged>();
  for (const { section, term, rawSha } of listed) {
    let m = byCode.get(section.code);
    if (!m) {
      m = { code: section.code, title: section.title, credits: section.credits, level: section.level, terms: [], byTerm: {} };
      byCode.set(section.code, m);
    }
    if (!m.byTerm[term]) {
      m.byTerm[term] = { section, rawSha };
      m.terms.push(term);
    }
  }
  for (const m of byCode.values()) m.terms.sort((a, b) => (a === b ? 0 : a === 'fall' ? -1 : 1));
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** Cours construit à partir de la section du trimestre `term`, dont la description est `description`. */
export function toCourse(
  m: Merged,
  term: HostTerm,
  description: string,
  retrievedAt: string,
): HostCourseInput & { provenance: Provenance } {
  const entry = m.byTerm[term];
  if (!entry) throw new Error(`Aucune section de ${m.code} au trimestre ${term}`);
  return {
    code: m.code,
    title: m.title,
    description,
    outline: null,
    credits: m.credits,
    contactHours: null,
    language: 'en',
    terms: m.terms,
    level: m.level,
    sourceUrl: detailUrl(entry.section.semester, entry.section.courseNo),
    provenance: { url: CATALOG, retrievedAt, sha256: entry.rawSha, locator: { page: 1, line: 1 }, quote: entry.section.quote },
  };
}

function store(rawDir: string, body: Buffer): string {
  const sha = createHash('sha256').update(body).digest('hex');
  const full = join(rawDir, 'ntust-tw', `${sha}.html`);
  if (!existsSync(full)) {
    mkdirSync(join(rawDir, 'ntust-tw'), { recursive: true });
    writeFileSync(full, body);
  }
  return sha;
}

export async function build(fetcher: PoliteFetcher, rawDir: string): Promise<HostCourseInput[]> {
  const retrievedAt = new Date().toISOString();
  const listed: { section: ListedSection; term: HostTerm; rawSha: string }[] = [];
  for (const { semester, term } of SEMESTERS) {
    const res = await fetcher.post(`${API}courses`, listForm(semester));
    const sha = store(rawDir, res.body);
    const sections = parseList(res.body.toString('utf8'));
    console.log(`${semester} : ${sections.length} sections en anglais`);
    for (const section of sections) listed.push({ section, term, rawSha: sha });
  }
  const courses: HostCourseInput[] = [];
  for (const m of mergeSections(listed)) {
    // Un plan de cours par trimestre offert : on garde le plus long.
    let best: { term: HostTerm; description: string } | null = null;
    for (const term of m.terms) {
      const entry = m.byTerm[term]!;
      const res = await fetcher.get(detailUrl(entry.section.semester, entry.section.courseNo));
      const description = parseDescription(res.body.toString('utf8'));
      if (!best || description.length > best.description.length) best = { term, description };
    }
    courses.push(toCourse(m, best!.term, best!.description, retrievedAt));
  }
  return courses;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const courses = await build(createPoliteFetcher(), join('data', 'raw'));
  mkdirSync(join('data', 'manual'), { recursive: true });
  writeFileSync(join('data', 'manual', 'ntust-tw.json'), JSON.stringify(courses, null, 2) + '\n');
  console.log(`${courses.length} cours écrits dans data/manual/ntust-tw.json`);
}
