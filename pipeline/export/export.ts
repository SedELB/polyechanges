import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostCourseOut, MatchOut, SiteData, SiteMeta } from '../../shared/siteData.js';
import { SITE_DATA_FILES } from '../../shared/siteData.js';
import type { Level, Notion, University } from '../../shared/types.js';
import { loadSourceFiles } from '../collect/sourceFile.js';
import { CRITERION_DIR, loadCriterion } from '../criterion/loadCriterion.js';
import { getCriterionVersion } from '../db/criterion.js';
import type { Db } from '../db/open.js';
import { listPolyCourses } from '../db/polyCourses.js';
import { lastRun } from '../db/runs.js';
import { getUniversity } from '../db/universities.js';

/** Refuse d'exporter si une source a échoué à sa dernière collecte ou si un fait d'université est périmé. */
function assertExportable(db: Db, universities: University[]): void {
  const sources = db.prepare('SELECT id FROM sources ORDER BY id').all() as { id: string }[];
  for (const s of sources) {
    if (lastRun(db, s.id)?.status === 'failed') {
      throw new Error(`Export bloqué : la dernière collecte de la source ${s.id} a échoué`);
    }
  }
  for (const u of universities) {
    for (const [fact, p] of Object.entries(u.provenance).sort(([a], [b]) => a.localeCompare(b))) {
      if (p?.stale) throw new Error(`Export bloqué : le fait « ${fact} » de l'université ${u.id} est périmé (extrait introuvable)`);
    }
  }
}

/** Les paires en base doivent venir des fichiers actuels du critère : sinon les grilles publiées ne seraient pas celles du calcul. */
function assertComputedWith(db: Db, version: string, paramsHash: string): void {
  const stored = getCriterionVersion(db, version);
  if (!stored) {
    throw new Error(`Export bloqué : le critère ${version} n'a jamais été calculé sur cette base. Lance npm run compare -- ${version}`);
  }
  if (stored.paramsHash !== paramsHash) {
    throw new Error(
      `Export bloqué : les paires en base ont été calculées avec d'autres réglages que les fichiers actuels du critère ${version}. Relance npm run compare -- ${version}`,
    );
  }
}

/** Fichier attendu de la page du programme de Poly, d'après la fiche de source de Poly (lecteur `poly`). */
function polyPageFile(sourcesDir: string): string {
  const source = existsSync(sourcesDir) ? loadSourceFiles(sourcesDir).find((s) => s.reader === 'poly') : undefined;
  return source?.files?.[0] ?? 'data/manual/poly/programme-LOG.html';
}

/**
 * Refuse un site sans rien à comparer : aucun cours de Poly comparé doté d'une grille, ou aucune paire calculée. Sur un
 * clone neuf sans la page du programme de Poly, la collecte ignore Poly et l'export publierait un site vide.
 */
function assertSomethingCompared(data: SiteData, version: string, sourcesDir: string): void {
  const page = `Enregistre la page du programme de Poly dans ${polyPageFile(sourcesDir)} (voir README.txt, PAGES À ENREGISTRER À LA MAIN), puis relance npm run refresh.`;
  const compared = data.polyCourses.filter((c) => c.compared && (data.notions[c.sigle]?.length ?? 0) > 0);
  if (compared.length === 0) {
    throw new Error(`Export bloqué : aucun cours de Poly comparé (0 cours de Poly actif doté d'une grille du critère ${version}). ${page}`);
  }
  if (data.matches.length === 0) {
    throw new Error(`Export bloqué : aucune paire calculée pour le critère ${version} (0 paire avec un niveau). Si les cours manquent : ${page} Sinon : npm run compare -- ${version}.`);
  }
}

/** Universités au catalogue public sans aucun cours actif en base : catalogue non lu. */
function unreadCatalogs(db: Db): string[] {
  return (
    db
      .prepare(
        `SELECT u.id FROM universities u
         WHERE u.catalog_public = 1
           AND NOT EXISTS (SELECT 1 FROM host_courses h WHERE h.university_id = u.id AND h.active = 1)
         ORDER BY u.id`,
      )
      .all() as { id: string }[]
  ).map((r) => r.id);
}

/** Année du catalogue pour chaque adresse de source dont la fiche porte `descriptionsDated`. */
function datedUrls(sourcesDir: string): Map<string, string> {
  const dated = new Map<string, string>();
  if (!existsSync(sourcesDir)) return dated;
  for (const source of loadSourceFiles(sourcesDir)) {
    if (source.descriptionsDated === undefined) continue;
    for (const url of source.urls) dated.set(url, source.descriptionsDated);
  }
  return dated;
}

