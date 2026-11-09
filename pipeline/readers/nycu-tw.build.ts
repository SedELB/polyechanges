// Construit data/manual/nycu-tw.json à partir de l'horaire des cours de NYCU (timetable.nycu.edu.tw).
// Le site ne répond qu'à des requêtes POST (liste des cours d'un département, plan de cours) : le moteur de
// collecte, qui ne télécharge que des adresses, ne peut pas les lire. Ce script les interroge poliment, range
// les réponses telles que reçues comme copies brutes et écrit la saisie manuelle.
// À lancer à la main : npx tsx pipeline/readers/nycu-tw.build.ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HostCourseInput, HostTerm, Provenance } from '../../shared/types.js';
import { createPoliteFetcher, type PoliteFetcher } from '../fetch/politeFetch.js';

export const BASE = 'https://timetable.nycu.edu.tw/';
const API = `${BASE}?r=main/`;
/** Dernier trimestre d'automne (115-1) et dernier trimestre de printemps (114-2) publiés à la collecte. */
export const SEMESTERS: readonly { acy: string; sem: string; term: HostTerm }[] = [
  { acy: '115', sem: '1', term: 'fall' },
  { acy: '114', sem: '2', term: 'spring' },
];

/** Départements (uid de l'horaire) : informatique, génie électrique et informatique, mathématiques appliquées. */
export const DEPARTMENTS: Record<string, string> = {
  UEE: '73CEC435-74FF-49FE-88E7-63F369B3A3C5',
  DCP: 'E2D47D2E-B529-4449-8619-8561D3401D32',
  CS: '3FDEE98E-1A4F-4DE3-847B-ED0061569CC8',
  CEE: '75F46684-4732-47B1-8894-E22C9FA6C5A2',
  DAM: 'A0C3EB6F-4D5A-440D-9634-EB826A8587E5',
  GEE: '138AA9B5-ADF5-467B-A6C4-7B81ACEF431B',
  ECM: '53A140EC-F298-4E72-AD2E-45D7253C38F8',
  ICN: 'F03D7792-A8CD-491C-A20C-9D9DFF56014B',
  IEE: '29A058AC-DE9C-4693-8734-B0C601AE6738',
  ICE: '773FA006-821B-4151-B321-26AB49FEB960',
  ICC: 'AFB638BD-A5F7-EE11-8611-005056816DA7',
  IOC: 'F097A7AA-BB64-4C3F-B00C-799B5BF76D7F',
  IOE: 'C4033318-ECBD-4AA2-ADD9-74ABFDD8CFE6',
  ILE: '7BDC1EB0-9B23-4A92-AB4A-ED06B71D55C0',
  ICS: 'D3B3B3A7-6574-EE11-860B-005056816DA7',
  IAM: '1E6033DF-9E59-4AE3-A553-583E11583D47',
  IMM: '703453A3-CF45-4277-A402-C5C16BC4C9E1',
  ECS: '112DEFF0-F33B-4DDC-A2C8-53E522C564C2',
  AIG: '959D70AB-C5F4-408C-9BDF-3AC79C12FB18',
  IEC: '74E5BE29-E5B7-44D4-B3AE-EDDD225E2A93',
  IPC: '37DE4675-C3B4-404E-B7E5-025E693C13DD',
};

export interface ListedSection {
  acy: string;
  sem: string;
  cosId: string;
  code: string;
  title: string;
  credits: number | null;
  level: 'undergrad' | 'grad';
  /** Extrait mot pour mot de la réponse (du titre anglais au nom anglais du département). */
  quote: string;
}

export function listForm(depUid: string, acy: string, sem: string): Record<string, string> {
  return {
    m_acy: acy, m_sem: sem, m_acyend: acy, m_semend: sem, m_dep_uid: depUid, m_group: '**', m_grade: '**',
    m_class: '**', m_option: '**', m_crsname: '**', m_teaname: '**', m_cos_id: '**', m_cos_code: '**',
    m_crstime: '**', m_crsoutline: '**', m_costype: '**', m_selcampus: '**',
  };
}

export function outlineUrl(acy: string, sem: string, cosId: string): string {
  return `${BASE}?r=main/crsoutline&Acy=${acy}&Sem=${sem}&CrsNo=${cosId}&lang=en-us`;
}

type Item = Record<string, string>;

/** Fragment de la réponse brute : du titre anglais au nom anglais du département (ce nom contient des espaces). */
function quoteOf(body: string, item: Item): string {
  const idAt = body.indexOf(`"cos_id":"${item.cos_id}"`);
  if (idAt < 0) return '';
  const from = body.indexOf('"cos_ename":', idAt);
  const dep = body.indexOf('"dep_ename":"', from);
  if (from < 0 || dep < 0) return '';
  const end = body.indexOf('"', dep + '"dep_ename":"'.length);
  return body.slice(from, end + 1);
}

