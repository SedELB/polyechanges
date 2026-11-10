// Construit data/manual/sciencetokyo-jp.json à partir des deux listes officielles des cours ouverts aux étudiants
// d'échange de l'Institut des sciences de Tokyo (PDF du bureau des échanges : « List of Graduate Courses available
// to Undergraduate-level International Exchange Students », automne puis printemps) et de la fiche de chaque code
// dans le syllabus officiel (titre, crédits, langue, trimestre, description). Les listes donnent les trimestres
// (1Q/2Q = printemps, 3Q/4Q = automne). Seuls l'informatique, le génie électrique et informatique et les
// mathématiques sont retenus, d'après le préfixe du code (MTH, MCS, CSC, ICT, EEE).
// À lancer à la main : npx tsx pipeline/readers/sciencetokyo-jp.build.ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import type { HostCourseInput, HostTerm, Provenance } from '../../shared/types.js';
import { createPoliteFetcher, type PoliteFetcher } from '../fetch/politeFetch.js';
import { findQuote, normalizeText, snapshotText } from '../provenance/snapshotText.js';

const SITE = 'https://www.titech.ac.jp/english/international-student-exchange/pdf';
export const LISTS: readonly { url: string; term: HostTerm }[] = [
  { url: `${SITE}/course-list2026f.pdf`, term: 'fall' },
  { url: `${SITE}/course-list2026s.pdf`, term: 'spring' },
];
const SYLLABUS = 'https://syllabus.s.isct.ac.jp/courses/2026';

export interface ListedCode {
  code: string;
  term: HostTerm;
  page: number;
  line: number;
}

const CODE_AT_START = /^([A-Z]{3}\.[A-Z]\d{3})(?:\s|$)/;
const SCOPE_PREFIXES = new Set(['MTH', 'MCS', 'CSC', 'ICT', 'EEE']);

/** Mathématiques, informatique, génie électrique et informatique : d'après le préfixe du code. */
export function isInScope(code: string): boolean {
  return SCOPE_PREFIXES.has(code.slice(0, 3));
}

/** Niveau d'après le numéro : à partir de 400, cycles supérieurs. */
export function levelOf(code: string): 'undergrad' | 'grad' {
  return Number(code.slice(5)) >= 400 ? 'grad' : 'undergrad';
}

/** Codes de cours en tête de rangée du texte extrait de la liste (pages puis lignes, numérotées à partir de 1). */
export function parseListCodes(pages: string[][], term: HostTerm): ListedCode[] {
  const out: ListedCode[] = [];
  pages.forEach((lines, p) => {
    lines.forEach((raw, l) => {
      const m = normalizeText(raw).match(CODE_AT_START);
      if (m && isInScope(m[1]!)) out.push({ code: m[1]!, term, page: p + 1, line: l + 1 });
    });
  });
  return out;
}

export interface MergedCode {
  code: string;
  terms: HostTerm[];
  /** Première rangée rencontrée du code. */
  first: ListedCode;
}

