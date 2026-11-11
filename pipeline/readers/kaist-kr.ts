import * as cheerio from 'cheerio';
import type { HostCourseInput, HostTerm } from '../../shared/types.js';
import { registerReader, type Reader } from '../collect/readers.js';

function clean(text: string): string {
  return text.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/** Semestre d'ouverture écrit en coréen : « 봄학기 » (printemps), « 가을학기 » (automne), « 봄 & 가을학기 », « 봄 or 가을학기 ». */
export function termsOf(text: string): HostTerm[] {
  const terms: HostTerm[] = [];
  if (text.includes('가을')) terms.push('fall');
  if (text.includes('봄')) terms.push('spring');
  return terms;
}

/** « 강:실:학(숙) » : cours:laboratoire:crédits. Les crédits sont le troisième nombre ; « :: » ou absent donne null. */
export function creditsOf(text: string): number | null {
  const m = /^\s*\d+\s*:\s*\d+\s*:\s*(\d+(?:\.\d+)?)/.exec(text);
  const value = m ? Number(m[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Page informatique (cs.kaist.ac.kr/education/undergraduate ou graduate) : un tableau caché par cours, avec code,
 * crédits, semestre d'ouverture, description anglaise et, en commentaire HTML, « 영어강의여부 » (Y/N). Les cours
 * marqués N ne sont pas retournés.
 */
function readComputing(page: { url: string; body: Buffer }, skipped?: string[]): HostCourseInput[] {
  const $ = cheerio.load(page.body.toString('utf8'));
  const courses: HostCourseInput[] = [];
  $('tr.inTable').each((_, tr) => {
    const cells = new Map<string, string>();
    const detail = $(tr).find('table').first();
    detail.find('tr').each((__, row) => {
      const tds = $(row).children('td');
      for (let i = 0; i + 1 < tds.length; i += 2) {
        const label = clean($(tds[i]).text()).replace(/\s+/g, '');
        if (label && !cells.has(label)) cells.set(label, clean($(tds[i + 1]).text()));
      }
    });
    const code = cells.get('과목코드') ?? '';
    const title = cells.get('과목명') ?? '';
    if (!code || !title) throw new Error(`Cours illisible dans ${page.url}`);
    const flag = /<!--\s*<td>\s*영어강의여부\s*<\/td>\s*<td>\s*([YN])\s*<\/td>\s*-->/.exec($.html(tr))?.[1];
    if (flag === 'N') {
      skipped?.push(code);
      return;
    }
    const level = cells.get('과정') === '대학원과정' ? 'grad' : cells.get('과정') === '학부과정' ? 'undergrad' : null;
    if (!level) throw new Error(`Cycle illisible pour ${code} dans ${page.url}`);
    courses.push({
      code,
      title,
      description: cells.get('과목설명') ?? '',
      outline: null,
      credits: creditsOf(cells.get('강:실:학(숙)') ?? ''),
      contactHours: null,
      // Y : la page le dit ; absent : on ne le sait pas.
      language: flag === 'Y' ? 'en' : 'unknown',
      terms: termsOf(cells.get('개설학기') ?? ''),
      level,
      sourceUrl: page.url,
    });
  });
  return courses;
}

/**
 * Page génie électrique (ee.kaist.ac.kr/en/under-curr-list ou graduate-curr-list, ?page=N) : dix cours par page,
 * avec catégorie, crédits (« 3credits »), code, titre et description. La page ne donne ni la langue ni le semestre.
 */
function readElectrical(page: { url: string; body: Buffer }): HostCourseInput[] {
  const $ = cheerio.load(page.body.toString('utf8'));
  const level = /\/graduate-curr-list/.test(page.url) ? 'grad' : 'undergrad';
  const courses: HostCourseInput[] = [];
  $('article.ecs-post-loop').each((_, article) => {
    const a = $(article);
    const title = clean(a.find('h2.elementor-heading-title a').first().text());
    // Recherche de thèse : pas un cours, et fermé aux échanges (page des échanges entrants).
    if (/thesis/i.test(title)) return;
    const code = a
      .find('.elementor-widget-text-editor .elementor-widget-container')
      .map((__, el) => clean($(el).text()))
      .get()
      .find((t) => /^[A-Z]{2,}\.\d+(?:\(\w+\))?$/.test(t));
    if (!code || !title) throw new Error(`Cours illisible dans ${page.url}`);
    const creditsText = a
      .find('.curr-list-category')
      .map((__, el) => clean($(el).text()))
      .get()
      .find((t) => /^\d+(?:\.\d+)?\s*credits?$/i.test(t));
    const credits = creditsText ? Number(/^\d+(?:\.\d+)?/.exec(creditsText)![0]) : NaN;
    courses.push({
      code,
      title,
      description: clean(a.find('.under-curr-list-video').first().text()),
      outline: null,
      credits: Number.isFinite(credits) && credits > 0 ? credits : null,
      contactHours: null,
      language: 'unknown',
      terms: [],
      level,
      sourceUrl: page.url,
    });
  });
  return courses;
}

/** Nombre de pages d'une liste du site de génie électrique (« max_num_pages » du composant de pagination). */
export function electricalPageCount(html: string): number {
  const m = /max_num_pages(?:&quot;|")\s*:\s*(\d+)/.exec(html);
  if (!m) throw new Error('Liste EE illisible : nombre de pages absent');
  return Number(m[1]);
}

/** Cours de la page selon son hôte ; `skipped` reçoit les codes d'informatique exclus (« 영어강의여부 » = N). */
export function readKaistPage(page: { url: string; body: Buffer }, skipped?: string[]): HostCourseInput[] {
  const host = new URL(page.url).hostname;
  if (host === 'cs.kaist.ac.kr') return readComputing(page, skipped);
  if (host === 'ee.kaist.ac.kr') return readElectrical(page);
  throw new Error(`Hôte KAIST inconnu : ${page.url}`);
}

/** Lecteur KAIST : listes de programme (pas les cours ouverts ce trimestre). Un code répété garde la description la plus longue. */
export const readKaistCourses: Reader = (pages) => {
  const byCode = new Map<string, HostCourseInput>();
  for (const page of pages) {
    for (const course of readKaistPage(page)) {
      const existing = byCode.get(course.code);
      if (!existing) byCode.set(course.code, course);
      else {
        const longer = course.description.length > existing.description.length ? course : existing;
        const other = longer === course ? existing : course;
        byCode.set(course.code, {
          ...longer,
          credits: longer.credits ?? other.credits,
          terms: [...new Set([...longer.terms, ...other.terms])],
        });
      }
    }
  }
  return [...byCode.values()];
};

registerReader('kaist-kr', readKaistCourses);
