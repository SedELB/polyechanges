// Construit data/manual/postech-kr.json à partir de la liste des cours de POSTECH (plms.postech.ac.kr).
// La liste officielle des cours s'interroge par adresse (année, trimestre, département, langue), mais la fiche de
// chaque cours est une page à part : ce script lit la liste des cours donnés en anglais, ouvre la fiche de chaque
// code pour son titre anglais, ses crédits et son niveau, range les pages telles que reçues comme copies brutes
// et écrit la saisie manuelle. Le site ne publie aucune description.
// À lancer à la main : npx tsx pipeline/readers/postech-kr.build.ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import type { HostCourseInput, HostTerm, Provenance } from '../../shared/types.js';
import { createPoliteFetcher, type PoliteFetcher } from '../fetch/politeFetch.js';
import { findQuote, normalizeText, snapshotText } from '../provenance/snapshotText.js';

const LIST = 'https://plms.postech.ac.kr/local/ubion/course/lists.php';
/** Dernier trimestre d'automne et dernier trimestre de printemps publiés à la collecte (2026). */
export const SEMESTERS: readonly { year: string; semester: string; term: HostTerm }[] = [
  { year: '2026', semester: '20', term: 'fall' },
  { year: '2026', semester: '10', term: 'spring' },
];

/** Départements : mathématiques, génie électrique, informatique et génie informatique. */
export const DEPARTMENTS: Record<string, string> = {
  MATH: '00031000',
  EE: '00038000',
  CSE: '00039100',
};

export function listUrl(year: string, semester: string, dept: string, page = 1): string {
  return `${LIST}?lang=en&year=${year}&semester=${semester}&dept=${dept}&lang=Y${page > 1 ? `&page=${page}` : ''}`;
}

/** Nombre de pages de la liste (15 sections par page) : le plus grand numéro de la pagination. */
export function pageCount(html: string): number {
  const $ = cheerio.load(html);
  let max = 1;
  $('ul.pagination [data-pagenum]').each((_, a) => {
    max = Math.max(max, Number($(a).attr('data-pagenum')) || 1);
  });
  return max;
}

export interface ListedSection {
  code: string;
  section: string;
  language: string;
  detailId: string;
  detailUrl: string;
}

/** Sections d'une page de liste (la liste est déjà limitée aux cours donnés en anglais). */
export function parseList(html: string): ListedSection[] {
  const $ = cheerio.load(html);
  const sections: ListedSection[] = [];
  $('table.table-coursemos tbody tr').each((_, tr) => {
    const cells = $(tr).children('td');
    const href = cells.eq(2).find('a').attr('href');
    const id = href?.match(/[?&]id=(\d+)/)?.[1];
    if (!href || !id) return;
    sections.push({
      code: normalizeText(cells.eq(0).text()),
      section: normalizeText(cells.eq(1).text()),
      language: normalizeText(cells.eq(4).text()),
      detailId: id,
      detailUrl: href,
    });
  });
  return sections;
}

export interface Detail {
  code: string;
  title: string;
  credits: number | null;
  level: 'undergrad' | 'grad';
  english: boolean;
  /** Ligne de la fiche qui porte le titre anglais, telle qu'elle apparaît dans le texte extrait. */
  titleQuote: string;
}

function fieldOf($: cheerio.CheerioAPI, label: string): string {
  let value = '';
  $('th').each((_, th) => {
    if (value === '' && normalizeText($(th).text()) === label) value = normalizeText($(th).next('td').text());
  });
  return value;
}

/** Fiche d'un cours : titre anglais, crédits (« 학점 »), niveau (« Level 400 ») et langue d'enseignement. */
export function parseDetail(html: string): Detail {
  const $ = cheerio.load(html);
  const title = fieldOf($, '영문 강좌명');
  const credits = Number(fieldOf($, '학점'));
  const level = Number(fieldOf($, '대상').match(/Level\s+(\d+)/)?.[1] ?? '0');
  return {
    code: fieldOf($, '학수번호'),
    title,
    credits: Number.isFinite(credits) && credits > 0 ? credits : null,
    level: level >= 500 ? 'grad' : 'undergrad',
    english: fieldOf($, '언어').toLowerCase() === 'english',
    titleQuote: `영문 강좌명 | ${title}`,
  };
}

