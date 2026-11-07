import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const sourceFileSchema = z.object({
  id: z.string().min(1),
  universityId: z.string().min(1),
  kind: z.enum(['html', 'pdf', 'manual']),
  urls: z.array(z.string().url()),
  reader: z.string().min(1),
});

export type SourceFile = z.infer<typeof sourceFileSchema>;

/** Valide une fiche de source. Une source non manuelle doit avoir au moins une adresse. */
export function parseSourceFile(raw: unknown): SourceFile {
  const source = sourceFileSchema.parse(raw);
  if (source.kind !== 'manual' && source.urls.length === 0) {
    throw new Error(`La fiche de source ${source.id} n'a aucune adresse`);
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
    const other = byUniversity.get(s.universityId);
    if (other !== undefined) {
      throw new Error(
        `Les fiches de source ${other} et ${s.id} ont le même universityId (${s.universityId}) : une seule fiche par université`,
      );
    }
    byUniversity.set(s.universityId, s.id);
  }
}
