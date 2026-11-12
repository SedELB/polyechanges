import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
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

/** Extension d'un fichier enregistré : type de contenu et extension de sa copie brute. */
const SAVED_TYPES: Readonly<Record<string, { contentType: string; ext: string }>> = {
  '.html': { contentType: 'text/html', ext: 'html' },
  '.htm': { contentType: 'text/html', ext: 'html' },
  '.pdf': { contentType: 'application/pdf', ext: 'pdf' },
  '.txt': { contentType: 'text/plain', ext: 'txt' },
};

/** Type d'un fichier enregistré d'après son extension ; une autre extension est refusée. */
export function savedFileType(file: string): { contentType: string; ext: string } {
  const type = SAVED_TYPES[extname(file).toLowerCase()];
  if (!type) throw new Error(`Type de fichier enregistré non pris en charge : ${file} (attendu .html, .htm, .pdf ou .txt)`);
  return type;
}

/** Message d'un fichier enregistré absent : le fichier, la page d'origine, et quoi faire. */
export function missingSavedFile(file: string, url: string): string {
  return `Fichier enregistré absent : ${file}. Enregistre la page ${url} depuis un navigateur (« Page Web, complète » ou « Enregistrer au format PDF ») sous ce nom.`;
}

/**
 * Range la copie d'une page enregistrée à la main depuis un navigateur, comme une page téléchargée :
 * `<rawDir>/<sourceId>/<sha256>.<html|pdf|txt>`, avec le type de contenu de son extension. La date de collecte est
 * la date de modification du fichier. `file` se lit depuis `rootDir` (défaut : le dossier courant). Aucune requête réseau.
 */
export function takeSavedSnapshot(
  db: Db,
  sourceId: string,
  url: string,
  file: string,
  rawDir: string,
  rootDir?: string,
): RawSnapshot {
  const { contentType, ext } = savedFileType(file);
  const onDisk = rootDir === undefined ? file : resolve(rootDir, file);
  if (!existsSync(onDisk)) throw new Error(missingSavedFile(file, url));
  const body = readFileSync(onDisk);
  const sha256 = createHash('sha256').update(body).digest('hex');
  const path = `${sourceId}/${sha256}.${ext}`;
  const full = join(rawDir, path);
  if (!existsSync(full)) {
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return insertSnapshot(db, {
    sourceId,
    url,
    fetchedAt: statSync(onDisk).mtime.toISOString(),
    sha256,
    path,
    contentType,
  });
}
