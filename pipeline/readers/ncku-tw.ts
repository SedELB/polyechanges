import * as cheerio from 'cheerio';
import type { HostCourseInput, HostTerm } from '../../shared/types.js';
import { registerReader, type Reader } from '../collect/readers.js';

/** Une rangée de la liste des cours de course.ncku.edu.tw (Advanced Search). */
export interface NckuRow {
  /** Numéro de cours système, par exemple `F720401`. */
  code: string;
  /** Classe (section), vide quand le cours n'en a qu'une. */
  classCode: string;
  /** Code d'attribut du cours, par exemple `CSIE1003`. */
  attribute: string;
  title: string;
  credits: number | null;
  taughtInEnglish: boolean;
  /** Adresse du lien « Syllabus » de la rangée (absent pour certains cours). */
  syllabusUrl: string | null;
}

/** Préfixes d'attribut retenus : informatique, génie électrique, mathématiques. */
const IN_SCOPE = /^(CSIE|EE|MATH)\d/;
/** Cours de langue (anglais scientifique, etc.) : hors périmètre. */
const LANGUAGE_COURSE = /\b(ENGLISH|CHINESE|JAPANESE|KOREAN|FRENCH|GERMAN|SPANISH)\b/i;

function squash(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Trimestre de la page : « Fall semester of 2026-2027 » (automne) ou « Spring semester of … ». */
export function termOfList(html: string): HostTerm {
  const match = html.match(/\b(Fall|Spring) semester of \d{4}-\d{4}/);
  if (!match) throw new Error('Trimestre introuvable dans la liste (« Fall semester of … » attendu)');
  return match[1] === 'Fall' ? 'fall' : 'spring';
}

/** Les rangées de la table des résultats (la version pour téléphone, plus bas dans la page, est ignorée). */
export function parseRows(html: string): NckuRow[] {
  const $ = cheerio.load(html);
  const rows: NckuRow[] = [];
  $('#A9-table tbody tr').each((_, tr) => {
    const cells = $(tr).children('td');
    if (cells.length < 10) return;
    const codeCell = cells.eq(1).clone();
    codeCell.find('.dept_seq').remove();
    const match = squash(codeCell.text()).match(/^([A-Z0-9]+)(?:-(\w+))?\s*\[([A-Z0-9]*)\]$/);
    if (!match) return;
    const nameCell = cells.eq(4);
    const title = squash(nameCell.find('.course_name').text());
    const credits = Number(squash(cells.eq(5).text()).match(/^\d+(?:\.\d+)?/)?.[0]);
    rows.push({
      code: match[1]!,
      classCode: match[2] ?? '',
      attribute: match[3] ?? '',
      title,
      credits: Number.isFinite(credits) && credits > 0 ? credits : null,
      taughtInEnglish: nameCell.find('.label').toArray().some((l) => squash($(l).text()) === 'Course taught in English'),
      syllabusUrl: cells.eq(9).find('a[href*="syllabus.php"]').attr('href') ?? null,
    });
  });
  return rows;
}

/** Vrai pour un cours donné en anglais, d'informatique, de génie électrique ou de mathématiques, hors cours de langue. */
export function isKept(row: NckuRow): boolean {
  return row.taughtInEnglish && IN_SCOPE.test(row.attribute) && !LANGUAGE_COURSE.test(row.title);
}

/** Les chiffres 5 et plus au début du numéro du code d'attribut (MATH5202) désignent les cycles supérieurs. */
export function levelOf(attribute: string): 'undergrad' | 'grad' {
  const digit = attribute.match(/\d/)?.[0];
  return digit !== undefined && Number(digit) >= 5 ? 'grad' : 'undergrad';
}

/**
 * Lecteur de la liste des cours de NCKU (pages enregistrées de l'Advanced Search). Seules les rangées portant
 * « Course taught in English » sont lues ; les sections d'un même cours (même numéro système) forment une entrée.
 * Les descriptions viennent des plans de cours (ncku-tw-syllabus.ts).
 */
export const readNckuList: Reader = (pages) => {
  const byCode = new Map<string, HostCourseInput>();
  for (const page of pages) {
    const html = page.body.toString('utf8');
    const term = termOfList(html);
    for (const row of parseRows(html)) {
      if (!isKept(row)) continue;
      if (!row.title) throw new Error(`Rangée sans titre : ${row.code} (${page.url})`);
      const existing = byCode.get(row.code);
      if (existing) {
        if (!existing.terms.includes(term)) existing.terms.push(term);
        if (existing.credits === null) existing.credits = row.credits;
        continue;
      }
      byCode.set(row.code, {
        code: row.code,
        title: row.title,
        description: '',
        outline: null,
        credits: row.credits,
        contactHours: null,
        language: 'en',
        terms: [term],
        level: levelOf(row.attribute),
        sourceUrl: page.url,
      });
    }
  }
  return [...byCode.values()];
};

registerReader('ncku-tw', readNckuList);
