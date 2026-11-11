// Construit data/manual/tongji-cn.json à partir des listes officielles des cours en anglais ouverts aux étudiants
// d'échange de Tongji : les PDF par semestre du College of Electronic and Information Engineering (1er cycle et
// cycles supérieurs, automne 2026 et printemps 2026) et les pages du bureau des affaires internationales pour
// l'école d'informatique et l'école de mathématiques. Seuls les cours dont la langue est « English » sont retenus
// (les cours « Bilingual » se donnent en chinois). Ces listes ne donnent aucune description de cours.
// À lancer à la main : npx tsx pipeline/readers/tongji-cn.build.ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HostCourseInput, HostTerm, Provenance } from '../../shared/types.js';
import { createPoliteFetcher, type PoliteFetcher } from '../fetch/politeFetch.js';
import { MAX_QUOTE_LINES, normalizeText, snapshotText } from '../provenance/snapshotText.js';

type Level = 'undergrad' | 'grad';

const CEIE = 'https://see-en.tongji.edu.cn/__local';
const FAO = 'https://fao.tongji.edu.cn/info/1129';

export const PDF_LISTS: readonly { url: string; term: HostTerm; level: Level }[] = [
  { url: `${CEIE}/F/1D/76/C3C4D756AFA23349D638AE19CFE_F6794858_28E7B.pdf`, term: 'fall', level: 'undergrad' },
  { url: `${CEIE}/F/5F/18/AB54065FDFFE88A81EA83C6EDA9_1FC9C938_23755.pdf`, term: 'fall', level: 'grad' },
  { url: `${CEIE}/6/85/00/143FD94FB04FEEF86AF679E911B_A25BB381_209AC.pdf`, term: 'spring', level: 'undergrad' },
  { url: `${CEIE}/0/A6/A1/C9B3BF97592A5D84C9FBF45FE59_D165176C_26E68.pdf`, term: 'spring', level: 'grad' },
];
export const HTML_LISTS: readonly string[] = [`${FAO}/7974.htm`, `${FAO}/7971.htm`];

export interface ListedCourse {
  code: string;
  title: string;
  credits: number | null;
  language: string;
  terms: HostTerm[];
  level: Level;
  page: number;
  line: number;
  /** Rangée entière du tableau (jusqu'à 3 lignes du texte extrait, jointes par une espace). */
  quote: string;
}

/** Les codes déformés par un tableur (« 5.00024E+12 ») ne sont pas des codes de cours utilisables. */
function isUsableCode(code: string): boolean {
  return !/E\+\d+$/i.test(code);
}

/** Informatique, génie électrique et informatique, mathématiques : tout sauf la mécanique. */
export function isInScope(title: string): boolean {
  return !/machinery/i.test(title);
}

const RECORD_START = /^\d{4}-\d{4} [12] /;
const LIST_FOOTER = /English Course List|^\* ?Bilingual/;
const ROW =
  /^\d{4}-\d{4} [12] (\S+) ((?:[^A-Za-z\s]+ )+)(.+?) (?:(?:Compulsory|Elective|Fundamental|Practice|General) )?(\d+) (\d+) (English|Bilingual)(?: |$)/;

/** Rangées d'une liste PDF du College of Electronic and Information Engineering (une rangée = 1 à 3 lignes). */
export function parsePdfList(pages: string[][], term: HostTerm, level: Level): ListedCourse[] {
  const out: ListedCourse[] = [];
  pages.forEach((lines, p) => {
    for (let l = 0; l < lines.length; l++) {
      if (!RECORD_START.test(lines[l]!)) continue;
      let end = l + 1;
      while (end < lines.length && !RECORD_START.test(lines[end]!) && !LIST_FOOTER.test(lines[end]!)) end++;
      if (end - l > MAX_QUOTE_LINES) throw new Error(`Rangée trop longue à p${p + 1}:l${l + 1}`);
      const quote = normalizeText(lines.slice(l, end).join(' '));
      const m = quote.match(ROW);
      if (!m) throw new Error(`Rangée illisible à p${p + 1}:l${l + 1} : ${quote}`);
      if (!isUsableCode(m[1]!)) continue;
      out.push({
        code: m[1]!,
        title: normalizeText(m[3]!.replace(/\(English\)\s*$/, '')),
        credits: Number(m[5]),
        language: m[6]!,
        terms: [term],
        level,
        page: p + 1,
        line: l + 1,
        quote,
      });
    }
  });
  return out;
}

const TERM_OF: Record<string, HostTerm> = { spring: 'spring', fall: 'fall' };

