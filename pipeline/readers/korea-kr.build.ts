// Construit data/manual/korea-kr.json à partir des listes de cours que le bureau des échanges de Korea University
// publie en classeurs Excel (avis « Course Catalog » de l'automne 2026 et « Course List » du printemps 2026).
// Un classeur n'est pas une page lisible par le moteur de collecte : ce script télécharge poliment les classeurs,
// range chacun comme copie brute, range aussi chaque feuille lue sous forme de tableau (une rangée par ligne,
// c'est ce texte que les extraits citent) et écrit la saisie manuelle.
// À lancer à la main : npx tsx pipeline/readers/korea-kr.build.ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HostCourseInput, HostTerm, Provenance } from '../../shared/types.js';
import { createPoliteFetcher, type PoliteFetcher } from '../fetch/politeFetch.js';
import { findQuote, normalizeText, snapshotText } from '../provenance/snapshotText.js';
import { readXlsx, type Sheet } from './xlsx.js';

const NOTICES = 'https://gsc.korea.ac.kr/gsc/ExchangeVisitingProgram/Notice/Notice.do';
const download = (article: number, attach: number): string =>
  `${NOTICES}?mode=download&articleNo=${article}&attachNo=${attach}&totalNoticeYn=&totalBoardNo=`;
const view = (article: number): string => `${NOTICES}?mode=view&articleNo=${article}&article.offset=0&articleLimit=10`;

interface Workbook {
  /** Adresse de téléchargement du classeur. */
  url: string;
  /** Page de l'avis qui le porte. */
  page: string;
  term: HostTerm;
  /** Feuille à lire pour chaque niveau (par nom ; la première feuille si le classeur n'en a qu'une). */
  sheets: { level: 'undergrad' | 'grad'; name: string | null }[];
}

/** Dernier automne (2026-2) et dernier printemps (2026-1) publiés. */
export const WORKBOOKS: readonly Workbook[] = [
  { url: download(1587482, 324852), page: view(1587482), term: 'fall', sheets: [{ level: 'undergrad', name: null }] },
  { url: download(1587482, 324855), page: view(1587482), term: 'fall', sheets: [{ level: 'grad', name: null }] },
  {
    url: download(811985, 316930),
    page: view(811985),
    term: 'spring',
    sheets: [
      { level: 'undergrad', name: 'Undergrad_2026 Spring' },
      { level: 'grad', name: 'Grad_2026 Spring' },
    ],
  },
];

/**
 * Préfixes de code : informatique (COSE), génie électrique et électronique (KECE), mathématiques (MATH),
 * semi-conducteurs (SEMI) et intelligence artificielle (CSAI) au 1er cycle ; informatique (AAA), génie
 * électrique (ECE), mathématiques (MTH) et intelligence artificielle (XAI) aux cycles supérieurs.
 */
const PREFIXES: Record<'undergrad' | 'grad', RegExp> = {
  undergrad: /^(COSE|KECE|MATH|SEMI|CSAI)\d/,
  grad: /^(AAA|ECE|MTH|XAI)\d/,
};

const HEADERS = {
  code: ['학수번호', 'Course Code'],
  section: ['분반', 'Section'],
  title: ['교과목명(영문)', 'Course Title (ENG)'],
  korean: ['교과목명', 'Course Title (KOR)'],
  credits: ['학점', 'Credits'],
  english: ['영어강의'],
};

export interface ListedRow {
  code: string;
  section: string;
  title: string;
  korean: string;
  credits: number | null;
  level: 'undergrad' | 'grad';
  term: HostTerm;
  /** Rangée entière du tableau (« cellule | cellule »), telle qu'elle apparaît dans le texte extrait. */
  quote: string;
  /** Numéro (1-based) de la rangée dans le texte extrait de la feuille. */
  line: number;
}

