// Régénère la liste `urls` de data/sources/nagoya-jp.json à partir de la page officielle « Courses & Syllabi »
// du programme d'échange NUPACE. À lancer à la main : npx tsx pipeline/readers/nagoya-jp.discover.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as cheerio from 'cheerio';
import { createPoliteFetcher, type PoliteFetcher } from '../fetch/politeFetch.js';

export const OVERVIEW_URL = 'https://nupace.iee.nagoya-u.ac.jp/en/academic/overview.html';

/** Écoles retenues en entier : informatique et mathématiques. */
const WHOLE_SECTIONS = ['Informatics', 'Mathematics'];
/** Cours retenus dans la section du génie : génie électrique, électronique, information et analyse numérique. */
const ENGINEERING_TITLES = [
  'Computer Software I',
  'Control Engineering and Tutorial',
  'Electrical Circuits Engineering',
  'Electronic Circuits',
  'Semiconductor Devices',
  'Power Electronics',
  'Numerical Analysis',
  'Mathematics II and Tutorial',
  'Advanced Lectures on Communication and Image Processing',
  'Advanced Lectures on Space Electromagnetic Environment',
  'Theory of Data Analysis and Processing',
  'View of Advanced Electrical, Electronic and Information Engineering',
];
/** Cours de l'Institut d'enseignement général (ILAS) : mathématiques et science des données. */
const ILAS_TITLES = [
  'Calculus I',
  'Calculus II',
  'Linear Algebra I',
  'Linear Algebra II',
  'Complex Analysis',
  'Introduction to Contemporary Mathematics',
  'Introduction to Data Science',
  'Data Science Exercise A',
];

export interface ListedCourse {
  /** Nom de l'ancre de la section de la page (Informatics, Mathematics, Engineering, ILAS...). */
  section: string;
  title: string;
  url: string;
}

function normalizeUrl(href: string): string {
  const url = new URL(href.replace(/\s+/g, ''));
  url.protocol = 'https:';
  return url.href;
}

/** Titre sans la mention du trimestre ni le repère de cycles supérieurs. */
function baseTitle(title: string): string {
  return title
    .replace(/\(Qtr \d\)/g, '')
    .replace(/<G>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lit la page des cours : chaque lien vers un syllabus, avec la section qui le précède dans la page. */
export function parseOverview(html: string): ListedCourse[] {
  const $ = cheerio.load(html);
  const courses: ListedCourse[] = [];
  let section = '';
  $('p[style*="513061"], a[href*="syllabus.adm.nagoya-u.ac.jp/data/"]').each((_, el) => {
    if (el.tagName === 'p') {
      section = $(el).find('a[name]').first().attr('name') ?? '';
      return;
    }
    const title = $(el).text().replace(/\s+/g, ' ').trim();
    const href = $(el).attr('href');
    // Les liens sans texte doublent un lien déjà lu.
    if (!title || !href) return;
    courses.push({ section, title, url: normalizeUrl(href) });
  });
  return courses;
}

export function isWanted(course: ListedCourse): boolean {
  if (WHOLE_SECTIONS.includes(course.section)) return true;
  const title = baseTitle(course.title);
  if (course.section === 'Engineering') return ENGINEERING_TITLES.includes(title);
  if (course.section === 'ILAS') return ILAS_TITLES.includes(title) || title.startsWith('Special Mathematics Lecture');
  return false;
}

/** Adresses des syllabus retenus, sans doublon, triées. */
export function selectCourses(courses: ListedCourse[]): string[] {
  return [...new Set(courses.filter(isWanted).map((c) => c.url))].sort();
}

export async function discoverUrls(fetcher: PoliteFetcher): Promise<string[]> {
  const res = await fetcher.get(OVERVIEW_URL);
  return selectCourses(parseOverview(new TextDecoder('utf-8').decode(res.body)));
}

async function main(): Promise<void> {
  const path = 'data/sources/nagoya-jp.json';
  const urls = await discoverUrls(createPoliteFetcher());
  const source = JSON.parse(readFileSync(path, 'utf8'));
  source.urls = urls;
  writeFileSync(path, JSON.stringify(source, null, 2) + '\n');
  console.log(`${urls.length} adresses écrites dans ${path}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
