import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db/open.js';
import { activeHostCourses, applyCollection, type CollectionDiff } from '../db/hostCourses.js';
import { recordRun } from '../db/runs.js';
import { readSnapshot, takeSnapshot, type RawSnapshot } from '../fetch/snapshots.js';
import type { PoliteFetcher } from '../fetch/politeFetch.js';
import type { HostCourseInput } from '../../shared/types.js';
import { findCode, snapshotText } from '../provenance/snapshotText.js';
import { checkGuards, type GuardResult } from './guards.js';
import { mergeCourses, type LocatedCourse, type SourceCourses } from './merge.js';
import { getReader } from './readers.js';
import { staleSavedWarning, takeSavedSnapshots } from './saved.js';
import type { SourceFile } from './sourceFile.js';

export type { CollectionDiff } from '../db/hostCourses.js';
export { lastRun } from '../db/runs.js';
export { activeHostCourses } from '../db/hostCourses.js';

export interface CollectResult {
  status: 'ok' | 'failed';
  diff: CollectionDiff | null;
  reason: string | null;
  /** Lignes à écrire en tête du rapport (pages enregistrées à réenregistrer) ; absent s'il n'y en a pas. */
  warnings?: string[];
  /** Lignes de détail du rapport (sources, codes ignorés, perte acceptée) ; absent s'il n'y en a pas. */
  notes?: string[];
}

export interface CollectOptions {
  /** Dossier des fichiers manuels (défaut `data/manual`). */
  manualDir?: string;
  /** Racine des chemins `files` des sources enregistrées (défaut : le dossier courant, la racine du dépôt). */
  rootDir?: string;
  /** Baisse voulue (`--accept-loss`) : sa raison laisse passer une perte de plus de 30 %, écrite au rapport. */
  acceptLoss?: string;
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

/** Ajoute avertissements et notes au résultat, seulement s'il y en a. */
function withLines(result: CollectResult, warnings: string[], notes: string[]): CollectResult {
  return { ...result, ...(warnings.length > 0 ? { warnings } : {}), ...(notes.length > 0 ? { notes } : {}) };
}

/** Lignes de rapport d'une baisse voulue : sa raison et les codes retirés, ou le constat qu'elle n'a servi à rien. */
export function lossNotes(acceptLoss: string | undefined, guard: GuardResult, removed: string[]): string[] {
  if (acceptLoss === undefined) return [];
  if (!(guard.ok && guard.lossAccepted)) return ['Option --accept-loss sans effet : pas de perte de plus de 30 %'];
  return [
    `Perte acceptée (--accept-loss) : ${acceptLoss}`,
    `Codes retirés par cette baisse voulue (${removed.length}) : ${removed.length ? removed.join(', ') : 'aucun'}`,
  ];
}

/** Note de descriptions du rapport : seulement si toutes les sources de l'université déclarent n'en publier aucune. */
export function descriptionsNoteOf(sources: SourceFile[]): string | undefined {
  if (!sources.every((s) => s.descriptions === 'none')) return undefined;
  if (sources.length === 1) return sources[0].descriptionsNote;
  return sources.map((s) => `${s.id} : ${s.descriptionsNote ?? ''}`).join(' ');
}

/**
 * Position (1-based) du code de chaque cours dans le texte de sa copie brute : la page d'où il vient
 * d'abord, puis les autres. Nulle si le code n'y est pas ; une saisie manuelle donne sa position elle-même.
 */
async function courseLocators(
  source: SourceFile,
  pages: Page[],
  found: HostCourseInput[],
): Promise<(c: HostCourseInput) => { page: number; line: number } | null> {
  if (source.kind === 'manual') return (c) => c.provenance?.locator ?? null;
  const texts = await Promise.all(pages.map((p) => snapshotText(p.body, p.contentType)));
  const result = new Map<string, { page: number; line: number } | null>();
  for (const c of found) {
    const own = pages.findIndex((p) => p.url === c.sourceUrl);
    const order = [...(own >= 0 ? [own] : []), ...texts.keys()].filter((v, i, a) => a.indexOf(v) === i);
    let hit: { page: number; line: number } | null = null;
    for (const i of order) {
      hit = findCode(texts[i], c.code)[0] ?? null;
      if (hit) break;
    }
    result.set(c.code, hit);
  }
  return (c) => result.get(c.code) ?? null;
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
 * échouer toute l'université ; un échec n'écrit que les lignes d'historique (une par source).
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
    db.prepare(
      `INSERT INTO sources (id, university_id, kind, url, reader) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET university_id = excluded.university_id, kind = excluded.kind,
         url = excluded.url, reader = excluded.reader`,
    ).run(source.id, universityId, source.kind, source.urls[0] ?? `manual:${source.id}`, source.reader);
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

  const read: SourceCourses[] = [];
  for (const source of sources) {
    let pages: Page[];
    let snapshots: RawSnapshot[];
    let found: HostCourseInput[];
    try {
      ({ pages, snapshots } = await sourcePages(db, fetcher, source, rawDir, opts));
      found = getReader(source.reader)(pages);
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

    let locatorFor: (c: HostCourseInput) => { page: number; line: number } | null;
    try {
      locatorFor = await courseLocators(source, pages, found);
    } catch {
      locatorFor = () => null;
    }
    const snapshotFor = (c: HostCourseInput): number | null =>
      snapshots.find((s) => s.url === c.sourceUrl)?.id ?? snapshots[0]?.id ?? null;
    read.push({
      sourceId: source.id,
      priority: source.priority ?? 0,
      enrich: source.role === 'enrich',
      courses: found.map((c): LocatedCourse => ({ course: c, snapshotId: snapshotFor(c), locator: locatorFor(c) })),
    });
  }

  const merged = mergeCourses(read);
  for (const { sourceId, codes } of merged.ignored) {
    notes.push(`Codes ignorés de la source ${sourceId} (enrich, absents des autres sources) : ${codes.length}`);
  }
  const found = merged.courses.map((m) => m.course);
  const guard = checkGuards(found, previous, {
    descriptionsPublished: !sources.every((s) => s.descriptions === 'none'),
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
  notes.push(...lossNotes(opts?.acceptLoss, guard, diff.removed));
  return withLines({ status: 'ok', diff, reason: null }, warnings, notes);
}

/** Collecte une université qui n'a qu'une source. */
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
