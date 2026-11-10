import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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
  /** Source `saved` seulement : un fichier par adresse, dans le même ordre. */
  files: z.array(z.string().min(1)).optional(),
  reader: z.string().min(1),
  /** `none` : la source ne publie aucune description, seulement des titres. */
  descriptions: z.literal('none').optional(),
  /** Explication en français, obligatoire quand `descriptions` vaut `none`. */
  descriptionsNote: z.string().optional(),
});

export type SourceFile = z.infer<typeof sourceFileSchema>;

/** Valide une fiche de source. Une source non manuelle doit avoir au moins une adresse. */
export function parseSourceFile(raw: unknown): SourceFile {
  const source = sourceFileSchema.parse(raw);
  if (source.kind !== 'manual' && source.urls.length === 0) {
    throw new Error(`La fiche de source ${source.id} n'a aucune adresse`);
  }
  if (source.kind === 'saved' && (source.files === undefined || source.files.length !== source.urls.length)) {
    throw new Error(`La fiche de source ${source.id} (saved) doit lister un fichier par adresse`);
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
export function loadSourceFiles(dir: string): SourceFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => parseSourceFile(JSON.parse(readFileSync(join(dir, f), 'utf8'))));
}

/** Une seule fiche par université (une fiche peut lister plusieurs adresses). */
export function assertOneSourcePerUniversity(sources: SourceFile[]): void {
  const byUniversity = new Map<string, string>();
  for (const s of sources) {
    if (s.universityId === null) continue;
    const other = byUniversity.get(s.universityId);
    if (other !== undefined) {
      throw new Error(
        `Les fiches de source ${other} et ${s.id} ont le même universityId (${s.universityId}) : une seule fiche par université`,
      );
    }
    byUniversity.set(s.universityId, s.id);
  }
}
