import type { HostCourseInput, PolyCourse, University, Workload } from '../../shared/types.js';
import { contentBand, contentScore, levelFor } from '../criterion/levels.js';
import { upsertCriterionVersion } from '../db/criterion.js';
import { activeHostCourses, applyCollection } from '../db/hostCourses.js';
import { replaceMatches, type MatchRow } from '../db/matches.js';
import { openDb, type Db } from '../db/open.js';
import { upsertPolyCourses } from '../db/polyCourses.js';
import { upsertUniversity } from '../db/universities.js';

/** Base de test du concours : quatre universités, dont une seulement avec des cours sans description. */
export const UNIVERSITIES: { id: string; country: University['countryCode']; courses: number; described: boolean }[] = [
  { id: 'alpha-tw', country: 'TW', courses: 10, described: true },
  { id: 'beta-jp', country: 'JP', courses: 10, described: true },
  { id: 'delta-cn', country: 'CN', courses: 4, described: false },
  { id: 'gamma-kr', country: 'KR', courses: 3, described: true },
];
export const POLY_SIGLES = ['INF1001', 'INF1002', 'INF1003', 'INF1004', 'INF1005', 'INF1006'];

const university = (id: string, countryCode: University['countryCode']): University => ({
  id, name: `Université ${id}`, moveOnName: id, countryCode, city: 'x', lat: 0, lng: 0, website: 'https://x',
  catalogUrl: null, creditSystem: 'local', contactHoursPerCredit: 16, terms: { fall: null, spring: null },
  restrictions: null, exchangeContact: null, catalogPublic: true, provenance: {},
});

const poly = (sigle: string): PolyCourse => ({
  sigle, title: `Cours ${sigle}`, description: `Description officielle de ${sigle}.`, credits: 3, triplet: [3, 1.5, 4.5],
  prerequisites: '', status: 'optionnel', eligible: true, ineligibleReason: null, compared: true, groups: [],
  sourceUrl: 'https://poly.example', collectedAt: '2026-01-01', sourceLocator: null,
});

const host = (code: string, described: boolean): HostCourseInput => ({
  code, title: `Course ${code}`, description: described ? `Topics of ${code}.` : '', outline: null, credits: 3,
  contactHours: null, language: 'en', terms: ['fall'], level: 'undergrad', sourceUrl: `https://h.example/${code}`,
});

/** Ligne de résultat à partir des similarités de chaque notion, avec les seuils v0. */
export function matchRow(
  polySigle: string,
  hostCourseId: number,
  sims: number[],
  workload: Workload = 'conforme',
  textUsed: MatchRow['textUsed'] = 'description',
): MatchRow {
  const notionSims = Object.fromEntries(sims.map((s, i) => [`n${i + 1}`, s]));
  const found = Object.keys(notionSims).filter((k) => notionSims[k] >= 0.55);
  const score = contentScore(found.length, sims.length);
  const band = contentBand(score, 0.7, 0.4);
  return {
    polySigle, hostCourseId, notionsFound: found, notionsMissing: Object.keys(notionSims).filter((k) => !found.includes(k)),
    notionSims, contentScore: score, contentBand: band, workload, level: levelFor(band, workload), textUsed,
  };
}

/** Similarité pseudo-aléatoire, mais fixe pour un même texte. */
function pseudo(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return Math.round(((h >>> 0) / 2 ** 32) * 1000) / 1000;
}

/** Base neuve avec les universités, les cours et les résultats de chaque version donnée. */
export function seedContestDb(versions: string[]): Db {
  const db = openDb(':memory:');
  upsertPolyCourses(db, POLY_SIGLES.map(poly));
  for (const u of UNIVERSITIES) {
    upsertUniversity(db, university(u.id, u.country));
    const courses = Array.from({ length: u.courses }, (_, i) => host(`${u.id.slice(0, 1).toUpperCase()}${i + 1}`, u.described));
    applyCollection(db, u.id, courses, () => null, '2026-01-02');
  }
  const hosts = activeHostCourses(db);
  for (const version of versions) {
    upsertCriterionVersion(db, version, `hash-${version}`, '{}');
    const rows = POLY_SIGLES.flatMap((sigle) =>
      hosts.map((h) =>
        matchRow(
          sigle,
          h.id,
          [1, 2, 3, 4, 5].map((n) => pseudo(`${version}|${sigle}|${h.code}|${n}`)),
          'conforme',
          h.description === '' ? 'titre' : 'description',
        ),
      ),
    );
    replaceMatches(db, version, rows);
  }
  return db;
}
