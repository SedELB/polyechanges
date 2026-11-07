import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Db } from '../db/open.js';
import { insertSnapshot, type SnapshotRow } from '../db/snapshots.js';
import type { PoliteFetcher } from './politeFetch.js';

export type RawSnapshot = SnapshotRow;

/** Télécharge `url`, range la copie brute sous `<rawDir>/<sourceId>/<sha256>.<ext>` et enregistre une ligne `snapshots`. */
export async function takeSnapshot(
  db: Db,
  fetcher: PoliteFetcher,
  sourceId: string,
  url: string,
  rawDir: string,
): Promise<RawSnapshot> {
  const { body, contentType, url: finalUrl } = await fetcher.get(url);
  const sha256 = createHash('sha256').update(body).digest('hex');
  const ext = contentType.toLowerCase().includes('pdf') ? 'pdf' : 'html';
  const path = `${sourceId}/${sha256}.${ext}`;
  const full = join(rawDir, path);
  if (!existsSync(full)) {
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return insertSnapshot(db, {
    sourceId,
    url: finalUrl,
    fetchedAt: new Date().toISOString(),
    sha256,
    path,
    contentType,
  });
}

export function readSnapshot(snapshot: RawSnapshot, rawDir: string): Buffer {
  return readFileSync(join(rawDir, snapshot.path));
}

/**
 * Range la copie d'une page enregistrée à la main depuis un navigateur, comme une page téléchargée :
 * `<rawDir>/<sourceId>/<sha256>.html`. La date de collecte est la date de modification du fichier.
 */
export function takeSavedSnapshot(db: Db, sourceId: string, url: string, file: string, rawDir: string): RawSnapshot {
  const body = readFileSync(file);
  const sha256 = createHash('sha256').update(body).digest('hex');
  const path = `${sourceId}/${sha256}.html`;
  const full = join(rawDir, path);
  if (!existsSync(full)) {
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return insertSnapshot(db, {
    sourceId,
    url,
    fetchedAt: statSync(file).mtime.toISOString(),
    sha256,
    path,
    contentType: 'text/html',
  });
}
