import { readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { z } from 'zod';

/** Lecteur de la source de Poly : la seule fiche sans université. */
export const POLY_READER = 'poly';

const sourceFileSchema = z.object({
  id: z.string().min(1),
  /** Nul seulement pour la source de Poly. */
  universityId: z.string().min(1).nullable(),
  /** `saved` : page enregistrée à la main depuis un navigateur, jamais téléchargée par le pipeline. */
  kind: z.enum(['html', 'pdf', 'manual', 'saved']),
  urls: z.array(z.string().url()),
  /**
   * Source `saved` seulement : un fichier par adresse, dans le même ordre, en chemin depuis la racine du dépôt
   * (sous `data/saved/<universityId>/` pour une université d'accueil). `.html`/`.htm`, `.pdf` ou `.txt`.
   */
  files: z.array(z.string().min(1)).optional(),
  reader: z.string().min(1),
  /** Plus grand = plus fiable pour les champs courts quand plusieurs sources donnent un même code (défaut 0). */
  priority: z.number().int().optional(),
  /** `enrich` : les cours de la source ne créent aucun code, ils complètent ceux des autres sources de l'université. */
  role: z.literal('enrich').optional(),
  /** `none` : la source ne publie aucune description, seulement des titres. */
  descriptions: z.literal('none').optional(),
  /** Explication en français, obligatoire quand `descriptions` vaut `none`. */
  descriptionsNote: z.string().optional(),
});

export type SourceFile = z.infer<typeof sourceFileSchema>;

/** Une fiche lue dans `data/sources/`, avec son nom de fichier (il fixe l'ordre des sources d'une université). */
export type LoadedSourceFile = SourceFile & { fileName: string };

/** Vrai si `file` (chemin depuis la racine du dépôt) est sous `data/saved/<universityId>/`, sans remonter d'un dossier. */
function underSavedDir(file: string, universityId: string): boolean {
  const normalized = posix.normalize(file.replace(/\\/g, '/'));
  return normalized.startsWith(`data/saved/${universityId}/`) && !file.replace(/\\/g, '/').split('/').includes('..');
}

/** Valide une fiche de source. Une source non manuelle doit avoir au moins une adresse. */
export function parseSourceFile(raw: unknown): SourceFile {
  const source = sourceFileSchema.parse(raw);
  if (source.kind !== 'manual' && source.urls.length === 0) {
    throw new Error(`La fiche de source ${source.id} n'a aucune adresse`);
  }
  if (source.kind === 'saved' && (source.files === undefined || source.files.length !== source.urls.length)) {
    throw new Error(`La fiche de source ${source.id} (saved) doit lister un fichier par adresse`);
  }
  if (source.kind === 'saved' && source.universityId !== null) {
    for (const f of source.files ?? []) {
      if (!underSavedDir(f, source.universityId)) {
        throw new Error(`La fiche de source ${source.id} : ${f} doit être sous data/saved/${source.universityId}/`);
      }
    }
  }
  if (source.descriptions === 'none' && (source.descriptionsNote === undefined || source.descriptionsNote.trim() === '')) {
    throw new Error(`La fiche de source ${source.id} (descriptions: none) doit avoir une descriptionsNote`);
  }
  if (source.universityId === null && source.reader !== POLY_READER) {
    throw new Error(`La fiche de source ${source.id} n'a pas d'université : seule la source de Poly peut en être dépourvue`);
  }
  return source;
}

/** Charge toutes les fiches `*.json` d'un dossier, par ordre alphabétique de nom de fichier. */
export function loadSourceFiles(dir: string): LoadedSourceFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ ...parseSourceFile(JSON.parse(readFileSync(join(dir, f), 'utf8'))), fileName: f }));
}

export interface UniversitySources {
  universityId: string;
  /** Dans l'ordre de collecte : la fiche `<universityId>.json` d'abord, puis l'ordre alphabétique des noms de fichier. */
  sources: LoadedSourceFile[];
}

/**
 * Regroupe les fiches par université (la source de Poly à part), par ordre d'université. Refuse deux fiches de même
 * id et une université dont toutes les fiches sont `enrich` (aucune ne fournirait de code).
 */
export function groupByUniversity(sources: LoadedSourceFile[]): UniversitySources[] {
  const byId = new Map<string, LoadedSourceFile>();
  for (const s of sources) {
    const other = byId.get(s.id);
    if (other) throw new Error(`Les fiches ${other.fileName} et ${s.fileName} ont le même id (${s.id}) : un id par fiche`);
    byId.set(s.id, s);
  }
  const groups = new Map<string, LoadedSourceFile[]>();
  for (const s of sources) {
    if (s.universityId === null) continue;
    groups.set(s.universityId, [...(groups.get(s.universityId) ?? []), s]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([universityId, list]) => {
      if (list.every((s) => s.role === 'enrich')) {
        throw new Error(`L'université ${universityId} n'a que des sources enrich : il lui faut au moins une source qui fournit les codes`);
      }
      const main = `${universityId}.json`;
      const ordered = [...list].sort((a, b) =>
        a.fileName === main ? -1 : b.fileName === main ? 1 : a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0,
      );
      return { universityId, sources: ordered };
    });
}
