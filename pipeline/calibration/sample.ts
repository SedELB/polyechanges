import type { CountryCode, HostCourseInput } from '../../shared/types.js';
import { hostContactHours } from '../../shared/workload.js';
import { activeHostCourses } from '../db/hostCourses.js';
import type { Db } from '../db/open.js';
import { listPolyCourses } from '../db/polyCourses.js';
import { getUniversity } from '../db/universities.js';

export interface SamplePair {
  pairId: string;
  polySigle: string;
  hostCourseId: number;
  countryCode: CountryCode;
}

/** Taille de l'échantillon jugé à l'aveugle. */
export const SAMPLE_SIZE = 60;
/** Nombre de meilleurs candidats retenus par cours de Poly, par université et par version. */
export const TOP_PER_GROUP = 3;
/** Part de chaque université tirée parmi les meilleurs candidats ; le reste est tiré au hasard. */
const TOP_SHARE = 0.8;

export const pairIdOf = (polySigle: string, hostCourseId: number): string => `${polySigle}:${hostCourseId}`;

export function parsePairId(pairId: string): { polySigle: string; hostCourseId: number } {
  const m = /^([A-Z0-9]+):(\d+)$/.exec(pairId);
  if (!m) throw new Error(`Identifiant de paire invalide : ${pairId}`);
  return { polySigle: m[1], hostCourseId: Number(m[2]) };
}

interface DescribedPair extends SamplePair {
  universityId: string;
}

interface MatchLine {
  poly_sigle: string;
  host_course_id: number;
  university_id: string;
  country_code: CountryCode;
}

const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

function assertComputed(db: Db, versions: string[]): void {
  if (versions.length === 0) throw new Error('Aucune version du concours à tirer');
  const count = db.prepare('SELECT COUNT(*) AS n FROM matches WHERE criterion_version = ?');
  for (const v of versions) {
    if ((count.get(v) as { n: number }).n === 0) {
      throw new Error(`Le critère ${v} n'a aucun résultat : lance d'abord « npm run compare -- ${v} »`);
    }
  }
}

/** Paires dont le cours d'accueil a un texte comparable (jamais le titre seul), dans au moins une des versions. */
function describedPairs(db: Db, versions: string[]): DescribedPair[] {
  const rows = db
    .prepare(
      `SELECT m.poly_sigle, m.host_course_id, h.university_id, u.country_code
       FROM matches m
       JOIN host_courses h ON h.id = m.host_course_id AND h.active = 1
       JOIN universities u ON u.id = h.university_id
       JOIN poly_courses p ON p.sigle = m.poly_sigle AND p.active = 1
       WHERE m.criterion_version IN (${placeholders(versions.length)})
       GROUP BY m.poly_sigle, m.host_course_id
       HAVING SUM(m.text_used = 'titre') = 0
       ORDER BY h.university_id, m.poly_sigle, m.host_course_id`,
    )
    .all(...versions) as MatchLine[];
  return rows.map((r) => ({
    pairId: pairIdOf(r.poly_sigle, r.host_course_id),
    polySigle: r.poly_sigle,
    hostCourseId: r.host_course_id,
    countryCode: r.country_code,
    universityId: r.university_id,
  }));
}

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

interface Ranked {
  pairId: string;
  hostCourseId: number;
  score: number;
  meanSim: number;
}

/**
 * Pour une version, les cours d'accueil décrits de chaque groupe (cours de Poly, université), du meilleur au moins bon.
 * « Meilleur » : part des notions retrouvées, puis similarité moyenne des notions, puis identifiant du cours.
 */
function rankedGroups(db: Db, version: string): Ranked[][] {
  const rows = db
    .prepare(
      `SELECT m.poly_sigle, m.host_course_id, h.university_id, m.content_score, m.notion_sims
       FROM matches m
       JOIN host_courses h ON h.id = m.host_course_id AND h.active = 1
       JOIN poly_courses p ON p.sigle = m.poly_sigle AND p.active = 1
       WHERE m.criterion_version = ? AND m.text_used <> 'titre'`,
    )
    .all(version) as (MatchLine & { content_score: number; notion_sims: string })[];
  const groups = new Map<string, Ranked[]>();
  for (const r of rows) {
    const key = `${r.poly_sigle}|${r.university_id}`;
    if (!groups.has(key)) groups.set(key, []);
    (groups.get(key) as Ranked[]).push({
      pairId: pairIdOf(r.poly_sigle, r.host_course_id),
      hostCourseId: r.host_course_id,
      score: r.content_score,
      meanSim: mean(Object.values(JSON.parse(r.notion_sims) as Record<string, number>)),
    });
  }
  return [...groups.values()].map((g) =>
    g.sort((a, b) => b.score - a.score || b.meanSim - a.meanSim || a.hostCourseId - b.hostCourseId),
  );
}