export function readSheets(buf: Buffer): Sheet[] {
  return readXlsx(buf);
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Cellules non vides d'une rangée, normalisées comme le fait l'extraction de texte. */
function cellsOf(row: (string | undefined)[]): string[] {
  return Array.from(row, (c) => normalizeText(c ?? '')).filter((c) => c !== '');
}

/** La feuille en tableau HTML : une rangée non vide par ligne du texte extrait. */
export function sheetHtml(sheet: Sheet): string {
  const rows = sheet.rows
    .map(cellsOf)
    .filter((cells) => cells.length > 0)
    .map((cells) => `<tr>${cells.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(sheet.name)}</title></head><body><table>\n${rows.join('\n')}\n</table></body></html>\n`;
}

function columnOf(header: (string | undefined)[], names: string[]): number {
  return header.findIndex((h) => h !== undefined && names.includes(normalizeText(h)));
}

/** Cours en anglais des départements visés d'une feuille, une entrée par section. */
export function listRows(sheet: Sheet, level: 'undergrad' | 'grad', term: HostTerm): ListedRow[] {
  const header = sheet.rows[0] ?? [];
  const col = Object.fromEntries(Object.entries(HEADERS).map(([k, names]) => [k, columnOf(header, names)])) as Record<
    keyof typeof HEADERS,
    number
  >;
  if (col.code < 0 || col.title < 0 || col.credits < 0) throw new Error(`En-têtes inattendus dans la feuille ${sheet.name}`);
  const rows: ListedRow[] = [];
  let line = 0;
  for (const row of sheet.rows) {
    const cells = cellsOf(row);
    if (cells.length === 0) continue;
    line++;
    const code = normalizeText(row[col.code] ?? '');
    if (!PREFIXES[level].test(code)) continue;
    const rawTitle = normalizeText(row[col.title] ?? '');
    // La liste d'automne marque les cours en anglais dans une colonne ; celle du printemps ne liste que
    // des cours dont le titre porte « (English) » pour les départements visés.
    const english = col.english >= 0 ? normalizeText(row[col.english] ?? '') !== '' : /\(English\)$/.test(rawTitle);
    if (!english) continue;
    const credits = Number(row[col.credits]);
    rows.push({
      code,
      section: col.section >= 0 ? normalizeText(row[col.section] ?? '') : '',
      title: rawTitle.replace(/\s*\(English\)$/, ''),
      korean: normalizeText(row[col.korean] ?? '').replace(/\s*\(영강\)$/, ''),
      credits: Number.isFinite(credits) && credits > 0 ? credits : null,
      level,
      term,
      quote: cells.join(' | '),
      line,
    });
  }
  return rows;
}

export interface Merged {
  code: string;
  title: string;
  korean: string;
  credits: number | null;
  level: 'undergrad' | 'grad';
  terms: HostTerm[];
  /** Première section rencontrée, de l'automne d'abord : elle donne la position du cours. */
  best: ListedRow;
}

/** Un cours par code : sections et trimestres fusionnés. */
export function mergeRows(rows: ListedRow[]): Merged[] {
  const byCode = new Map<string, Merged>();
  const ordered = [...rows].sort((a, b) => (a.term === b.term ? 0 : a.term === 'fall' ? -1 : 1));
  for (const r of ordered) {
    const existing = byCode.get(r.code);
    if (!existing) {
      byCode.set(r.code, { code: r.code, title: r.title, korean: r.korean, credits: r.credits, level: r.level, terms: [r.term], best: r });
    } else if (!existing.terms.includes(r.term)) {
      existing.terms.push(r.term);
    }
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export interface TermSource {
  /** Adresse de téléchargement du classeur. */
  url: string;
  /** Empreinte de la feuille rangée comme copie brute (tableau). */
  sha256: string;
  /** Adresse de l'avis qui porte le classeur. */
  page: string;
}

/**
 * Les listes ne donnent ni description ni plan de cours : la description reprend les deux titres officiels
 * (anglais et coréen), sans rien ajouter.
 */
export function toCourse(
  m: Merged,
  sources: Partial<Record<HostTerm, TermSource>>,
  retrievedAt: string,
): HostCourseInput & { provenance: Provenance } {
  const source = sources[m.best.term];
  if (!source) throw new Error(`Aucune source pour ${m.code}`);
  return {
    code: m.code,
    title: m.title,
    description: m.korean ? `${m.title} (${m.korean})` : m.title,
    outline: null,
    credits: m.credits,
    contactHours: null,
    language: 'en',
    terms: m.terms,
    level: m.level,
    sourceUrl: source.page,
    provenance: { url: source.url, retrievedAt, sha256: source.sha256, locator: { page: 1, line: m.best.line }, quote: m.best.quote },
  };
}

function store(rawDir: string, body: Buffer, ext: string): string {
  const sha = createHash('sha256').update(body).digest('hex');
  const full = join(rawDir, 'korea-kr', `${sha}.${ext}`);
  if (!existsSync(full)) {
    mkdirSync(join(rawDir, 'korea-kr'), { recursive: true });
    writeFileSync(full, body);
  }
  return sha;
}

export async function build(fetcher: PoliteFetcher, rawDir: string): Promise<HostCourseInput[]> {
  const retrievedAt = new Date().toISOString();
  const rows: ListedRow[] = [];
  const sourceOf = new Map<ListedRow, TermSource>();
  for (const wb of WORKBOOKS) {
    const res = await fetcher.get(wb.url);
    store(rawDir, res.body, 'xlsx');
    const sheets = readXlsx(res.body);
    for (const { level, name } of wb.sheets) {
      const sheet = name === null ? sheets[0] : sheets.find((s) => s.name === name);
      if (!sheet) throw new Error(`Feuille absente : ${name ?? '(première)'} dans ${wb.url}`);
      const html = Buffer.from(sheetHtml(sheet));
      const sha = store(rawDir, html, 'html');
      const pages = await snapshotText(html, 'text/html');
      const listed = listRows(sheet, level, wb.term);
      for (const r of listed) {
        if (!findQuote(pages, r.quote).some((h) => h.line === r.line)) throw new Error(`Rangée introuvable dans le tableau : ${r.quote}`);
        sourceOf.set(r, { url: wb.url, sha256: sha, page: wb.page });
      }
      console.log(`${wb.term} ${level} : ${listed.length} sections en anglais`);
      rows.push(...listed);
    }
  }
  return mergeRows(rows).map((m) => toCourse(m, { [m.best.term]: sourceOf.get(m.best)! }, retrievedAt));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const courses = await build(createPoliteFetcher(), join('data', 'raw'));
  mkdirSync(join('data', 'manual'), { recursive: true });
  writeFileSync(join('data', 'manual', 'korea-kr.json'), JSON.stringify(courses, null, 2) + '\n');
  console.log(`${courses.length} cours écrits dans data/manual/korea-kr.json`);
}
