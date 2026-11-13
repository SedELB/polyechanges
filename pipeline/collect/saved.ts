import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Db } from '../db/open.js';
import { missingSavedFile, readSnapshot, savedFileType, takeSavedSnapshot, type RawSnapshot } from '../fetch/snapshots.js';
import type { SourceFile } from './sourceFile.js';

/** Au-delà de cet âge, les pages enregistrées sont à réenregistrer (procédure annuelle). */
export const SAVED_MAX_AGE_DAYS = 300;

/** Fichiers d'une source enregistrée qui manquent sur le disque, avec l'adresse à enregistrer. Vide pour toute autre source. */
export function missingSavedPages(source: SourceFile, rootDir?: string): { file: string; url: string }[] {
  if (source.kind !== 'saved' || !source.files) return [];
  return source.files
    .map((file, i) => ({ file, url: source.urls[i] }))
    .filter(({ file }) => !existsSync(rootDir === undefined ? file : resolve(rootDir, file)));
}

/** Ligne de rapport et de sortie des pages absentes (université ignorée) : « pages à réenregistrer depuis un navigateur : <liste> ». */
export function skippedSavedWarning(files: string[]): string {
  return `Pages à réenregistrer depuis un navigateur : ${files.join(', ')}`;
}

export interface SavedPage {
  snapshot: RawSnapshot;
  body: Buffer;
}

/**
 * Copie chaque fichier d'une source enregistrée dans le magasin de copies brutes, comme un instantané, sans
 * aucune requête réseau. Les fichiers sont tous vérifiés d'abord : un fichier absent (ou d'un type inconnu) fait
 * échouer la source avant toute copie, avec un message qui le nomme.
 */
export function takeSavedSnapshots(db: Db, source: SourceFile, rawDir: string, rootDir?: string): SavedPage[] {
  if (source.kind !== 'saved' || !source.files) throw new Error(`La source ${source.id} n'est pas une page enregistrée`);
  const files = source.files;
  for (const file of files) savedFileType(file);
  const missing = missingSavedPages(source, rootDir);
  if (missing.length > 0) throw new Error(missing.map(({ file, url }) => missingSavedFile(file, url)).join(' '));
  return files.map((file, i) => {
    const snapshot = takeSavedSnapshot(db, source.id, source.urls[i], file, rawDir, rootDir);
    return { snapshot, body: readSnapshot(snapshot, rawDir) };
  });
}

/**
 * Avertissement pour le rapport quand la plus ancienne page enregistrée d'une source date de plus de
 * `SAVED_MAX_AGE_DAYS` jours (date UTC du fichier) ; nul sinon.
 */
export function staleSavedWarning(sourceId: string, snapshots: RawSnapshot[], now: string): string | null {
  if (snapshots.length === 0) return null;
  const oldest = snapshots.map((s) => s.fetchedAt).sort()[0];
  if (Date.parse(now) - Date.parse(oldest) <= SAVED_MAX_AGE_DAYS * 24 * 60 * 60 * 1000) return null;
  return `Pages enregistrées le ${oldest.slice(0, 10)} : à réenregistrer depuis un navigateur (source ${sourceId})`;
}