/** Union, sur toutes les versions, des 3 meilleurs cours d'accueil décrits de chaque cours de Poly dans chaque université. */
export function topCandidates(db: Db, versions: string[]): Set<string> {
  const top = new Set<string>();
  for (const version of versions) {
    for (const group of rankedGroups(db, version)) group.slice(0, TOP_PER_GROUP).forEach((c) => top.add(c.pairId));
  }
  return top;
}

/** Nombre de versions qui doivent classer un cours d'accueil premier de son groupe pour qu'il entre au consensus. */
export const CONSENSUS_VOTES = 2;

/** Paires classées premières de leur groupe (cours de Poly, université) par au moins 2 versions. */
export function consensusCandidates(db: Db, versions: string[]): Set<string> {
  const votes = new Map<string, number>();
  for (const version of versions) {
    for (const group of rankedGroups(db, version)) {
      const first = group[0].pairId;
      votes.set(first, (votes.get(first) ?? 0) + 1);
    }
  }
  return new Set([...votes].filter(([, n]) => n >= CONSENSUS_VOTES).map(([id]) => id));
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Pool {
  top: DescribedPair[];
  other: DescribedPair[];
}

/** Prend `want` paires : 4 sur 5 parmi les meilleurs candidats, le reste au hasard ; un groupe trop court est complété par l'autre. */
function take(pool: Pool, want: number): DescribedPair[] {
  const fromTop = pool.top.splice(0, Math.round(want * TOP_SHARE));
  const fromOther = pool.other.splice(0, want - fromTop.length);
  const more = pool.top.splice(0, want - fromTop.length - fromOther.length);
  return [...fromTop, ...fromOther, ...more];
}

/**
 * Tire 60 paires décrites, réparties le plus également possible entre les universités qui en ont.
 * Quota : floor(60 / n), le reste une par une dans l'ordre alphabétique des universités ; ce qu'une université
 * ne peut pas fournir passe aux suivantes. Tirage déterministe par `seed`.
 */
export function drawSample(db: Db, versions: string[], seed: number): SamplePair[] {
  assertComputed(db, versions);
  const described = describedPairs(db, versions);
  const top = topCandidates(db, versions);
  const universities = [...new Set(described.map((p) => p.universityId))].sort();
  if (described.length < SAMPLE_SIZE) {
    throw new Error(`Seulement ${described.length} paires décrites : il en faut ${SAMPLE_SIZE} pour l'échantillon`);
  }

  const random = seededRandom(seed);
  const pools = new Map<string, Pool>(
    universities.map((u) => {
      const own = described.filter((p) => p.universityId === u);
      return [u, { top: shuffle(own.filter((p) => top.has(p.pairId)), random), other: shuffle(own.filter((p) => !top.has(p.pairId)), random) }];
    }),
  );
  return sorted(distribute(universities, SAMPLE_SIZE, (u, want) => take(pools.get(u) as Pool, want)));
}

/**
 * Deuxième échantillon, centré sur les équivalences probables : les paires décrites classées premières de leur groupe
 * par au moins 2 versions, hors paires déjà jugées. Même répartition entre universités que `drawSample` ;
 * s'il y a moins de `size` candidats, ils sont tous pris.
 */
export function drawConsensusSample(db: Db, versions: string[], seed: number, size: number, exclude: Iterable<string>): SamplePair[] {
  assertComputed(db, versions);
  const excluded = new Set(exclude);
  const consensus = consensusCandidates(db, versions);
  const candidates = describedPairs(db, versions).filter((p) => consensus.has(p.pairId) && !excluded.has(p.pairId));
  if (candidates.length === 0) throw new Error('Aucune paire du consensus hors des paires déjà jugées');
  const universities = [...new Set(candidates.map((p) => p.universityId))].sort();
  const random = seededRandom(seed);
  const pools = new Map(universities.map((u) => [u, shuffle(candidates.filter((p) => p.universityId === u), random)]));
  return sorted(distribute(universities, Math.min(size, candidates.length), (u, want) => (pools.get(u) as DescribedPair[]).splice(0, want)));
}

/**
 * Répartit `size` paires entre les universités : floor(size / n) chacune, le reste une par une dans l'ordre ;
 * ce qu'une université ne peut pas fournir passe aux suivantes, puis repart au début de la liste.
 */
function distribute(universities: string[], size: number, take: (u: string, want: number) => DescribedPair[]): DescribedPair[] {
  const base = Math.floor(size / universities.length);
  const extra = size - base * universities.length;
  const chosen: DescribedPair[] = [];
  let carry = 0;
  universities.forEach((u, i) => {
    const want = base + (i < extra ? 1 : 0) + carry;
    const picked = take(u, want);
    chosen.push(...picked);
    carry = want - picked.length;
  });
  for (const u of universities) {
    if (carry === 0) break;
    const picked = take(u, carry);
    chosen.push(...picked);
    carry -= picked.length;
  }
  return chosen;
}

/** Trié par université, sigle et cours : l'ordre ne trahit pas comment une paire a été tirée. */
const sorted = (pairs: DescribedPair[]): SamplePair[] =>
  pairs
    .sort((a, b) => a.universityId.localeCompare(b.universityId) || a.polySigle.localeCompare(b.polySigle) || a.hostCourseId - b.hostCourseId)
    .map(({ pairId, polySigle, hostCourseId, countryCode }) => ({ pairId, polySigle, hostCourseId, countryCode }));

export interface SampleEntry {
  pairId: string;
  country: CountryCode;
  university: string;
  polyCourse: {
    sigle: string;
    title: string;
    description: string;
    credits: number;
    weeklyHours: { lecture: number; lab: number; personal: number };
  };
  hostCourse: {
    code: string;
    title: string;
    description: string;
    outline: string | null;
    credits: number | null;
    cycle: HostCourseInput['level'];
    language: HostCourseInput['language'];
    sourceUrl: string;
  };
  workload: {
    creditSystem: 'ECTS' | 'local';
    polyCredits: number;
    polyEctsEquivalent: number;
    polyWeeks: number;
    polyContactHours: number;
    hostCredits: number | null;
    hostContactHoursPerCredit: number | null;
    hostContactHours: number | null;
  };
}

export interface SampleFile {
  seed: number;
  notes: string[];
  responseFormat: string;
  pairs: SampleEntry[];
}

/** Fichier remis au juge : les deux cours et les données de charge, sans aucun résultat du calcul. */
export function sampleFile(
  db: Db,
  pairs: SamplePair[],
  seed: number,
  polyWeeks: number,
  judgmentsFile = 'data/calibration/judgments.json',
): SampleFile {
  const polys = new Map(listPolyCourses(db).map((p) => [p.sigle, p]));
  const hosts = new Map(activeHostCourses(db).map((h) => [h.id, h]));
  return {
    seed,
    notes: [
      "Chaque paire associe un cours de Polytechnique Montréal (polyCourse) à un cours d'une université partenaire (hostCourse).",
      'polyCourse.weeklyHours : heures par semaine de cours, de laboratoire et de travail personnel.',
      'hostCourse.outline : plan de cours publié, null si absent. hostCourse.cycle : undergrad (1er cycle) ou grad (cycles supérieurs).',
      'workload.polyContactHours = (cours + laboratoire) x polyWeeks semaines. workload.hostContactHours : heures publiées, sinon crédits x heures par crédit de l’université ; null si inconnues.',
      'Université en ECTS : comparer hostCredits à polyEctsEquivalent (2 ECTS par crédit de Poly).',
    ],
    responseFormat: `${judgmentsFile} : { "<pairId>": { "judgment": "elevee" | "moyenne" | "faible" | "pas_equivalent", "reason": "une phrase" } }`,
    pairs: pairs.map((p) => {
      const poly = polys.get(p.polySigle);
      const host = hosts.get(p.hostCourseId);
      const university = host ? getUniversity(db, host.universityId) : null;
      if (!poly || !host || !university) throw new Error(`Paire ${p.pairId} introuvable dans la base`);
      const [lecture, lab, personal] = poly.triplet;
      return {
        pairId: p.pairId,
        country: university.countryCode,
        university: university.name,
        polyCourse: {
          sigle: poly.sigle,
          title: poly.title,
          description: poly.description,
          credits: poly.credits,
          weeklyHours: { lecture, lab, personal },
        },
        hostCourse: {
          code: host.code,
          title: host.title,
          description: host.description,
          outline: host.outline,
          credits: host.credits,
          cycle: host.level,
          language: host.language,
          sourceUrl: host.sourceUrl,
        },
        workload: {
          creditSystem: university.creditSystem,
          polyCredits: poly.credits,
          polyEctsEquivalent: 2 * poly.credits,
          polyWeeks,
          polyContactHours: (lecture + lab) * polyWeeks,
          hostCredits: host.credits,
          hostContactHoursPerCredit: university.contactHoursPerCredit,
          hostContactHours: hostContactHours(host, university.contactHoursPerCredit),
        },
      };
    }),
  };
}
