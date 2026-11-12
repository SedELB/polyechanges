import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Level, Notion } from '../../shared/types.js';
import type { ModelConfig } from './embedder.js';

export const CRITERION_DIR = 'data/criterion';

export interface CriterionParams {
  /** 'v0', 'v1', ... ; 'contest-<slug>' pour un candidat du concours des modèles. */
  version: string;
  /** `library` : '@huggingface/transformers@<version exacte>'. */
  model: ModelConfig & { library: string };
  detectThreshold: number;
  bandHigh: number;
  bandLow: number;
  workloadTolerance: 0.15;
  polyWeeks: number;
  /** Niveau maximal d'une paire comparée sur le titre seul (absent : aucun plafond). */
  titleOnlyMaxLevel?: Level;
}

export interface LoadedCriterion {
  params: CriterionParams;
  notions: Record<string, Notion[]>;
  paramsHash: string;
}

const paramsSchema = z.strictObject({
  version: z.string().regex(/^(v\d+|contest-[a-z0-9]+(-[a-z0-9]+)*)$/),
  model: z.strictObject({
    slug: z.string().min(1),
    id: z.string().min(1),
    revision: z.string().min(1),
    dtype: z.literal('fp32'),
    pooling: z.enum(['mean', 'cls', 'last_token', 'sentence_embedding']),
    prefixes: z.strictObject({ notion: z.string(), passage: z.string() }),
    sizeMillions: z.number().positive(),
    library: z.string().regex(/^@huggingface\/transformers@\d+\.\d+\.\d+/),
  }),
  detectThreshold: z.number().min(0).max(1),
  bandHigh: z.number().min(0).max(1),
  bandLow: z.number().min(0).max(1),
  workloadTolerance: z.literal(0.15),
  polyWeeks: z.number().positive(),
  titleOnlyMaxLevel: z.enum(['elevee', 'moyenne', 'faible']).optional(),
});

const notionsSchema = z.record(
  z.string(),
  z.array(
    z.strictObject({
      id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
      fr: z.string().min(1),
      en: z.string().min(1),
    }),
  ),
);

/** JSON à clés triées, pour un hash qui ne dépend pas de l'ordre ni de la mise en forme. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Lit `<dir>/<version>/criterion.json` et `notions.json`. Le hash couvre les deux fichiers. */
export function loadCriterion(version: string, dir: string = CRITERION_DIR): LoadedCriterion {
  const read = (file: string): unknown => JSON.parse(readFileSync(`${dir}/${version}/${file}`, 'utf8'));
  const rawParams = read('criterion.json');
  const rawNotions = read('notions.json');
  const params = paramsSchema.parse(rawParams) as CriterionParams;
  if (params.version !== version) {
    throw new Error(`criterion.json déclare la version ${params.version} mais se trouve dans ${version}`);
  }
  const notions = notionsSchema.parse(rawNotions);
  const paramsHash = createHash('sha256')
    .update(canonical({ criterion: rawParams, notions: rawNotions }))
    .digest('hex');
  return { params, notions, paramsHash };
}
