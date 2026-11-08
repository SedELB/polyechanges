import * as cheerio from 'cheerio';
import type { HostCourseInput, HostTerm } from '../../shared/types.js';
import { registerReader, type Reader } from '../collect/readers.js';

function termOf(url: string): HostTerm {
  const semester = new URL(url).searchParams.get('semester');
  const match = semester?.match(/^\d+-([12])$/);
  if (!match) throw new Error(`Trimestre introuvable dans l'adresse ${url}`);
  return match[1] === '1' ? 'fall' : 'spring';
}

function clean(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/** Texte d'une cellule, les <br> devenant des sauts de ligne. */
function cellText($: cheerio.CheerioAPI, cell: cheerio.Cheerio<any>): string {
  const copy = cell.clone();
  copy.find('br').replaceWith('\n');
  copy.find('p').each((_, p) => {
    $(p).append('\n');
  });
  return clean(copy.text());
}

/** Valeur de la cellule qui suit celle dont le libellé est `label`. */
function field($: cheerio.CheerioAPI, label: string): string {
  const labelCell = $('td')
    .filter((_, el) => $(el).children('div').length > 0 && clean($(el).text()) === label)
    .first();
  return cellText($, labelCell.next('td'));
}

function progress($: cheerio.CheerioAPI): string | null {
  const topics: string[] = [];
  $('td')
    .filter((_, el) => /^Week \d+$/.test(clean($(el).text())))
    .each((_, el) => {
      const topic = cellText($, $(el).closest('tr').children('td').last()).replace(/\n/g, '; ');
      if (topic) topics.push(`${clean($(el).text())} : ${topic}`);
    });
  return topics.length > 0 ? topics.join('\n') : null;
}

function levelOf(code: string): 'undergrad' | 'grad' {
  const digit = code.match(/\d/)?.[0];
  return digit !== undefined && Number(digit) >= 5 ? 'grad' : 'undergrad';
}

/**
 * Lecteur des fiches de cours (syllabus) de NTU. Chaque page est la fiche d'un cours pour un trimestre ;
 * le trimestre vient du paramètre `semester` de l'adresse (X-1 : automne, X-2 : printemps).
 * Les adresses viennent de la liste officielle « Courses conducted in English » (voir ntu-tw.discover.ts) :
 * tous les cours lus sont donc donnés en anglais. Un même code présent à deux trimestres est fusionné.
 */
export const readNtuSyllabi: Reader = (pages) => {
  const byCode = new Map<string, HostCourseInput>();
  for (const page of pages) {
    const term = termOf(page.url);
    const $ = cheerio.load(page.body.toString('utf8'));
    const code = field($, 'Curriculum Number').replace(/\s+/g, '');
    const title = field($, 'Course title');
    if (!code || !title) throw new Error(`Fiche de cours illisible : ${page.url}`);
    const rawDescription = field($, 'Course Description');
    const objective = field($, 'Course Objective');
    const description =
      rawDescription.length >= 80 || !objective ? rawDescription : [rawDescription, objective].filter(Boolean).join('\n\n');
    const existing = byCode.get(code);
    if (existing) {
      if (!existing.terms.includes(term)) existing.terms.push(term);
      // Le même cours vu à un autre trimestre : on garde la description la plus complète, avec sa page.
      if (description.length > existing.description.length) {
        existing.description = description;
        existing.outline = progress($);
        existing.sourceUrl = page.url;
      }
      continue;
    }
    const creditsRaw = Number(field($, 'Credits'));
    byCode.set(code, {
      code,
      title,
      description,
      outline: progress($),
      credits: Number.isFinite(creditsRaw) && creditsRaw > 0 ? creditsRaw : null,
      contactHours: null,
      language: 'en',
      terms: [term],
      level: levelOf(code),
      sourceUrl: page.url,
    });
  }
  for (const course of byCode.values()) course.terms.sort((a, b) => (a === b ? 0 : a === 'fall' ? -1 : 1));
  return [...byCode.values()];
};

registerReader('ntu-tw', readNtuSyllabi);
