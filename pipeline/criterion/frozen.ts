import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/** Dossier des versions du critère (même valeur que dans loadCriterion.ts). */
const DEFAULT_DIR = 'data/criterion';

/**
 * Marque de gel d'une version, versionnée à côté de ses fichiers : `data/criterion/<version>/FROZEN.json`.
 * Un fichier à part, et non un champ de criterion.json : le hachage couvre criterion.json, l'écrire dedans le changerait.
 */
export const FROZEN_FILE = 'FROZEN.json';

export interface FrozenMark {
  version: string;
  /** AAAA-MM-JJ */
  frozenAt: string;
  /** Hachage de criterion.json et notions.json au moment du gel. */
  paramsHash: string;
}

export class CriterionFrozenError extends Error {}

const markSchema = z.strictObject({
  version: z.string().regex(/^v\d+$/),
  frozenAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paramsHash: z.string().regex(/^[0-9a-f]{64}$/),
});

/** Marque de gel de la version, ou nulle si elle n'est pas gelée dans le dépôt. */
export function readFrozenMark(version: string, dir: string = DEFAULT_DIR): FrozenMark | null {
  const path = join(dir, version, FROZEN_FILE);
  if (!existsSync(path)) return null;
  const mark = markSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  if (mark.version !== version) throw new Error(`${path} déclare la version ${mark.version}`);
  return mark;
}

/** Écrit la marque de gel (fichier temporaire puis renommage). */
export function writeFrozenMark(dir: string, mark: FrozenMark): void {
  const path = join(dir, mark.version, FROZEN_FILE);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ version: mark.version, frozenAt: mark.frozenAt, paramsHash: mark.paramsHash }, null, 2)}\n`);
  renameSync(tmp, path);
}

/** Refuse une version gelée dont les fichiers ne donnent plus le hachage du gel. */
export function assertFrozenIntact(version: string, paramsHash: string, mark: FrozenMark | null, dir: string = DEFAULT_DIR): void {
  if (mark && mark.paramsHash !== paramsHash) {
    throw new CriterionFrozenError(
      `Le critère ${version} est gelé depuis le ${mark.frozenAt} (${join(dir, version, FROZEN_FILE)}) mais criterion.json ou notions.json a changé : remets-les comme au gel, ou crée une nouvelle version`,
    );
  }
}

/** Version `v<N>` gelée dans le dépôt au plus grand numéro, ou nulle. */
export function latestFrozenVersion(dir: string = DEFAULT_DIR): string | null {
  if (!existsSync(dir)) return null;
  const versions = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^v\d+$/.test(d.name) && existsSync(join(dir, d.name, FROZEN_FILE)))
    .map((d) => d.name)
    .sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
  return versions[0] ?? null;
}

/** Version que compare et exporte `npm run refresh` : toujours la dernière version gelée, l'argument ne peut que la confirmer. */
export function refreshVersion(arg: string | undefined, frozen: string | null): { version: string } | { error: string } {
  if (frozen === null) {
    return arg
      ? { version: arg }
      : { error: 'Aucune version du critère gelée dans data/criterion : indique la version à comparer et exporter (npm run refresh -- v1).' };
  }
  if (arg !== undefined && arg !== frozen) {
    return {
      error: `npm run refresh compare et exporte toujours la dernière version gelée (${frozen}), pas ${arg}. Pour une autre version : npm run compare -- ${arg} puis npm run export -- ${arg}.`,
    };
  }
  return { version: frozen };
}
