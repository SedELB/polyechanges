import * as cheerio from 'cheerio';
import type { HostCourseInput, HostTerm } from '../../shared/types.js';
import { registerReader, type Reader } from '../collect/readers.js';

const JAPANESE = /[぀-ヿ㐀-鿿＀-￯]/;

/** Texte d'une cellule : un segment par ligne ou par cellule imbriquée, sans les segments en japonais. */
function englishText($: cheerio.CheerioAPI, cell: cheerio.Cheerio<any>): string {
  const copy = cell.clone();
  copy.find('br').replaceWith('\n');
  const nested = copy.find('td').filter((_, td) => $(td).find('td').length === 0);
  const blocks = nested.length > 0 ? nested.map((_, td) => $(td).text()).get() : [copy.text()];
  return blocks
    .flatMap((block) => block.split('\n'))
    .map((line) => line.replace(/ /g, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0 && !JAPANESE.test(line))
    .join('\n');
}

interface Row {
  label: string;
  cell: cheerio.Cheerio<any>;
}

function rows($: cheerio.CheerioAPI): Row[] {
  return $('td.line_y_label')
    .map((_, sep) => ({ label: $(sep).prev('td').text().replace(/\s+/g, ' ').trim(), cell: $(sep).next('td') }))
    .get();
}

/** Première ligne dont l'intitulé correspond, hors versions en japonais. */
function find(all: Row[], pattern: RegExp): Row | undefined {
  return all.find((r) => pattern.test(r.label) && !/日本語|\(JPN\)/.test(r.label));
}

function termsOf(text: string, url: string): HostTerm[] {
  const terms: HostTerm[] = [];
  if (/Fall/.test(text)) terms.push('fall');
  if (/Spring/.test(text)) terms.push('spring');
  if (terms.length === 0) throw new Error(`Trimestre introuvable dans la fiche ${url}`);
  return terms;
}

/** Une faculté (« 学部 », « 工学部 ») : 1er cycle ; « 情報・博前 », « 多・博前 »... : cycles supérieurs. */
function levelOf(text: string, url: string): 'undergrad' | 'grad' {
  if (/学部$/.test(text)) return 'undergrad';
  if (/博|修|研究科|大学院/.test(text)) return 'grad';
  throw new Error(`Niveau introuvable (« ${text} ») dans la fiche ${url}`);
}

/**
 * Lecteur des fiches de cours (syllabus) de l'Université de Nagoya. Chaque page est la fiche d'un cours de l'année 2026.
 * Les adresses viennent de la liste officielle du programme d'échange NUPACE (voir nagoya-jp.discover.ts) :
 * tous les cours lus sont donc donnés en anglais. Le code est le code d'inscription de la fiche (« Registration Code »).
 */
export const readNagoyaSyllabi: Reader = (pages) => {
  const byCode = new Map<string, HostCourseInput>();
  for (const page of pages) {
    const $ = cheerio.load(page.body.toString('utf8'));
    const all = rows($);
    const text = (pattern: RegExp): string => {
      const row = find(all, pattern);
      return row ? englishText($, row.cell) : '';
    };
    const code = text(/Registration Code/).replace(/\s+/g, '');
    const title = text(/Course Title/).replace(/^(\[[^\]]*\]\s*)+/, '');
    if (!code || !title) throw new Error(`Fiche de cours illisible : ${page.url}`);
    const termRow = find(all, /Term \/ Day \/ Period/);
    const levelRow = find(all, /Undergraduate \/ Graduate/);
    if (!termRow || !levelRow) throw new Error(`Fiche de cours illisible : ${page.url}`);
    const terms = termsOf(termRow.cell.text(), page.url);
    const existing = byCode.get(code);
    if (existing) {
      for (const t of terms) if (!existing.terms.includes(t)) existing.terms.push(t);
      continue;
    }
    const goals = text(/Goals of the Course/);
    const content = text(/Course Content/);
    const objectives = text(/Objectives of the Course/);
    const description = [goals, content].filter(Boolean).join('\n\n') || objectives;
    const credits = Number(text(/Credits$/));
    byCode.set(code, {
      code,
      title,
      description,
      outline: null,
      credits: Number.isFinite(credits) && credits > 0 ? credits : null,
      contactHours: null,
      language: 'en',
      terms: terms.sort((a, b) => (a === b ? 0 : a === 'fall' ? -1 : 1)),
      level: levelOf(levelRow.cell.text().replace(/\s+/g, ''), page.url),
      sourceUrl: page.url,
    });
  }
  return [...byCode.values()];
};

registerReader('nagoya-jp', readNagoyaSyllabi);
