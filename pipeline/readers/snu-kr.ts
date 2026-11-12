import type { HostCourseInput, HostTerm } from '../../shared/types.js';
import { registerReader, type Reader } from '../collect/readers.js';
import { decodeText } from '../provenance/snapshotText.js';

/** Départements retenus : informatique, génie électrique et informatique, mathématiques, statistique. */
export type SnuDepartment = 'cse' | 'ece' | 'math' | 'stat';

/** Nom de département (interface anglaise ou coréenne de la recherche de cours) → département retenu. */
const DEPARTMENTS: Record<string, SnuDepartment> = {
  'department of computer science and engineering': 'cse',
  'school of computer science and engineering': 'cse',
  '컴퓨터공학부': 'cse',
  'department of electrical and computer engineering': 'ece',
  'school of electrical and computer engineering': 'ece',
  '전기·정보공학부': 'ece',
  'department of mathematical sciences': 'math',
  'school of mathematical sciences': 'math',
  '수리과학부': 'math',
  'department of statistics': 'stat',
  '통계학과': 'stat',
};

/** Colonnes lues, par leur en-tête en anglais ou en coréen (l'export suit la langue de l'interface au moment du clic). */
const COLUMNS = {
  classification: ['Course Classification', '교과구분'],
  department: ['Department', '개설학과'],
  degree: ['Degree Program', '이수과정'],
  courseNumber: ['Course Number', '교과목번호'],
  lectureNumber: ['Lecture Number', '강좌번호'],
  title: ['Course Title', '교과목명'],
  subtitle: ['Course Subtitle', '부제명'],
  credits: ['Credits', '학점'],
  language: ['Language for the lecture', '강의언어'],
  status: ['Status', '개설상태'],
} as const;

export interface SnuRow {
  classification: string;
  department: string;
  degree: string;
  courseNumber: string;
  lectureNumber: string;
  title: string;
  subtitle: string;
  credits: number | null;
  language: string;
  status: string;
}

/** Texte tabulé (« Texte Unicode » d'Excel) : cellules séparées par une tabulation, entre guillemets quand elles en ont besoin. */
export function parseTabular(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === '\t') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

const clean = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

/** Trimestre de l'export d'après sa ligne de filtres (« Semester : 2nd Semester » ou « 학기 : 2학기 ») : 2e = automne, 1er = printemps. */
export function termOfExport(rows: string[][]): HostTerm {
  for (const row of rows.slice(0, 4)) {
    const match = clean(row[0]).match(/(?:Semester|학기)\s*:\s*[^0-9,]*([12])/);
    if (match) return match[1] === '2' ? 'fall' : 'spring';
  }
  throw new Error('Trimestre introuvable dans l’export (ligne « Semester : … » ou « 학기 : … » attendue)');
}

/** Rangées de l'export (les trois premières lignes sont le titre, les filtres et les en-têtes). */
export function parseExport(body: Buffer): { term: HostTerm; rows: SnuRow[] } {
  const table = parseTabular(decodeText(body));
  const isHeader = (r: string[]) => r.some((c) => (COLUMNS.courseNumber as readonly string[]).includes(clean(c)));
  const headerAt = table.findIndex(isHeader);
  if (headerAt < 0) throw new Error('En-têtes introuvables dans l’export (« Course Number » ou « 교과목번호 » attendu)');
  const header = table[headerAt].map(clean);
  const index = {} as Record<keyof typeof COLUMNS, number>;
  for (const [key, names] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, readonly string[]][]) {
    const at = header.findIndex((h) => names.includes(h));
    if (at < 0) throw new Error(`Colonne « ${names[0]} » introuvable dans l’export`);
    index[key] = at;
  }
  const rows: SnuRow[] = [];
  for (const cells of table.slice(headerAt + 1)) {
    if (cells.every((c) => clean(c) === '')) continue;
    const get = (key: keyof typeof COLUMNS) => clean(cells[index[key]]);
    const credits = Number(get('credits'));
    rows.push({
      classification: get('classification'),
      department: get('department'),
      degree: get('degree'),
      courseNumber: get('courseNumber'),
      lectureNumber: get('lectureNumber'),
      title: get('title'),
      subtitle: get('subtitle'),
      credits: get('credits') !== '' && Number.isFinite(credits) && credits > 0 ? credits : null,
      language: get('language'),
      status: get('status'),
    });
  }
  return { term: termOfExport(table), rows };
}