/** Tableaux « Course Code | Course Name | … » des pages HTML : le niveau vient du titre de section ou d'une colonne. */
export function parseHtmlTable(pages: string[][]): ListedCourse[] {
  const out: ListedCourse[] = [];
  pages.forEach((lines, p) => {
    let level: Level | null = null;
    let columns: string[] = [];
    lines.forEach((raw, l) => {
      const line = normalizeText(raw);
      const section = line.match(/^Courses at (Bachelor|Master) Level/i);
      if (section) level = section[1]!.toLowerCase() === 'bachelor' ? 'undergrad' : 'grad';
      if (line.startsWith('Course Code |')) {
        columns = line.split(' | ').map((c) => c.trim());
        return;
      }
      const cells = line.split(' | ').map((c) => c.trim());
      if (columns.length === 0 || cells.length !== columns.length || !isUsableCode(cells[0]!)) return;
      const cell = (name: string) => cells[columns.indexOf(name)];
      const rowLevel = cell('Level');
      const lvl: Level | null = rowLevel ? (rowLevel.toLowerCase() === 'bachelor' ? 'undergrad' : 'grad') : level;
      if (!lvl) throw new Error(`Niveau inconnu à p${p + 1}:l${l + 1}`);
      const credit = cell('Credit');
      const term = TERM_OF[(cell('Semester') ?? '').toLowerCase()];
      out.push({
        code: cells[0]!,
        title: cell('Course Name')!,
        credits: credit === undefined ? null : Number(credit),
        language: cell('Language')!,
        terms: term ? [term] : [],
        level: lvl,
        page: p + 1,
        line: l + 1,
        quote: line,
      });
    });
  });
  return out;
}

/** Un cours par code, en anglais et dans le périmètre : trimestres fusionnés (automne avant printemps), première rangée gardée. */
export function mergeListed(listed: ListedCourse[]): ListedCourse[] {
  const byCode = new Map<string, ListedCourse>();
  for (const c of listed) {
    if (c.language !== 'English' || !isInScope(c.title)) continue;
    const existing = byCode.get(c.code);
    if (!existing) byCode.set(c.code, { ...c, terms: [...c.terms] });
    else for (const t of c.terms) if (!existing.terms.includes(t)) existing.terms.push(t);
  }
  for (const m of byCode.values()) m.terms.sort((a, b) => (a === b ? 0 : a === 'fall' ? -1 : 1));
  return [...byCode.values()];
}

export function toCourse(
  c: ListedCourse,
  url: string,
  sha256: string,
  retrievedAt: string,
): HostCourseInput & { provenance: Provenance } {
  return {
    code: c.code,
    title: c.title,
    description: '',
    outline: null,
    credits: c.credits,
    contactHours: null,
    language: 'en',
    terms: c.terms,
    level: c.level,
    sourceUrl: url,
    provenance: { url, retrievedAt, sha256, locator: { page: c.page, line: c.line }, quote: c.quote },
  };
}

function store(rawDir: string, body: Buffer, ext: string): string {
  const sha = createHash('sha256').update(body).digest('hex');
  const full = join(rawDir, 'tongji-cn', `${sha}.${ext}`);
  if (!existsSync(full)) {
    mkdirSync(join(rawDir, 'tongji-cn'), { recursive: true });
    writeFileSync(full, body);
  }
  return sha;
}

export async function build(fetcher: PoliteFetcher, rawDir: string): Promise<HostCourseInput[]> {
  const retrievedAt = new Date().toISOString();
  const rows: { c: ListedCourse; url: string; sha: string }[] = [];
  const add = (list: ListedCourse[], url: string, sha: string) => {
    console.log(`${url} : ${list.length} rangées`);
    for (const c of list) rows.push({ c, url, sha });
  };
  for (const { url, term, level } of PDF_LISTS) {
    const res = await fetcher.get(url);
    const sha = store(rawDir, res.body, 'pdf');
    add(parsePdfList(await snapshotText(res.body, 'application/pdf'), term, level), url, sha);
  }
  for (const url of HTML_LISTS) {
    const res = await fetcher.get(url);
    const sha = store(rawDir, res.body, 'html');
    add(parseHtmlTable(await snapshotText(res.body, 'text/html')), url, sha);
  }
  const courses: HostCourseInput[] = [];
  for (const m of mergeListed(rows.map((r) => r.c))) {
    const r = rows.find((x) => x.c.code === m.code && x.c.page === m.page && x.c.line === m.line && x.c.quote === m.quote)!;
    courses.push(toCourse(m, r.url, r.sha, retrievedAt));
  }
  return courses;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const courses = await build(createPoliteFetcher(), join('data', 'raw'));
  mkdirSync(join('data', 'manual'), { recursive: true });
  writeFileSync(join('data', 'manual', 'tongji-cn.json'), JSON.stringify(courses, null, 2) + '\n');
  console.log(`${courses.length} cours écrits dans data/manual/tongji-cn.json`);
}
