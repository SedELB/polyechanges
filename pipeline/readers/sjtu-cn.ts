import * as cheerio from 'cheerio';
import type { HostCourseInput } from '../../shared/types.js';
import { registerReader, type Reader } from '../collect/readers.js';

function clean(text: string): string {
  return text.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/** Texte du paragraphe qui suit l'intitulé (« Credits: », « Description: »...), jusqu'au prochain intitulé. */
function section($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>, label: string): cheerio.Cheerio<any> | null {
  const heading = root.find('p > strong').filter((_, el) => $(el).text().trim() === label).first();
  return heading.length ? heading.parent() : null;
}

function textAfter($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>, label: string): string {
  const heading = section($, root, label);
  if (!heading) return '';
  const parts: string[] = [];
  for (let el = heading.next(); el.length; el = el.next()) {
    if (el.is('p') && el.children('strong').length > 0) break;
    if (el.is('div') && el.attr('style')?.includes('height')) continue;
    if (el.is('div.topics')) break;
    parts.push(el.text());
  }
  return clean(parts.join('\n'));
}

/** Cycle : les numéros 5xxx à 7xxx sont ceux de l'onglet « Graduate » de l'index, 0xxx à 4xxx ceux de « Undergraduate ». */
function levelOf(code: string): 'undergrad' | 'grad' {
  const digit = /\d/.exec(code)?.[0];
  return digit !== undefined && Number(digit) >= 5 ? 'grad' : 'undergrad';
}

/**
 * Lecteur des fiches de cours du Global College (ex-Joint Institute UM-SJTU) de SJTU. Chaque page est la fiche d'un
 * cours (`course-info/?id=<n>`) ; les adresses viennent de l'index par numéro (voir sjtu-cn.discover.ts). La fiche ne
 * donne pas de trimestre : `terms` reste vide. Le Global College enseigne tous ses cours en anglais (page d'admission).
 */
export const readSjtuCourses: Reader = (pages) => {
  const byCode = new Map<string, HostCourseInput>();
  for (const page of pages) {
    const $ = cheerio.load(page.body.toString('utf8'));
    const root = $('.course-info').first();
    const heading = clean(root.find('h2').first().text());
    const [code, ...rest] = heading.split(' – ');
    const title = rest.join(' – ').trim();
    if (!code || !title) throw new Error(`Fiche de cours illisible : ${page.url}`);
    const credits = Number(/^(\d+(?:\.\d+)?)/.exec(textAfter($, root, 'Credits:'))?.[1]);
    const description = textAfter($, root, 'Description:');
    const outline =
      root
        .find('.topics li')
        .map((_, li) => clean($(li).text()))
        .get()
        .filter(Boolean)
        .join('\n') || null;
    const course: HostCourseInput = {
      code: code.trim(),
      title,
      description,
      outline,
      credits: Number.isFinite(credits) && credits > 0 ? credits : null,
      contactHours: null,
      language: 'en',
      terms: [],
      level: levelOf(code),
      sourceUrl: page.url,
    };
    const existing = byCode.get(course.code);
    if (!existing) byCode.set(course.code, course);
    else if (course.description.length > existing.description.length) byCode.set(course.code, course);
  }
  return [...byCode.values()];
};

registerReader('sjtu-cn', readSjtuCourses);
