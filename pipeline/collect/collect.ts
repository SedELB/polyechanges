import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db/open.js';
import { activeHostCourses, applyCollection, type CollectionDiff } from '../db/hostCourses.js';
import { recordRun } from '../db/runs.js';
import { upsertSource } from '../db/sources.js';
import { readSnapshot, takeSnapshot, type RawSnapshot } from '../fetch/snapshots.js';
import type { PoliteFetcher } from '../fetch/politeFetch.js';
import type { HostCourseInput } from '../../shared/types.js';
import { findCode, lineSupportsCourse, snapshotText } from '../provenance/snapshotText.js';
import { checkGuards, type GuardResult } from './guards.js';
import { mergeCourses, type LocatedCourse, type SourceCourses } from './merge.js';
import { getReader } from './readers.js';
import { missingSavedPages, skippedSavedWarning, staleSavedWarning, takeSavedSnapshots } from './saved.js';
import type { SourceFile } from './sourceFile.js';

export type { CollectionDiff } from '../db/hostCourses.js';
export { lastRun } from '../db/runs.js';
export { activeHostCourses } from '../db/hostCourses.js';

export interface CollectResult {
  /** `skipped` : pages enregistrées absentes ; rien n'est lu ni écrit, les cours en base restent tels quels et l'export n'est pas bloqué. */
  status: 'ok' | 'failed' | 'skipped';
  diff: CollectionDiff | null;
  reason: string | null;
  /** Lignes à écrire en tête du rapport (pages enregistrées à réenregistrer) ; absent s'il n'y en a pas. */
  warnings?: string[];
  /** Lignes de détail du bloc automatique du rapport (sources, codes ignorés) ; absent s'il n'y en a pas. */
  notes?: string[];
  /** Lignes datées d'une baisse voulue, écrites hors du bloc automatique et jamais réécrites ; absent s'il n'y en a pas. */
  permanent?: string[];
}

export interface CollectOptions {
  /** Dossier des fichiers manuels (défaut `data/manual`). */
  manualDir?: string;
  /** Racine des chemins `files` des sources enregistrées (défaut : le dossier courant, la racine du dépôt). */
  rootDir?: string;
  /** Baisse voulue (`--accept-loss`) : sa raison laisse passer une perte de plus de 30 %, écrite au rapport. */
  acceptLoss?: string;
}

/**
 * Résultat d'une collecte ignorée parce que des pages enregistrées manquent (clone neuf, pages pas encore
 * réenregistrées). Aucune ligne d'historique : l'état de la base et le dernier résultat de chaque source ne changent pas.
 */
export function skippedResult(files: string[]): CollectResult {
  const warning = skippedSavedWarning(files);
  return { status: 'skipped', diff: null, reason: null, warnings: [warning] };
}

type Page = { url: string; body: Buffer; contentType: string };

export function recordFailure(db: Db, source: SourceFile, now: string, reason: string, previous: number): CollectResult {
  recordRun(db, {
    sourceId: source.id,
    startedAt: now,
    status: 'failed',
    coursesFound: 0,
    previousCount: previous,
    added: 0,
    removed: 0,
    modified: 0,
    failureReason: reason,
  });
  return { status: 'failed', diff: null, reason };
}

/** Ajoute avertissements, notes et lignes permanentes au résultat, seulement s'il y en a. */
export function withLines(result: CollectResult, warnings: string[], notes: string[], permanent: string[] = []): CollectResult {
  return {
    ...result,
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(notes.length > 0 ? { notes } : {}),
    ...(permanent.length > 0 ? { permanent } : {}),
  };
}

/**
 * Lignes de rapport d'une baisse voulue. Acceptée : sa raison et les codes retirés, datées à la minute (UTC), à garder
 * hors du bloc automatique (`permanent`) pour qu'une autre collecte du jour ne les efface pas. Inutile : une note du bloc.
 */
export function lossLines(
  acceptLoss: string | undefined,
  guard: GuardResult,
  removed: string[],
  now: string,
): { notes: string[]; permanent: string[] } {
  if (acceptLoss === undefined) return { notes: [], permanent: [] };
  if (!(guard.ok && guard.lossAccepted)) {
    return { notes: ['Option --accept-loss sans effet : pas de perte de plus de 30 %'], permanent: [] };
  }
  const stamp = `${now.slice(0, 16)}Z`;
  return {
    notes: [],
    permanent: [
      `${stamp} Perte acceptée (--accept-loss) : ${acceptLoss}`,
      `${stamp} Codes retirés par cette baisse voulue (${removed.length}) : ${removed.length ? removed.join(', ') : 'aucun'}`,
    ],
  };
}

/** Sources qui fournissent les codes : les sources `enrich` sont un complément et ne comptent pas pour les descriptions. */
const mainSources = (sources: SourceFile[]): SourceFile[] => sources.filter((s) => s.role !== 'enrich');

