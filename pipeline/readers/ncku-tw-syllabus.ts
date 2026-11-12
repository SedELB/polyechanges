import * as cheerio from 'cheerio';
import type { HostCourseInput, HostTerm, Language } from '../../shared/types.js';
import { registerReader, type Reader } from '../collect/readers.js';
import { levelOf } from './ncku-tw.js';

const CJK = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;

function squash(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

/** Lignes d'un bloc, les <br> et les éléments de liste devenant des sauts de ligne, sans les lignes écrites en chinois. */
function englishLines($: cheerio.CheerioAPI, nodes: cheerio.Cheerio<any>): string[] {
  const holder = $('<div></div>').append(nodes.clone());
  holder.find('br').replaceWith('\n');
  holder.find('li, p, div').each((_, el) => {
    $(el).append('\n');
  });
  return holder
    .text()
    .split('\n')
    .map(squash)
    .filter((line) => line !== '' && !CJK.test(line));
}

/** Contenu d'un bloc `<div class="block">` sans son titre, repéré par un mot de son titre. */
function blockLines($: cheerio.CheerioAPI, heading: string): string[] {
  const block = $('div.block')
    .filter((_, el) => $(el).children('h2').first().text().includes(heading))
    .first();
  return englishLines($, block.contents().not('h2'));
}

/** Plan hebdomadaire (« Progress Description »), une ligne par semaine renseignée en anglais, ou null. */
function weeklyPlan($: cheerio.CheerioAPI): string | null {
  const weeks: string[] = [];
  $('td[id^="wk"]').each((_, td) => {
    const topic = englishLines($, $(td).contents()).join('; ');
    const week = squash($(td).prev('td').text());
    if (topic && /^\d+$/.test(week)) weeks.push(`Week ${week} : ${topic}`);
  });
  return weeks.length > 0 ? weeks.join('\n') : null;
}

function field(sidebar: string, label: string): string {
  const match = sidebar.match(new RegExp(`${label}[^\n]*?:[ \t]*([^\n]*)`));
  return match?.[1] ? squash(match[1]) : '';
}

function termOf(semester: string, url: string): HostTerm {
  if (semester === '1') return 'fall';
  if (semester === '2') return 'spring';
  throw new Error(`Semestre inconnu (« ${semester} ») dans ${url}`);
}

/**
 * Lecteur des plans de cours (class-qry.acad.ncku.edu.tw) des cours de la liste de NCKU. Source `enrich` : sert la
 * description. La langue du plan sert de contrôle : « English » donne `en` ; toute autre langue donne `unknown`, ce qui
 * laisse la langue de la liste officielle l'emporter. Plusieurs plans d'un même numéro de cours (sections) : le plus long.
 */
export const readNckuSyllabi: Reader = (pages) => {
  const byCode = new Map<string, HostCourseInput>();
  for (const page of pages) {
    const $ = cheerio.load(page.body.toString('utf8'));
    const sidebarEl = $('div.basic_data').first().clone();
    sidebarEl.find('br').replaceWith('\n');
    const sidebar = sidebarEl.text().replace(/\u00a0/g, ' ');
    const code = field(sidebar, 'Course System Number');
    const headerEl = $('#header h1 span').last().clone();
    headerEl.find('font').remove();
    headerEl.find('br').replaceWith('\n');
    const titleLines = headerEl.text().split('\n').map(squash).filter(Boolean);
    const title = titleLines.filter((l) => !CJK.test(l)).pop() ?? '';
    if (!code || !title) throw new Error(`Plan de cours illisible : ${page.url}`);
    // « Medium of Instruction » : la valeur est sur les lignes qui suivent le libellé.
    const medium = sidebar.match(/Medium of Instruction:([\s\S]*)$/)?.[1] ?? '';
    const language: Language = /\bEnglish\b/.test(medium) ? 'en' : 'unknown';
    const creditsRaw = Number(field(sidebar, 'No\. of Credits'));
    const term = termOf(field(sidebar, 'Semester'), page.url);
    const content = blockLines($, 'Course Description').join('\n');
    const objectives = blockLines($, 'Course Objectives').join('\n');
    const description = content.length >= 80 || !objectives ? content : [objectives, content].filter(Boolean).join('\n\n');
    const attribute = field(sidebar, 'Attribute Code');
    const course: HostCourseInput = {
      code,
      title,
      description,
      outline: weeklyPlan($),
      credits: Number.isFinite(creditsRaw) && creditsRaw > 0 ? creditsRaw : null,
      contactHours: null,
      language,
      terms: [term],
      level: levelOf(attribute),
      sourceUrl: page.url,
    };
    const existing = byCode.get(code);
    if (!existing) {
      byCode.set(code, course);
      continue;
    }
    if (!existing.terms.includes(term)) existing.terms.push(term);
    if (existing.language !== 'en' && language === 'en') existing.language = 'en';
    if (description.length > existing.description.length) {
      existing.description = description;
      existing.outline = course.outline;
      existing.sourceUrl = page.url;
    }
  }
  return [...byCode.values()];
};

registerReader('ncku-tw-syllabus', readNckuSyllabi);