/** Sections données en anglais (« 英文授課 ») d'une réponse de liste. */
export function parseList(body: string): ListedSection[] {
  const json = JSON.parse(body) as Record<string, any>;
  const sections: ListedSection[] = [];
  for (const dep of Object.values(json)) {
    const languages: Record<string, unknown> = Array.isArray(dep.language) ? {} : (dep.language ?? {});
    for (const primary of ['1', '2']) {
      const items = (dep[primary] ?? {}) as Record<string, Item>;
      for (const item of Object.values(items)) {
        const flags = languages[`${item.acy}${item.sem}_${item.cos_id}`];
        if (!flags || !Object.values(flags as object).includes('en-us')) continue;
        const quote = quoteOf(body, item);
        if (!quote) continue;
        const credits = Number(item.cos_credit);
        sections.push({
          acy: item.acy,
          sem: item.sem,
          cosId: item.cos_id,
          code: item.cos_code,
          title: item.cos_ename,
          credits: Number.isFinite(credits) && credits > 0 ? credits : null,
          level: item.degree === '1' ? 'undergrad' : 'grad',
          quote,
        });
      }
    }
  }
  return sections;
}

/** Texte du plan de cours : objectifs et contenu (`crs_outline`). */
export function parseDescription(body: string): string {
  const json = JSON.parse(body) as Record<string, unknown>;
  const text = typeof json.crs_outline === 'string' ? json.crs_outline : '';
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

export interface Merged {
  code: string;
  title: string;
  credits: number | null;
  level: 'undergrad' | 'grad';
  terms: HostTerm[];
  /** Section retenue pour le plan de cours : la première rencontrée (automne avant printemps). */
  best: ListedSection;
  rawSha: string;
}

/** Un cours par code permanent : trimestres fusionnés, première section conservée. */
export function mergeSections(listed: { section: ListedSection; term: HostTerm; rawSha: string }[]): Merged[] {
  const byCode = new Map<string, Merged>();
  for (const { section, term, rawSha } of listed) {
    const existing = byCode.get(section.code);
    if (!existing) {
      byCode.set(section.code, {
        code: section.code, title: section.title, credits: section.credits, level: section.level,
        terms: [term], best: section, rawSha,
      });
      continue;
    }
    if (!existing.terms.includes(term)) existing.terms.push(term);
  }
  for (const m of byCode.values()) m.terms.sort((a, b) => (a === b ? 0 : a === 'fall' ? -1 : 1));
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function toCourse(m: Merged, description: string, retrievedAt: string): HostCourseInput & { provenance: Provenance } {
  return {
    code: m.code,
    title: m.title,
    description,
    outline: null,
    credits: m.credits,
    contactHours: null,
    language: 'en',
    terms: m.terms,
    level: m.level,
    sourceUrl: outlineUrl(m.best.acy, m.best.sem, m.best.cosId),
    provenance: { url: BASE, retrievedAt, sha256: m.rawSha, locator: { page: 1, line: 1 }, quote: m.best.quote },
  };
}

function store(rawDir: string, body: Buffer): string {
  const sha = createHash('sha256').update(body).digest('hex');
  const full = join(rawDir, 'nycu-tw', `${sha}.html`);
  if (!existsSync(full)) {
    mkdirSync(join(rawDir, 'nycu-tw'), { recursive: true });
    writeFileSync(full, body);
  }
  return sha;
}

export async function build(fetcher: PoliteFetcher, rawDir: string): Promise<HostCourseInput[]> {
  const retrievedAt = new Date().toISOString();
  const listed: { section: ListedSection; term: HostTerm; rawSha: string }[] = [];
  for (const { acy, sem, term } of SEMESTERS) {
    for (const [name, uid] of Object.entries(DEPARTMENTS)) {
      const res = await fetcher.post(`${API}get_cos_list`, listForm(uid, acy, sem));
      const sha = store(rawDir, res.body);
      const sections = parseList(res.body.toString('utf8'));
      console.log(`${acy}${sem} ${name} : ${sections.length} sections en anglais`);
      for (const section of sections) listed.push({ section, term, rawSha: sha });
    }
  }
  const merged = mergeSections(listed);
  const courses: HostCourseInput[] = [];
  for (const m of merged) {
    const { acy, sem, cosId } = m.best;
    const res = await fetcher.post(`${API}getCrsOutlineDescription`, { acy, sem, cos_id: cosId, user: '', _token: '' });
    courses.push(toCourse(m, parseDescription(res.body.toString('utf8')), retrievedAt));
  }
  return courses;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const courses = await build(createPoliteFetcher(), join('data', 'raw'));
  mkdirSync(join('data', 'manual'), { recursive: true });
  writeFileSync(join('data', 'manual', 'nycu-tw.json'), JSON.stringify(courses, null, 2) + '\n');
  console.log(`${courses.length} cours écrits dans data/manual/nycu-tw.json`);
}