/** Vrai si toutes les sources non `enrich` de l'université déclarent n'avoir aucune description. */
function noDescriptions(sources: SourceFile[]): boolean {
  const main = mainSources(sources);
  return main.length > 0 && main.every((s) => s.descriptions === 'none');
}

/** Note de descriptions du rapport : seulement si toutes les sources non `enrich` de l'université déclarent n'en publier aucune. */
export function descriptionsNoteOf(sources: SourceFile[]): string | undefined {
  if (!noDescriptions(sources)) return undefined;
  const main = mainSources(sources);
  if (main.length === 1) return main[0].descriptionsNote;
  return main.map((s) => `${s.id} : ${s.descriptionsNote ?? ''}`).join(' ');
}

type Placement = { snapshotId: number | null; locator: { page: number; line: number } | null };

/**
 * Copie brute et position (1-based) de chaque cours, prises dans le même fichier : celles que le lecteur donne
 * (`placement`) quand la ligne contient le code, sinon la première copie où son code
 * apparaît, les pages de son adresse d'abord (plusieurs fichiers enregistrés peuvent partager une adresse), puis
 * les autres. Code introuvable : la première copie de son adresse, sans position. Une saisie manuelle donne sa
 * position elle-même. `snapshots[i]` est la copie de `pages[i]`.
 */
async function coursePlacements(
  source: SourceFile,
  pages: Page[],
  snapshots: RawSnapshot[],
  found: HostCourseInput[],
): Promise<(c: HostCourseInput) => Placement> {
  if (source.kind === 'manual') return (c) => ({ snapshotId: null, locator: c.provenance?.locator ?? null });
  const unplaced = (c: HostCourseInput): Placement => ({
    snapshotId: (snapshots.find((s) => s.url === c.sourceUrl) ?? snapshots[0])?.id ?? null,
    locator: null,
  });
  let texts: string[][][];
  try {
    texts = await Promise.all(pages.map((p) => snapshotText(p.body, p.contentType)));
  } catch {
    // Les positions ne doivent jamais faire échouer la collecte.
    return unplaced;
  }
  const result = new Map<string, Placement>();
  for (const c of found) {
    const own = [...pages.keys()].filter((i) => pages[i].url === c.sourceUrl);
    const order = [...own, ...[...pages.keys()].filter((i) => !own.includes(i))];
    let placement = unplaced(c);
    // Position fournie par le lecteur : gardée seulement si cette ligne contient bien le code ou un morceau de la description.
    const given = c.placement;
    const givenPage = given?.page ?? 1;
    if (given && texts[given.pageIndex] && lineSupportsCourse(texts[given.pageIndex], { page: givenPage, line: given.line }, c.code, c.description)) {
      result.set(c.code, { snapshotId: snapshots[given.pageIndex]?.id ?? null, locator: { page: givenPage, line: given.line } });
      continue;
    }
    for (const i of order) {
      const hit = findCode(texts[i], c.code)[0];
      if (hit) {
        placement = { snapshotId: snapshots[i]?.id ?? null, locator: hit };
        break;
      }
    }
    result.set(c.code, placement);
  }
  return (c) => result.get(c.code) ?? unplaced(c);
}

/** Pages d'une source : fichier manuel, fichiers enregistrés (sans réseau) ou pages téléchargées. */
async function sourcePages(
  db: Db,
  fetcher: PoliteFetcher,
  source: SourceFile,
  rawDir: string,
  opts?: CollectOptions,
): Promise<{ pages: Page[]; snapshots: RawSnapshot[] }> {
  if (source.kind === 'manual') {
    const path = join(opts?.manualDir ?? join('data', 'manual'), `${source.id}.json`);
    return { pages: [{ url: path, body: readFileSync(path), contentType: 'application/json' }], snapshots: [] };
  }
  if (source.kind === 'saved') {
    const saved = takeSavedSnapshots(db, source, rawDir, opts?.rootDir);
    return {
      pages: saved.map(({ snapshot, body }) => ({ url: snapshot.url, body, contentType: snapshot.contentType })),
      snapshots: saved.map((s) => s.snapshot),
    };
  }
  const snapshots: RawSnapshot[] = [];
  const pages: Page[] = [];
  for (const url of source.urls) {
    const snap = await takeSnapshot(db, fetcher, source.id, url, rawDir);
    snapshots.push(snap);
    pages.push({ url: snap.url, body: readSnapshot(snap, rawDir), contentType: snap.contentType });
  }
  return { pages, snapshots };
}

/**
 * Collecte une université avec toutes ses sources (dans l'ordre de leurs fiches) : lecture de chaque source,
 * fusion par code, garde-fous sur le résultat fusionné, puis une seule transaction. Une source qui échoue fait
 * échouer toute l'université (sauf un fichier enregistré absent : l'université est ignorée, sans rien écrire) ; un échec n'écrit que les lignes d'historique (une par source).
 */