/** Un cours par code : trimestres fusionnés (automne avant printemps). */
export function mergeListed(listed: ListedCode[]): MergedCode[] {
  const byCode = new Map<string, MergedCode>();
  for (const l of listed) {
    const existing = byCode.get(l.code);
    if (!existing) byCode.set(l.code, { code: l.code, terms: [l.term], first: l });
    else if (!existing.terms.includes(l.term)) existing.terms.push(l.term);
  }
  for (const m of byCode.values()) m.terms.sort((a, b) => (a === b ? 0 : a === 'fall' ? -1 : 1));
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function searchUrl(code: string): string {
  return `${SYLLABUS}/search?q=${code}&hl=en`;
}

/** Adresse de la fiche du code dans la page de résultats de recherche (null si le code n'y figure pas). */
export function parseSearch(html: string, code: string): string | null {
  const $ = cheerio.load(html);
  let url: string | null = null;
  $('tr').each((_, tr) => {
    const cells = $(tr).children('td');
    if (url === null && normalizeText(cells.eq(0).text()) === code) url = cells.eq(1).find('a').attr('href') ?? null;
  });
  return url;
}

export interface Syllabus {
  code: string;
  title: string;
  credits: number | null;
  language: string;
  quarter: string;
  description: string;
  /** Ligne de la fiche qui porte le titre, telle qu'elle apparaît dans le texte extrait. */
  titleQuote: string;
}

function ddOf($: cheerio.CheerioAPI, label: string) {
  return $('dt')
    .filter((_, dt) => normalizeText($(dt).text()) === label)
    .first()
    .next('dd');
}

/** Texte des paragraphes qui suivent un titre de section, jusqu'au titre suivant. */
function sectionText($: cheerio.CheerioAPI, heading: string): string {
  const parts: string[] = [];
  $('h3').each((_, h) => {
    if (normalizeText($(h).text()) !== heading) return;
    $(h)
      .nextUntil('h2, h3')
      .each((__, el) => {
        const text = normalizeText($(el).text());
        if (text) parts.push(text);
      });
  });
  return parts.join('\n');
}

/** Fiche d'un cours du syllabus : titre, crédits (cours + exercices + expériences), langue, trimestre, description. */
export function parseCourse(html: string): Syllabus {
  const $ = cheerio.load(html);
  const title = normalizeText($('h1').first().text());
  const credits = ddOf($, 'Number of credits')
    .find('span')
    .toArray()
    .reduce((sum, s) => sum + (Number(normalizeText($(s).text())) || 0), 0);
  const overview = sectionText($, 'Course overview and goals');
  const aims = sectionText($, 'Course description and aims');
  return {
    code: normalizeText(ddOf($, 'Course Code').text()),
    title,
    credits: credits > 0 ? credits : null,
    language: normalizeText(ddOf($, 'Language').text()),
    quarter: normalizeText(ddOf($, 'Offered quarter').text()),
    description: [overview, aims].filter(Boolean).join('\n'),
    titleQuote: title,
  };
}

export function toCourse(
  m: MergedCode,
  s: Syllabus,
  url: string,
  sha256: string,
  line: number,
  retrievedAt: string,
): HostCourseInput & { provenance: Provenance } {
  return {
    code: m.code,
    title: s.title,
    description: s.description,
    outline: null,
    credits: s.credits,
    contactHours: null,
    language: 'en',
    terms: m.terms,
    level: levelOf(m.code),
    sourceUrl: url,
    provenance: { url, retrievedAt, sha256, locator: { page: 1, line }, quote: s.titleQuote },
  };
}

function store(rawDir: string, body: Buffer, ext: string): string {
  const sha = createHash('sha256').update(body).digest('hex');
  const full = join(rawDir, 'sciencetokyo-jp', `${sha}.${ext}`);
  if (!existsSync(full)) {
    mkdirSync(join(rawDir, 'sciencetokyo-jp'), { recursive: true });
    writeFileSync(full, body);
  }
  return sha;
}

export async function build(fetcher: PoliteFetcher, rawDir: string): Promise<HostCourseInput[]> {
  const listed: ListedCode[] = [];
  for (const { url, term } of LISTS) {
    const res = await fetcher.get(url);
    store(rawDir, res.body, 'pdf');
    const codes = parseListCodes(await snapshotText(res.body, 'application/pdf'), term);
    console.log(`${term} : ${codes.length} codes retenus`);
    listed.push(...codes);
  }
  const courses: HostCourseInput[] = [];
  for (const m of mergeListed(listed)) {
    const search = await fetcher.get(searchUrl(m.code));
    const url = parseSearch(search.body.toString('utf8'), m.code);
    if (!url) {
      console.log(`${m.code} : absent du syllabus 2026, ignoré`);
      continue;
    }
    const res = await fetcher.get(url);
    const s = parseCourse(res.body.toString('utf8'));
    if (s.title === '' || s.code !== m.code) throw new Error(`Fiche inattendue pour ${m.code} (${url})`);
    if (s.language !== 'English') {
      console.log(`${m.code} : langue « ${s.language} », ignoré`);
      continue;
    }
    const sha = store(rawDir, res.body, 'html');
    const found = findQuote(await snapshotText(res.body, 'text/html'), s.titleQuote);
    if (found.length === 0) throw new Error(`Extrait introuvable pour ${m.code}`);
    courses.push(toCourse(m, s, url, sha, found[0]!.line, new Date().toISOString()));
  }
  return courses;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const courses = await build(createPoliteFetcher(), join('data', 'raw'));
  mkdirSync(join('data', 'manual'), { recursive: true });
  writeFileSync(join('data', 'manual', 'sciencetokyo-jp.json'), JSON.stringify(courses, null, 2) + '\n');
  console.log(`${courses.length} cours écrits dans data/manual/sciencetokyo-jp.json`);
}
