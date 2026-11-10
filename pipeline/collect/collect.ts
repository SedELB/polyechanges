import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db/open.js';
import { activeHostCourses, applyCollection, type CollectionDiff } from '../db/hostCourses.js';
import { recordRun } from '../db/runs.js';
import { readSnapshot, takeSnapshot, type RawSnapshot } from '../fetch/snapshots.js';
import type { PoliteFetcher } from '../fetch/politeFetch.js';
import type { HostCourseInput } from '../../shared/types.js';
import { findCode, snapshotText } from '../provenance/snapshotText.js';
import { checkGuards } from './guards.js';
import { getReader } from './readers.js';
import type { SourceFile } from './sourceFile.js';

export type { CollectionDiff } from '../db/hostCourses.js';
export { lastRun } from '../db/runs.js';
export { activeHostCourses } from '../db/hostCourses.js';

export interface CollectResult {
  status: 'ok' | 'failed';
  diff: CollectionDiff | null;
  reason: string | null;
}

export interface CollectOptions {
  /** Dossier des fichiers manuels (défaut `data/manual`). */
  manualDir?: string;
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

/**
 * Collecte une source : téléchargement, lecture, garde-fous, puis une seule transaction.
 * Un échec n'écrit que la ligne d'historique de la collecte.
 */
export async function collectSource(
  db: Db,
  fetcher: PoliteFetcher,
  source: SourceFile,
  rawDir: string,
  now: string,
  opts?: CollectOptions,
): Promise<CollectResult> {
  if (source.universityId === null) throw new Error(`La source ${source.id} n'a pas d'université`);
  const universityId = source.universityId;
  db.prepare(
    `INSERT INTO sources (id, university_id, kind, url, reader) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET university_id = excluded.university_id, kind = excluded.kind,
       url = excluded.url, reader = excluded.reader`,
  ).run(source.id, universityId, source.kind, source.urls[0] ?? `manual:${source.id}`, source.reader);

  const previous = activeHostCourses(db, universityId).length;
  let found: HostCourseInput[];
  const snapshots: RawSnapshot[] = [];
  const pages: Page[] = [];
  try {
    if (source.kind === 'manual') {
      const path = join(opts?.manualDir ?? join('data', 'manual'), `${source.id}.json`);
      pages.push({ url: path, body: readFileSync(path), contentType: 'application/json' });
    } else {
      for (const url of source.urls) {
        const snap = await takeSnapshot(db, fetcher, source.id, url, rawDir);
        snapshots.push(snap);
        pages.push({ url: snap.url, body: readSnapshot(snap, rawDir), contentType: snap.contentType });
      }
    }
    found = getReader(source.reader)(pages);
  } catch (err) {
    return recordFailure(db, source, now, err instanceof Error ? err.message : String(err), previous);
  }

  const seen = new Set<string>();
  for (const c of found) {
    if (seen.has(c.code)) return recordFailure(db, source, now, `Code de cours en double : ${c.code}`, previous);
    seen.add(c.code);
  }

  const guard = checkGuards(found, previous, { descriptionsPublished: source.descriptions !== 'none' });
  if (!guard.ok) return recordFailure(db, source, now, guard.reason, previous);

  const snapshotFor = (c: HostCourseInput): number | null =>
    snapshots.find((s) => s.url === c.sourceUrl)?.id ?? snapshots[0]?.id ?? null;

  let locatorFor: (c: HostCourseInput) => { page: number; line: number } | null;
  try {
    locatorFor = await courseLocators(source, pages, found);
  } catch {
    locatorFor = () => null;
  }

  const diff = db.transaction(() => {
    const d = applyCollection(db, universityId, found, snapshotFor, now, locatorFor);
    recordRun(db, {
      sourceId: source.id,
      startedAt: now,
      status: 'ok',
      coursesFound: found.length,
      previousCount: previous,
      added: d.added.length,
      removed: d.removed.length,
      modified: d.modified.length,
      failureReason: null,
    });
    return d;
  })();
  return { status: 'ok', diff, reason: null };
}