export async function collectUniversity(
  db: Db,
  fetcher: PoliteFetcher,
  sources: SourceFile[],
  rawDir: string,
  now: string,
  opts?: CollectOptions,
): Promise<CollectResult> {
  const universityId = sources[0]?.universityId;
  if (universityId === undefined || universityId === null) throw new Error(`La source ${sources[0]?.id ?? '?'} n'a pas d'université`);
  const strange = sources.find((s) => s.universityId !== universityId);
  if (strange) throw new Error(`La source ${strange.id} n'est pas une source de l'université ${universityId}`);
  for (const source of sources) {
    upsertSource(db, { ...source, universityId, url: source.urls[0] ?? `manual:${source.id}` });
  }

  const previous = activeHostCourses(db, universityId).length;
  const several = sources.length > 1;
  const warnings: string[] = [];
  const notes: string[] = several
    ? [
        `Sources : ${sources
          .map((s) => {
            const tags = [s.kind, ...(s.role ? [s.role] : []), ...(s.priority ? [`priorité ${s.priority}`] : [])];
            return `${s.id} (${tags.join(', ')})`;
          })
          .join(', ')}`,
      ]
    : [];
  // Rien n'est écrit : chaque source garde la trace de l'échec de son université.
  const fail = (reason: string): CollectResult => {
    for (const source of sources) recordFailure(db, source, now, reason, previous);
    return withLines({ status: 'failed', diff: null, reason }, warnings, notes);
  };
  const named = (source: SourceFile, message: string): string => (several ? `${source.id} : ${message}` : message);

  // Pages enregistrées absentes : l'université est ignorée, ce n'est pas un échec.
  const absent = sources.flatMap((s) => missingSavedPages(s, opts?.rootDir).map((m) => m.file));
  if (absent.length > 0) return skippedResult(absent);

  const read: SourceCourses[] = [];
  for (const source of sources) {
    let pages: Page[];
    let snapshots: RawSnapshot[];
    let found: HostCourseInput[];
    try {
      ({ pages, snapshots } = await sourcePages(db, fetcher, source, rawDir, opts));
      found = await getReader(source.reader)(pages);
    } catch (err) {
      return fail(named(source, err instanceof Error ? err.message : String(err)));
    }
    if (source.kind === 'saved') {
      const stale = staleSavedWarning(source.id, snapshots, now);
      if (stale) warnings.push(stale);
    }

    const seen = new Set<string>();
    for (const c of found) {
      if (seen.has(c.code)) return fail(named(source, `Code de cours en double : ${c.code}`));
      seen.add(c.code);
    }

    const placementOf = await coursePlacements(source, pages, snapshots, found);
    read.push({
      sourceId: source.id,
      priority: source.priority ?? 0,
      enrich: source.role === 'enrich',
      courses: found.map((c): LocatedCourse => ({ course: c, ...placementOf(c) })),
    });
  }

  const merged = mergeCourses(read);
  for (const { sourceId, codes } of merged.ignored) {
    notes.push(`Codes ignorés de la source ${sourceId} (enrich, absents des autres sources) : ${codes.length}`);
  }
  const found = merged.courses.map((m) => m.course);
  const guard = checkGuards(found, previous, {
    descriptionsPublished: !noDescriptions(sources),
    acceptLoss: opts?.acceptLoss !== undefined,
    target: universityId,
  });
  if (!guard.ok) return fail(guard.reason);

  const byCode = new Map(merged.courses.map((m) => [m.course.code, m]));
  const diff = db.transaction(() => {
    const d = applyCollection(
      db,
      universityId,
      found,
      (c) => byCode.get(c.code)?.snapshotId ?? null,
      now,
      (c) => byCode.get(c.code)?.locator ?? null,
    );
    for (const [i, source] of sources.entries()) {
      recordRun(db, {
        sourceId: source.id,
        startedAt: now,
        status: 'ok',
        // Cours lus par cette source ; les différences sont celles de toute l'université.
        coursesFound: read[i].courses.length,
        previousCount: previous,
        added: d.added.length,
        removed: d.removed.length,
        modified: d.modified.length,
        failureReason: null,
      });
    }
    return d;
  })();
  const loss = lossLines(opts?.acceptLoss, guard, diff.removed, now);
  notes.push(...loss.notes);
  return withLines({ status: 'ok', diff, reason: null }, warnings, notes, loss.permanent);
}

/**
 * Tests seulement : collecte une université qui n'a qu'une source. Sur une université à plusieurs fiches, elle
 * désactiverait les cours des autres ; la CLI passe toujours par `collectUniversity` avec toutes les sources.
 */
export async function collectSource(
  db: Db,
  fetcher: PoliteFetcher,
  source: SourceFile,
  rawDir: string,
  now: string,
  opts?: CollectOptions,
): Promise<CollectResult> {
  return collectUniversity(db, fetcher, [source], rawDir, now, opts);
}