export const departmentOf = (row: SnuRow): SnuDepartment | null => DEPARTMENTS[row.department.toLowerCase()] ?? null;

const isEnglish = (row: SnuRow): boolean => /^(english|영어)$/i.test(row.language);
const isOpen = (row: SnuRow): boolean => /^(open lecture|설강)$/i.test(row.status);
const isBachelor = (row: SnuRow): boolean => /^(bachelor|학사)$/i.test(row.degree);

/** Thèses, séminaires de recherche, stages et études indépendantes (en anglais ou en coréen) : pas des cours à comparer. */
const NOT_A_COURSE = [
  /논문|thesis|dissertation/i,
  /세미나|seminar/i,
  /인턴|현장실습|internship/i,
  /개별연구|독립연구|독립 연구|independent study/i,
];
export const isNotACourse = (row: SnuRow): boolean =>
  /^(논문|thesis)/i.test(row.classification) || NOT_A_COURSE.some((re) => re.test(`${row.title} ${row.subtitle}`));

export type Exclusion = 'department' | 'closed' | 'language' | 'not-a-course';

/** Pourquoi une rangée est écartée, ou null si elle est retenue (l'ordre des raisons est celui du rapport de collecte). */
export function exclusionOf(row: SnuRow): Exclusion | null {
  if (departmentOf(row) === null) return 'department';
  if (!isOpen(row)) return 'closed';
  if (!isEnglish(row)) return 'language';
  if (isNotACourse(row)) return 'not-a-course';
  return null;
}

const HANGUL = /[㄰-㆏가-힯]/;

/** Un cours (numéro de cours) formé de ses sections retenues. */
function courseOf(rows: SnuRow[], terms: HostTerm[], sourceUrl: string): HostCourseInput {
  const first = rows[0];
  // Le titre sans hangul d'abord (l'export anglais d'un trimestre peut compléter l'export coréen d'un autre).
  const base = rows.map((r) => r.title).find((t) => t !== '' && !HANGUL.test(t)) ?? first.title;
  // Le sous-titre n'est ajouté que s'il est le même pour toutes les sections (sinon c'est un cours à thèmes variables).
  const subtitles = new Set(rows.map((r) => r.subtitle));
  const subtitle = subtitles.size === 1 ? first.subtitle : '';
  return {
    code: first.courseNumber,
    title: subtitle === '' ? base : `${base} : ${subtitle}`,
    description: '',
    outline: null,
    credits: rows.map((r) => r.credits).find((c) => c !== null) ?? null,
    contactHours: null,
    language: 'en',
    terms,
    level: rows.some(isBachelor) ? 'undergrad' : 'grad',
    sourceUrl,
  };
}

/**
 * Lecteur des exports Excel (texte Unicode tabulé) de la recherche de cours de sugang.snu.ac.kr. Retenu : un
 * département d'informatique, de génie électrique et informatique, de mathématiques ou de statistique, un
 * cours ouvert donné en anglais, hors thèses, séminaires, stages et études indépendantes. Les sections d'un même
 * numéro de cours (tous fichiers confondus) forment un cours ; ses trimestres sont ceux de ses sections retenues.
 */
export const readSnuExports: Reader = (pages) => {
  const byCode = new Map<string, { rows: SnuRow[]; terms: HostTerm[]; url: string }>();
  for (const page of pages) {
    const { term, rows } = parseExport(page.body);
    for (const row of rows) {
      if (exclusionOf(row) !== null) continue;
      if (row.courseNumber === '') throw new Error(`Rangée sans numéro de cours : ${row.title} (${page.url})`);
      const entry = byCode.get(row.courseNumber) ?? { rows: [], terms: [], url: page.url };
      entry.rows.push(row);
      if (!entry.terms.includes(term)) entry.terms.push(term);
      byCode.set(row.courseNumber, entry);
    }
  }
  return [...byCode.values()].map((e) => courseOf(e.rows, e.terms, e.url));
};

registerReader('snu-kr', readSnuExports);
