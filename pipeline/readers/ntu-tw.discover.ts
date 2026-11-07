// Régénère la liste `urls` de data/sources/ntu-tw.json à partir de la liste officielle
// des cours donnés en anglais de NTU. À lancer à la main : npx tsx pipeline/readers/ntu-tw.discover.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { createPoliteFetcher, type PoliteFetcher } from '../fetch/politeFetch.js';

const BASE = 'https://nol.ntu.edu.tw/nol/coursesearch/';
const PAGE_SIZE = 150;
/** Dernier trimestre d'automne et dernier trimestre de printemps publiés au moment de la collecte. */
export const SEMESTERS = ['115-1', '114-2'] as const;
/** Collèges consultés : génie électrique et informatique (9000), sciences (2000, pour les mathématiques). */
export const COLLEGES = ['9000', '2000'] as const;
/** Préfixes de codes retenus : informatique, génie électrique, mathématiques. */
export const CODE_PREFIXES = ['CSIE', 'EEE', 'EE', 'MATH'];

export interface ListedCourse {
  code: string;
  syllabusUrl: string;
}

export function listUrl(college: string, semester: string, page: number): string {
  return `${BASE}search_for_13_eng.php?op=stu&dptname=${college}&current_sem=${semester}&page_cnt=${PAGE_SIZE}&startrec=${page}&lang=EN`;
}

export function matchesPrefix(code: string): boolean {
  const upper = code.toUpperCase();
  return CODE_PREFIXES.some((p) => upper.startsWith(p) && /\d/.test(upper.charAt(p.length)));
}

/** Lit une page de la liste « Courses conducted in English » : total annoncé et cours des départements retenus. */
export function parseListPage(html: string): { total: number; courses: ListedCourse[] } {
  const $ = cheerio.load(html);
  const totalText = $('font b')
    .filter((_, el) => /^\d+$/.test($(el).text().trim()))
    .first()
    .text();
  const total = Number(totalText);
  if (!Number.isFinite(total)) throw new Error('Liste NTU illisible : nombre total de cours absent');
  const courses: ListedCourse[] = [];
  $('tr[align="center"]').each((_, tr) => {
    const cells = $(tr).children('td');
    const href = cells.eq(4).find('a[href*="print_table.php"]').attr('href');
    const code = cells.eq(2).text().trim();
    if (!href || !code) return;
    if (!matchesPrefix(code)) return;
    courses.push({ code, syllabusUrl: new URL(href, BASE).href });
  });
  return { total, courses };
}

/** Un seul exemplaire par code et par trimestre (la première classe rencontrée). */
export function dedupeByCodeAndSemester(courses: ListedCourse[]): ListedCourse[] {
  const seen = new Set<string>();
  const out: ListedCourse[] = [];
  for (const c of courses) {
    const semester = new URL(c.syllabusUrl).searchParams.get('semester') ?? '';
    const key = `${c.code}|${semester}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export async function discoverUrls(fetcher: PoliteFetcher): Promise<string[]> {
  const all: ListedCourse[] = [];
  for (const semester of SEMESTERS) {
    for (const college of COLLEGES) {
      for (let page = 0; ; page++) {
        const res = await fetcher.get(listUrl(college, semester, page));
        const { total, courses } = parseListPage(new TextDecoder('utf-8').decode(res.body));
        all.push(...courses);
        if ((page + 1) * PAGE_SIZE >= total) break;
      }
    }
  }
  return dedupeByCodeAndSemester(all)
    .map((c) => c.syllabusUrl)
    .sort();
}

async function main(): Promise<void> {
  const path = 'data/sources/ntu-tw.json';
  const urls = await discoverUrls(createPoliteFetcher());
  const source = JSON.parse(readFileSync(path, 'utf8'));
  source.urls = urls;
  writeFileSync(path, JSON.stringify(source, null, 2) + '\n');
  console.log(`${urls.length} adresses écrites dans ${path}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