export interface Merged {
  code: string;
  terms: HostTerm[];
  /** Section dont la fiche est lue : la première rencontrée (automne avant printemps). */
  best: ListedSection;
}

/** Un cours par code : trimestres fusionnés, première section conservée. */
export function mergeSections(listed: { section: ListedSection; term: HostTerm; rawSha: string }[]): Merged[] {
  const byCode = new Map<string, Merged>();
  for (const { section, term } of listed) {
    const existing = byCode.get(section.code);
    if (!existing) byCode.set(section.code, { code: section.code, terms: [term], best: section });
    else if (!existing.terms.includes(term)) existing.terms.push(term);
  }
  for (const m of byCode.values()) m.terms.sort((a, b) => (a === b ? 0 : a === 'fall' ? -1 : 1));
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function toCourse(
  m: Merged,
  detail: Detail,
  detailSha: string,
  line: number,
  retrievedAt: string,
): HostCourseInput & { provenance: Provenance } {
  return {
    code: m.code,
    title: detail.title,
    description: '',
    outline: null,
    credits: detail.credits,
    contactHours: null,
    language: 'en',
    terms: m.terms,
    level: detail.level,
    sourceUrl: m.best.detailUrl,
    provenance: {
      url: m.best.detailUrl,
      retrievedAt,
      sha256: detailSha,
      locator: { page: 1, line },
      quote: detail.titleQuote,
    },
  };
}

function store(rawDir: string, body: Buffer): string {
  const sha = createHash('sha256').update(body).digest('hex');
  const full = join(rawDir, 'postech-kr', `${sha}.html`);
  if (!existsSync(full)) {
    mkdirSync(join(rawDir, 'postech-kr'), { recursive: true });
    writeFileSync(full, body);
  }
  return sha;
}

export async function build(fetcher: PoliteFetcher, rawDir: string): Promise<HostCourseInput[]> {
  const listed: { section: ListedSection; term: HostTerm; rawSha: string }[] = [];
  for (const { year, semester, term } of SEMESTERS) {
    for (const [name, dept] of Object.entries(DEPARTMENTS)) {
      let pages = 1;
      for (let page = 1; page <= pages; page++) {
        const res = await fetcher.get(listUrl(year, semester, dept, page));
        const html = res.body.toString('utf8');
        if (page === 1) pages = pageCount(html);
        const sha = store(rawDir, res.body);
        const sections = parseList(html);
        console.log(`${year}-${semester} ${name} page ${page}/${pages} : ${sections.length} sections en anglais`);
        for (const section of sections) listed.push({ section, term, rawSha: sha });
      }
    }
  }
  const courses: HostCourseInput[] = [];
  for (const m of mergeSections(listed)) {
    const res = await fetcher.get(m.best.detailUrl);
    const detail = parseDetail(res.body.toString('utf8'));
    if (!detail.english || detail.title === '') {
      console.log(`${m.code} : ignoré (fiche sans titre anglais ou hors anglais)`);
      continue;
    }
    const sha = store(rawDir, res.body);
    const pages = await snapshotText(res.body, 'text/html');
    const found = findQuote(pages, detail.titleQuote);
    if (found.length === 0) throw new Error(`Extrait introuvable pour ${m.code}`);
    courses.push(toCourse(m, detail, sha, found[0]!.line, new Date().toISOString()));
  }
  return courses;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const courses = await build(createPoliteFetcher(), join('data', 'raw'));
  mkdirSync(join('data', 'manual'), { recursive: true });
  writeFileSync(join('data', 'manual', 'postech-kr.json'), JSON.stringify(courses, null, 2) + '\n');
  console.log(`${courses.length} cours écrits dans data/manual/postech-kr.json`);
}