function hostCourses(db: Db, sourcesDir: string): HostCourseOut[] {
  const dated = datedUrls(sourcesDir);
  const rows = db
    .prepare(
      `SELECT h.id, h.university_id, h.code, h.title, h.description, h.credits, h.contact_hours, h.language,
         h.terms_json, h.level, h.source_url, h.collected_at, h.source_page, h.source_line, s.sha256
       FROM host_courses h LEFT JOIN snapshots s ON s.id = h.snapshot_id
       WHERE h.active = 1 AND h.language IN ('en', 'unknown')
       ORDER BY h.id`,
    )
    .all() as {
    id: number;
    university_id: string;
    code: string;
    title: string;
    description: string;
    credits: number | null;
    contact_hours: number | null;
    language: 'en' | 'unknown';
    terms_json: string;
    level: HostCourseOut['level'];
    source_url: string;
    collected_at: string;
    source_page: number | null;
    source_line: number | null;
    sha256: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    universityId: r.university_id,
    code: r.code,
    title: r.title,
    description: r.description,
    credits: r.credits,
    contactHours: r.contact_hours,
    language: r.language,
    terms: (JSON.parse(r.terms_json) as HostCourseOut['terms']).slice().sort(),
    level: r.level,
    sourceUrl: r.source_url,
    collectedAt: r.collected_at,
    sourcePage: r.source_page,
    sourceLine: r.source_line,
    snapshotSha256: r.sha256,
    // Seule l'adresse d'une description tirée d'un catalogue daté porte l'année (la description donne l'adresse du cours).
    ...(r.description.trim() !== '' && dated.has(r.source_url) ? { descriptionsDated: dated.get(r.source_url) } : {}),
  }));
}

function matches(db: Db, version: string): MatchOut[] {
  const rows = db
    .prepare(
      `SELECT m.poly_sigle, m.host_course_id, m.notions_found, m.notions_missing, m.content_score,
         m.workload, m.level, m.text_used
       FROM matches m
       JOIN host_courses h ON h.id = m.host_course_id AND h.active = 1 AND h.language IN ('en', 'unknown')
       JOIN poly_courses p ON p.sigle = m.poly_sigle AND p.active = 1
       WHERE m.criterion_version = ? AND m.level IS NOT NULL
       ORDER BY m.poly_sigle, m.host_course_id`,
    )
    .all(version) as {
    poly_sigle: string;
    host_course_id: number;
    notions_found: string;
    notions_missing: string;
    content_score: number;
    workload: MatchOut['workload'];
    level: Level;
    text_used: MatchOut['textUsed'];
  }[];
  return rows.map((r) => ({
    polySigle: r.poly_sigle,
    hostCourseId: r.host_course_id,
    notionsFound: JSON.parse(r.notions_found) as string[],
    notionsMissing: JSON.parse(r.notions_missing) as string[],
    contentScore: r.content_score,
    workload: r.workload,
    level: r.level,
    textUsed: r.text_used,
  }));
}

/** Plus récente date de collecte de la base : l'export ne dépend pas de l'heure courante. */
function latestCollection(db: Db): string {
  const r = db
    .prepare(
      `SELECT MAX(d) AS d FROM (
         SELECT MAX(collected_at) AS d FROM host_courses WHERE active = 1
         UNION ALL SELECT MAX(collected_at) FROM poly_courses WHERE active = 1
       )`,
    )
    .get() as { d: string | null };
  return r.d ?? '';
}

const sortedNotions = (notions: Record<string, Notion[]>): Record<string, Notion[]> =>
  Object.fromEntries(Object.keys(notions).sort().map((k) => [k, notions[k]]));

/**
 * Écrit les JSON du site dans `outDir`. Tout est préparé dans un dossier voisin puis renommé :
 * un échec ne laisse jamais d'export partiel.
 */
export async function exportSiteData(
  db: Db,
  version: string,
  outDir: string,
  criterionDir: string = CRITERION_DIR,
  sourcesDir: string = 'data/sources',
): Promise<void> {
  const criterion = loadCriterion(version, criterionDir);
  assertComputedWith(db, version, criterion.paramsHash);
  const universities = (db.prepare('SELECT id FROM universities ORDER BY id').all() as { id: string }[])
    .map((r) => getUniversity(db, r.id))
    .filter((u): u is University => u !== null);
  assertExportable(db, universities);

  const meta: SiteMeta = {
    criterionVersion: version,
    generatedAt: latestCollection(db),
    polyWeeks: criterion.params.polyWeeks,
    workloadTolerance: criterion.params.workloadTolerance,
    unreadCatalogs: unreadCatalogs(db),
  };
  const data: SiteData = {
    meta,
    universities,
    polyCourses: listPolyCourses(db),
    hostCourses: hostCourses(db, sourcesDir),
    matches: matches(db, version),
    notions: sortedNotions(criterion.notions),
  };
  assertSomethingCompared(data, version, sourcesDir);
  const files: Record<(typeof SITE_DATA_FILES)[number], unknown> = {
    meta: data.meta,
    universities: data.universities,
    'poly-courses': data.polyCourses,
    'host-courses': data.hostCourses,
    matches: data.matches,
    notions: data.notions,
  };

  const staging = `${outDir}.tmp`;
  const previous = `${outDir}.old`;
  rmSync(staging, { recursive: true, force: true });
  rmSync(previous, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    for (const name of SITE_DATA_FILES) {
      writeFileSync(join(staging, `${name}.json`), `${JSON.stringify(files[name], null, 2)}\n`, 'utf8');
    }
    let moved = false;
    try {
      renameSync(outDir, previous);
      moved = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    try {
      renameSync(staging, outDir);
    } catch (err) {
      if (moved) renameSync(previous, outDir);
      throw err;
    }
    rmSync(previous, { recursive: true, force: true });
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw err;
  }
}
