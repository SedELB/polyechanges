// Régénère la liste `urls` de data/sources/sjtu-cn.json à partir de l'index « Courses Directory by Number »
// du Global College (ex-Joint Institute UM-SJTU). À lancer à la main : npx tsx pipeline/readers/sjtu-cn.discover.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { createPoliteFetcher, type PoliteFetcher } from '../fetch/politeFetch.js';

export const INDEX_URL = 'https://gc.sjtu.edu.cn/academics/courses/courses-by-number/';
/** Préfixes retenus : génie électrique et informatique (ECE), informatique (CS), mathématiques (MATH), science des données (DS). */
export const CODE_PREFIXES = ['ECE', 'CS', 'MATH', 'DS'];

export interface ListedCourse {
  code: string;
  title: string;
  url: string;
}

export function prefixOf(code: string): string {
  return /^[A-Z]+/.exec(code)?.[0] ?? '';
}

export function isWanted(code: string): boolean {
  return CODE_PREFIXES.includes(prefixOf(code));
}

/** Lit l'index : chaque lien vers une fiche de cours, « CODE – Titre », sans doublon d'adresse. */
export function parseIndex(html: string): ListedCourse[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const courses: ListedCourse[] = [];
  $('a[href*="course-info/?id="]').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const [code, ...rest] = text.split(' – ');
    const href = $(el).attr('href');
    if (!href || !code || rest.length === 0) return;
    const url = new URL(href, INDEX_URL).href;
    if (seen.has(url)) return;
    seen.add(url);
    courses.push({ code: code.trim(), title: rest.join(' – ').trim(), url });
  });
  return courses;
}

/** Adresses des fiches retenues (préfixes du périmètre), dans l'ordre de l'index. */
export function selectCourses(courses: ListedCourse[]): string[] {
  return courses.filter((c) => isWanted(c.code)).map((c) => c.url);
}

/** Nombre de cours écartés par préfixe. */
export function excludedByPrefix(courses: ListedCourse[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of courses) {
    if (isWanted(c.code)) continue;
    const p = prefixOf(c.code);
    counts[p] = (counts[p] ?? 0) + 1;
  }
  return counts;
}

export async function discoverUrls(fetcher: PoliteFetcher): Promise<{ urls: string[]; all: ListedCourse[] }> {
  const res = await fetcher.get(INDEX_URL);
  const all = parseIndex(new TextDecoder('utf-8').decode(res.body));
  return { urls: selectCourses(all), all };
}

async function main(): Promise<void> {
  const path = 'data/sources/sjtu-cn.json';
  const { urls, all } = await discoverUrls(createPoliteFetcher());
  const source = JSON.parse(readFileSync(path, 'utf8'));
  source.urls = urls;
  writeFileSync(path, JSON.stringify(source, null, 2) + '\n');
  console.log(`${urls.length} adresses écrites dans ${path} (${all.length - urls.length} cours écartés)`);
  console.log('Écartés par préfixe :', JSON.stringify(excludedByPrefix(all)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
