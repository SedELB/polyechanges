// Construit data/manual/doshisha-jp.json à partir de deux listes officielles :
// - la liste du Global Education Module (cours de 1er cycle donnés en anglais pour les étudiants d'échange, PDF publié
//   par le bureau des étudiants internationaux) : seuls l'informatique et les mathématiques (statistiques comprises)
//   sont retenus ;
// - le guide d'inscription 2026 de l'ISTC (International Science and Technology Course, cycles supérieurs de la
//   faculté de sciences et génie) : matières de l'informatique, du génie électrique, des mathématiques et du tronc
//   commun, hors thèses, stages, expériences de recherche, cours hors discipline et cours réservés au département.
// Aucune des deux listes ne donne de description ni d'heures de contact.
// À lancer à la main : npx tsx pipeline/readers/doshisha-jp.build.ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HostCourseInput, HostTerm, Provenance } from '../../shared/types.js';
import { createPoliteFetcher } from '../fetch/politeFetch.js';
import { MAX_QUOTE_LINES, normalizeText, snapshotText } from '../provenance/snapshotText.js';

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

export const ISTC_URL = 'https://istc.doshisha.ac.jp/files/koujm/page/MasterCourseRegistrationGuideSE2026.pdf';
/** Pages du texte extrait qui portent la liste des matières de l'ISTC (pages imprimées 13 et 14). */
export const ISTC_PAGES = [14, 15] as const;

export interface IstcRow {
  code: string;
  title: string;
  credits: number | null;
  /** `null` : « not available this year » ou semestre « All » (stages). */
  term: HostTerm | null;
  notAvailable: boolean;
  /** Note « Only for the students in the department ... » : cours réservé aux étudiants du département. */
  reserved: boolean;
  /** Mention « For students enrolled in ... » si présente. */
  cohort: string | null;
  page: number;
  line: number;
  /** Début de la rangée (au plus 3 lignes consécutives du texte extrait, jointes par une espace). */
  quote: string;
}

const ISTC_START = /^\d{8}(?: |$)/;
const ISTC_BREAK = /^(?:\d{8}(?: |$)|\d{3} |Department Code|<AY|\*\d )/;
const ISTC_TITLE = /^\d{8} (?:\*1 )?(?:\d{3} )?(.+?) ?\(E\)/;

/** Rangées de la liste des matières de l'ISTC (une rangée = 1 à 6 lignes du texte extrait). */
export function parseIstcRows(pages: string[][]): IstcRow[] {
  const out: IstcRow[] = [];
  for (const page of ISTC_PAGES) {
    const lines = (pages[page - 1] ?? []).map(normalizeText);
    for (let i = 0; i < lines.length; i++) {
      if (!ISTC_START.test(lines[i]!)) continue;
      let end = i + 1;
      while (end < lines.length && !ISTC_BREAK.test(lines[end]!)) end++;
      const block = lines.slice(i, end);
      const text = block.join(' ');
      const t = text.match(ISTC_TITLE);
      if (!t) continue;
      const notAvailable = /not available this year/.test(text);
      const termMatch = text.match(/\b(Spring|Fall|All)\b/);
      const head = termMatch ? text.slice(0, termMatch.index) : text;
      const digits = [...head.matchAll(/(?<=\s)(\d)(?=\s|$)/g)];
      out.push({
        code: text.slice(0, 8),
        title: t[1]!.replace(/【[^】]*】/g, '').replace(/\s+/g, ' ').trim(),
        credits: digits.length > 0 ? Number(digits[digits.length - 1]![1]) : null,
        term: !notAvailable && termMatch && termMatch[1] !== 'All' ? (termMatch[1] === 'Spring' ? 'spring' : 'fall') : null,
        notAvailable,
        reserved: /Only for the students/.test(text),
        cohort: text.match(/【For students enrolled in ([^】]*)】/)?.[1] ?? null,
        page,
        line: i + 1,
        quote: block.slice(0, Math.min(block.length, MAX_QUOTE_LINES)).join(' '),
      });
      i = end - 1;
    }
  }
  return out;
}

