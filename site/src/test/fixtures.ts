import { round3 } from '../../../shared/workload';
import type { HostCourseOut, MatchOut, SiteData } from '../../../shared/siteData';
import type { PolyCourse, Provenance, TermDates, University } from '../../../shared/types';

const SHA = 'a'.repeat(64);

function prov(url: string, quote: string, line: number): Provenance {
  return { url, retrievedAt: '2026-11-02', sha256: SHA, locator: { page: 1, line }, quote };
}

function terms(fall: TermDates | null, spring: TermDates | null): University['terms'] {
  return { fall, spring };
}

const FALL: TermDates = { start: '2026-09-14', end: '2026-12-25', examsEnd: '2027-01-15' };
const SPRING: TermDates = { start: '2027-02-22', end: '2027-06-11', examsEnd: '2027-06-25' };

function taiwanUniversity(id: string, name: string, city: string, lat: number, lng: number, extra: Partial<University>): University {
  const site = `https://www.${id.split('-')[0]}.example.tw/`;
  return {
    id,
    name,
    moveOnName: name,
    countryCode: 'TW',
    city,
    lat,
    lng,
    website: site,
    catalogUrl: `${site}catalog`,
    creditSystem: 'ECTS',
    contactHoursPerCredit: null,
    terms: terms(FALL, SPRING),
    restrictions: null,
    exchangeContact: null,
    catalogPublic: true,
    provenance: {
      name: prov(site, name, 3),
      catalogPublic: prov(`${site}catalog`, 'Course catalog', 9),
      coordinates: prov(site, `${lat}, ${lng}`, 5),
      creditSystem: prov(`${site}credits`, 'credits', 12),
      'terms.fall.start': prov(`${site}calendar`, 'Fall semester begins Sep 14', 20),
      'terms.fall.end': prov(`${site}calendar`, 'Fall semester ends Dec 25', 21),
      'terms.fall.examsEnd': prov(`${site}calendar`, 'Fall exams end Jan 15', 22),
      'terms.spring.start': prov(`${site}calendar`, 'Spring semester begins Feb 22', 30),
      'terms.spring.end': prov(`${site}calendar`, 'Spring semester ends Jun 11', 31),
      'terms.spring.examsEnd': prov(`${site}calendar`, 'Spring exams end Jun 25', 32),
    },
    ...extra,
  };
}

const ntu = taiwanUniversity('ntu-tw', 'National Taiwan University', 'Taipei', 25.017, 121.5397, {
  creditSystem: 'local',
  contactHoursPerCredit: 18,
  provenance: {
    ...taiwanUniversity('ntu-tw', 'National Taiwan University', 'Taipei', 25.017, 121.5397, {}).provenance,
    contactHoursPerCredit: prov('https://www.ntu.example.tw/credits', 'One credit equals 18 hours of contact', 14),
  },
});
const nycu = taiwanUniversity('nycu-tw', 'National Yang Ming Chiao Tung University', 'Hsinchu', 24.7871, 120.9971, {});
const ncku = taiwanUniversity('ncku-tw', 'National Cheng Kung University', 'Tainan', 22.9997, 120.2270, {
  catalogPublic: false,
  catalogUrl: null,
});

const tohoku: University = {
  id: 'tohoku-jp',
  name: 'Tohoku University',
  moveOnName: 'Tohoku University',
  countryCode: 'JP',
  city: 'Sendai',
  lat: 38.2531,
  lng: 140.8738,
  website: 'https://www.tohoku.example.jp/',
  catalogUrl: 'https://www.tohoku.example.jp/catalog',
  creditSystem: 'ECTS',
  contactHoursPerCredit: null,
  terms: terms(
    { start: '2026-10-01', end: '2027-02-05', examsEnd: '2027-02-20' },
    { start: '2027-04-08', end: '2027-08-06', examsEnd: '2027-08-20' },
  ),
  restrictions: null,
  exchangeContact: null,
  catalogPublic: true,
  provenance: {
    name: prov('https://www.tohoku.example.jp/', 'Tohoku University', 2),
    catalogPublic: prov('https://www.tohoku.example.jp/catalog', 'Course catalog', 8),
    coordinates: prov('https://www.tohoku.example.jp/', '38.2531, 140.8738', 4),
    creditSystem: prov('https://www.tohoku.example.jp/credits', 'ECTS credits', 11),
    'terms.fall.start': prov('https://www.tohoku.example.jp/calendar', 'Fall term begins Oct 1', 18),
    'terms.fall.end': prov('https://www.tohoku.example.jp/calendar', 'Fall term ends Feb 5', 19),
    'terms.fall.examsEnd': prov('https://www.tohoku.example.jp/calendar', 'Fall exams end Feb 20', 20),
    'terms.spring.start': prov('https://www.tohoku.example.jp/calendar', 'Spring term begins Apr 8', 24),
    'terms.spring.end': prov('https://www.tohoku.example.jp/calendar', 'Spring term ends Aug 6', 25),
    'terms.spring.examsEnd': prov('https://www.tohoku.example.jp/calendar', 'Spring exams end Aug 20', 26),
  },
};

const PROGRAM_URL = 'https://www.polymtl.example/programmes/genie-informatique';
const GROUP = 'Filière classique (93 crédits)';

function poly(sigle: string, title: string, description: string, credits: number, triplet: [number, number, number], line: number, extra: Partial<PolyCourse> = {}): PolyCourse {
  return {
    sigle,
    title,
    description,
    credits,
    triplet,
    prerequisites: '',
    status: 'optionnel',
    eligible: true,
    ineligibleReason: null,
    compared: true,
    groups: [GROUP],
    sourceUrl: PROGRAM_URL,
    collectedAt: '2026-11-02',
    sourceLocator: { sha256: SHA, page: 1, line },
    ...extra,
  };
}

