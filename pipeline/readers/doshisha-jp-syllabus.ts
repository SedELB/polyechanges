import type { HostCourseInput, Language } from '../../shared/types.js';
import { registerReader, type AsyncReader } from '../collect/readers.js';
import { snapshotText } from '../provenance/snapshotText.js';

/** Première ligne d'une fiche : « 31691010 △Ａｄｖ… » ou « 99200024-001 ○Statistics… » (code, classe facultative). */
const CODE_LINE = /^(\d{8})(?:-(\d{3}))?\s/;
/** Ligne des crédits : « 2単位/Unit 秋学期/Fall 京⽥辺/Kyotanabe 講義/Lecture ». */
const CREDITS_LINE = /^(\d+(?:\.\d+)?)単位\/Unit/;
/** Intitulé de rubrique : « ＜概要/Course Content Summary＞ ». */
const HEADING = /^＜(.*)/;
const TAUGHT_IN_ENGLISH = /\b(?:taught|conducted|given|delivered)\s+in\s+English\b/i;

/** Colle des lignes d'un paragraphe ; une puce ou un numéro de liste commence une nouvelle ligne. */
function joinLines(lines: string[]): string {
  let text = '';
  for (const line of lines) {
    if (text === '') text = line;
    else if (/^(?:[-‧•·]\s|\d+[.)]\s)/.test(line)) text += `\n${line}`;
    else if (/[A-Za-z]-$/.test(text) && /^[a-z]/.test(line)) text += line;
    else text += ` ${line}`;
  }
  return text.trim();
}

export interface SyllabusSheet {
  code: string;
  /** Numéro de classe de l'en-tête (« 001 » pour 99200024-001), sinon null. */
  classCode: string | null;
  title: string;
  credits: number | null;
  /** Résumé, puis objectifs (lignes de la fiche, en anglais). */
  description: string;
  language: Language;
}

/** Lit une fiche de syllabus de Doshisha (texte extrait du PDF : pages, puis lignes). Null si l'en-tête est illisible. */
export function parseSyllabus(pages: string[][]): SyllabusSheet | null {
  const lines = pages.flat();
  const head = lines.findIndex((l) => CODE_LINE.test(l));
  if (head < 0) return null;
  const [, code, classCode] = lines[head].match(CODE_LINE)!;
  const creditsAt = lines.findIndex((l, i) => i > head && CREDITS_LINE.test(l));
  if (creditsAt < 1) return null;
  const title = lines[creditsAt - 1].replace(/\s*\(E\)$/, '').trim();
  const credits = Number(lines[creditsAt].match(CREDITS_LINE)![1]);

  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of lines.slice(creditsAt + 1)) {
    const heading = line.match(HEADING);
    if (heading) {
      const name = /Course Content Summary/.test(heading[1]) ? 'summary' : /Goals,Aims/.test(heading[1]) ? 'goals' : '';
      current = name === '' || sections.has(name) ? null : (sections.set(name, []), sections.get(name)!);
      if (/Schedule/.test(heading[1])) break;
      continue;
    }
    current?.push(line);
  }
  const description = [sections.get('summary'), sections.get('goals')]
    .filter((s): s is string[] => !!s && s.length > 0)
    .map(joinLines)
    .join('\n\n');
  const language: Language = lines.some((l, i) => TAUGHT_IN_ENGLISH.test(`${l} ${lines[i + 1] ?? ''}`)) ? 'en' : 'unknown';
  return { code: code!, classCode: classCode ?? null, title, credits: credits > 0 ? credits : null, description, language };
}

/** Code de cours à 8 chiffres au bout de l'adresse d'une fiche : « …/31691010000.html » ou « …/99200024001.html ». */
function codeOfUrl(url: string): string | null {
  return url.match(/\/(\d{8})\d{3}\.html$/)?.[1] ?? null;
}

/**
 * Lecteur des fiches de syllabus enregistrées de Doshisha (source `enrich`) : description (résumé et objectifs, en
 * anglais), crédits et, seulement quand la fiche l'écrit (« taught in English »), la langue. Pas de trimestre : la
 * liste officielle fait foi. Une fiche dont le code ne correspond pas à son adresse est refusée.
 */
export const readDoshishaSyllabi: AsyncReader = async (pages) => {
  const courses: HostCourseInput[] = [];
  for (const page of pages) {
    const sheet = parseSyllabus(await snapshotText(page.body, page.contentType));
    if (!sheet) throw new Error(`Fiche de syllabus illisible : ${page.url}`);
    const expected = codeOfUrl(page.url);
    if (expected !== null && expected !== sheet.code) {
      throw new Error(`La fiche ${page.url} porte le code ${sheet.code}, pas ${expected}`);
    }
    courses.push({
      code: sheet.code,
      title: sheet.title,
      description: sheet.description,
      outline: null,
      credits: sheet.credits,
      contactHours: null,
      language: sheet.language,
      terms: [],
      level: 'undergrad',
      sourceUrl: page.url,
    });
  }
  return courses;
};

registerReader('doshisha-jp-syllabus', readDoshishaSyllabi);