export type IstcExclusion = 'out-of-family' | 'out-of-field' | 'research' | 'not-available' | 'old-cohort' | 'reserved';

/** Cours des familles retenues mais hors informatique, génie électrique et mathématiques (environnement, écologie, physique, chimie, biologie). */
export const OUT_OF_FIELD_CODES: readonly string[] = [
  '31695004',
  '31695005',
  '31695006',
  '31695011',
  '31695012',
  '31696503',
  '31696504',
  '31696506',
  '31696507',
  '31696511',
];

/** Retenus : informatique 31691, électrique 31692, mathématiques 31695, tronc commun 3169650x et 3169651x. */
export function istcExclusion(r: IstcRow): IstcExclusion | null {
  if (!/^(31691|31692|31695|3169650|3169651)/.test(r.code)) return 'out-of-family';
  if (OUT_OF_FIELD_CODES.includes(r.code)) return 'out-of-field';
  if (/Internship|Research and Experiments|Master's Thesis/.test(r.title)) return 'research';
  if (r.reserved) return 'reserved';
  if (r.notAvailable) return 'not-available';
  if (r.cohort && /and before$/.test(r.cohort)) return 'old-cohort';
  return null;
}

export function istcToCourse(
  r: IstcRow,
  url: string,
  sha256: string,
  retrievedAt: string,
): HostCourseInput & { provenance: Provenance } {
  return {
    code: r.code,
    title: r.title,
    description: '',
    outline: null,
    credits: r.credits,
    contactHours: null,
    // Le guide marque « (E) » sans l'expliquer : la langue n'est pas établie.
    language: 'unknown',
    terms: r.term ? [r.term] : [],
    level: 'grad',
    sourceUrl: url,
    provenance: { url, retrievedAt, sha256, locator: { page: r.page, line: r.line }, quote: r.quote },
  };
}

async function fetchRaw(rawDir: string, url: string): Promise<{ body: Buffer; sha: string }> {
  const res = await createPoliteFetcher().get(url);
  const sha = createHash('sha256').update(res.body).digest('hex');
  const full = join(rawDir, 'doshisha-jp', `${sha}.pdf`);
  if (!existsSync(full)) {
    mkdirSync(join(rawDir, 'doshisha-jp'), { recursive: true });
    writeFileSync(full, res.body);
  }
  return { body: res.body, sha };
}

export async function build(rawDir: string): Promise<HostCourseInput[]> {
  const gem = await fetchRaw(rawDir, LIST_URL);
  const rows = parseGemRows(await snapshotText(gem.body, 'application/pdf'));
  console.log(`${rows.length} rangées dans la liste du module`);
  const retrievedAt = new Date().toISOString();
  const courses: HostCourseInput[] = mergeRows(rows.filter((r) => isInScope(r.title))).map((c) =>
    toCourse(c, LIST_URL, gem.sha, retrievedAt),
  );

  const istc = await fetchRaw(rawDir, ISTC_URL);
  const istcRows = parseIstcRows(await snapshotText(istc.body, 'application/pdf'));
  const excluded: Record<string, number> = {};
  for (const r of istcRows) {
    const why = istcExclusion(r);
    if (why) {
      excluded[why] = (excluded[why] ?? 0) + 1;
      continue;
    }
    if (!r.term || r.credits === null) throw new Error(`cours ${r.code} sans trimestre ou sans crédits`);
    courses.push(istcToCourse(r, ISTC_URL, istc.sha, retrievedAt));
  }
  console.log(`${istcRows.length} rangées dans le guide ISTC ; exclues :`, excluded);
  return courses;
}


if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const courses = await build(join('data', 'raw'));
  mkdirSync(join('data', 'manual'), { recursive: true });
  writeFileSync(join('data', 'manual', 'doshisha-jp.json'), JSON.stringify(courses, null, 2) + '\n');
  console.log(`${courses.length} cours écrits dans data/manual/doshisha-jp.json`);
}