const polyCourses: PolyCourse[] = [
  poly('INF3710', 'Fichiers et bases de données', 'Modèle relationnel, SQL, normalisation et transactions.', 3, [3, 2, 4], 40),
  poly('LOG3430', 'Méthodes de test et de validation du logiciel', 'Tests unitaires, couverture, tests d’intégration et de régression.', 3, [3, 2, 4], 52),
  poly('INF2610', 'Noyau d’un système d’exploitation', 'Processus, fils d’exécution, mémoire virtuelle et systèmes de fichiers.', 3, [3, 2, 4], 31),
  poly('INF3405', 'Réseaux informatiques', 'Modèle en couches, TCP/IP, routage et programmation réseau.', 3, [3, 2, 4], 46),
  poly('SSH3501', 'Cours complémentaire', 'Cours de sciences humaines.', 3, [3, 0, 6], 90, {
    eligible: false,
    ineligibleReason: 'Ce cours ne peut pas être suivi en échange.',
    compared: false,
    groups: [],
  }),
  poly('LOG3900', 'Projet de génie logiciel', 'Projet intégrateur réalisé en équipe.', 4, [1, 6, 5], 60, { compared: false }),
];

function host(id: number, universityId: string, code: string, title: string, description: string, extra: Partial<HostCourseOut> = {}): HostCourseOut {
  return {
    id,
    universityId,
    code,
    title,
    description,
    credits: universityId === 'ntu-tw' ? 3 : 6,
    contactHours: universityId === 'ntu-tw' ? 60 : null,
    language: 'en',
    terms: ['fall'],
    sourceUrl: `https://www.${universityId.split('-')[0]}.example/catalog/${code}`,
    collectedAt: '2026-11-20',
    sourcePage: 1,
    sourceLine: id * 10,
    snapshotSha256: SHA,
    ...extra,
  };
}

const hostCourses: HostCourseOut[] = [
  host(1, 'ntu-tw', 'CSIE3010', 'Database Systems', 'Relational model, SQL, normalization and transactions.'),
  host(2, 'ntu-tw', 'CSIE3020', 'Software Testing', 'Unit testing, coverage, integration and regression testing.'),
  host(3, 'ntu-tw', 'CSIE3030', 'Software Verification', 'Verification of programs.', { terms: [], credits: null, contactHours: null }),
  host(4, 'ntu-tw', 'CSIE3040', 'Introduction to Databases', 'Relational model and SQL queries.', { terms: ['spring'] }),
  host(5, 'ntu-tw', 'CSIE3050', 'Network Programming', 'Sockets and basic protocols.', { contactHours: 30 }),
  host(6, 'ntu-tw', 'CSIE3060', 'Network Architecture', 'Protocol stacks and routing.', { language: 'unknown' }),
  host(7, 'nycu-tw', 'DB101', 'Database Management', 'Relational model, SQL and transactions.'),
  host(8, 'tohoku-jp', 'ENG201', 'Thermodynamics', 'Heat, work and the laws of thermodynamics.'),
];

function match(polySigle: string, hostCourseId: number, notionsFound: string[], notionsMissing: string[], over: Partial<MatchOut> = {}): MatchOut {
  return {
    polySigle,
    hostCourseId,
    notionsFound,
    notionsMissing,
    contentScore: round3(notionsFound.length / (notionsFound.length + notionsMissing.length)),
    workload: 'conforme',
    level: 'elevee',
    textUsed: 'description',
    ...over,
  };
}

const INF3710_ALL = ['sql', 'modele-relationnel', 'normalisation', 'transactions'];

const matches: MatchOut[] = [
  match('INF3710', 1, INF3710_ALL, []),
  match('LOG3430', 2, ['tests-unitaires', 'couverture'], ['tests-regression'], { level: 'moyenne' }),
  match('INF3710', 7, ['sql', 'modele-relationnel', 'normalisation'], ['transactions'], { textUsed: 'description+plan' }),
  match('INF3710', 4, ['sql', 'modele-relationnel'], ['normalisation', 'transactions'], { level: 'moyenne' }),
  match('LOG3430', 3, ['tests-unitaires', 'couverture'], ['tests-regression'], { workload: 'inconnue', level: 'faible' }),
  match('INF3405', 5, ['sockets'], ['routage'], { workload: 'trop_legere', level: 'faible' }),
  match('INF3405', 6, ['routage'], ['sockets'], { level: 'moyenne' }),
];

export const fixtureData: SiteData = {
  meta: { criterionVersion: 'v0', generatedAt: '2026-11-10T18:26:41.134Z', polyWeeks: 13, workloadTolerance: 0.15 },
  universities: [ntu, nycu, ncku, tohoku],
  polyCourses,
  hostCourses,
  matches,
  notions: {
    INF3710: [
      { id: 'sql', fr: 'SQL', en: 'SQL' },
      { id: 'modele-relationnel', fr: 'Modèle relationnel', en: 'Relational model' },
      { id: 'normalisation', fr: 'Normalisation', en: 'Normalization' },
      { id: 'transactions', fr: 'Transactions', en: 'Transactions' },
    ],
    LOG3430: [
      { id: 'tests-unitaires', fr: 'Tests unitaires', en: 'Unit testing' },
      { id: 'couverture', fr: 'Couverture de tests', en: 'Test coverage' },
      { id: 'tests-regression', fr: 'Tests de régression', en: 'Regression testing' },
    ],
    INF3405: [
      { id: 'sockets', fr: 'Sockets', en: 'Sockets' },
      { id: 'routage', fr: 'Routage', en: 'Routing' },
    ],
  },
};
