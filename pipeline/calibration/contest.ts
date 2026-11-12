import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Notion } from '../../shared/types.js';
import type { ModelConfig } from '../criterion/embedder.js';
import { CRITERION_DIR, loadCriterion, type CriterionParams } from '../criterion/loadCriterion.js';

/** Un `ModelConfig` par candidat du concours, révision épinglée par hachage de commit. */
export const candidatesDir = (criterionDir: string = CRITERION_DIR): string => join(criterionDir, 'candidates');
export const contestVersion = (slug: string): string => `contest-${slug}`;

const candidateSchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  id: z.string().min(1),
  revision: z.string().regex(/^[0-9a-f]{40}$/, 'révision : hachage de commit de 40 caractères'),
  dtype: z.literal('fp32'),
  pooling: z.enum(['mean', 'cls', 'last_token', 'sentence_embedding']),
  prefixes: z.strictObject({ notion: z.string(), passage: z.string() }),
  sizeMillions: z.number().positive(),
});

export function readCandidate(slug: string, criterionDir: string = CRITERION_DIR): ModelConfig {
  const raw: unknown = JSON.parse(readFileSync(join(candidatesDir(criterionDir), `${slug}.json`), 'utf8'));
  const candidate = candidateSchema.parse(raw);
  if (candidate.slug !== slug) throw new Error(`Le fichier du candidat ${slug} déclare le slug ${candidate.slug}`);
  return candidate;
}

/** Candidats présents dans `data/criterion/candidates/`, par ordre alphabétique. */
export function candidateSlugs(criterionDir: string = CRITERION_DIR): string[] {
  const dir = candidatesDir(criterionDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

/** Versions du concours déjà préparées sur le disque. */
export function contestVersionsOnDisk(criterionDir: string = CRITERION_DIR): string[] {
  return readdirSync(criterionDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('contest-') && existsSync(join(criterionDir, d.name, 'criterion.json')))
    .map((d) => d.name)
    .sort();
}

/**
 * Prépare `contest-<slug>` : grilles et seuils de v0 (ou grilles corrigées données), modèle du candidat.
 * Seul le modèle change d'un candidat à l'autre.
 */
export function prepareContest(slug: string, criterionDir: string, library: string, notionsFile?: string): string {
  const candidate = readCandidate(slug, criterionDir);
  const base = loadCriterion('v0', criterionDir).params;
  const version = contestVersion(slug);
  const params: CriterionParams = {
    version,
    model: { ...candidate, library },
    detectThreshold: base.detectThreshold,
    bandHigh: base.bandHigh,
    bandLow: base.bandLow,
    workloadTolerance: base.workloadTolerance,
    polyWeeks: base.polyWeeks,
  };
  const out = join(criterionDir, version);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'criterion.json'), `${JSON.stringify(params, null, 2)}\n`, 'utf8');
  writeFileSync(join(out, 'notions.json'), readFileSync(notionsFile ?? join(criterionDir, 'v0', 'notions.json')));
  // Relit le tout : un candidat mal formé échoue ici, pas au milieu du calcul.
  loadCriterion(version, criterionDir);
  return out;
}

export interface ContestRun {
  /** Clé de l'embedder (`id@revision@dtype@réglages`) mesuré. */
  modelKey: string;
  pairs: number;
  /** Chargement du modèle, téléchargement compris au premier passage. */
  loadSeconds: number;
  /** Calcul des paires ; la première mesure part d'un cache de vecteurs vide. */
  compareSeconds: number;
  /** Textes absents du cache de vecteurs, donc calculés par le modèle pendant ce passage. */
  embeddedTexts: number;
  /** Taille du modèle sur le disque, null si son dossier est introuvable. */
  diskBytes: number | null;
}

export function readRuns(file: string): Record<string, ContestRun> {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, ContestRun>) : {};
}

/** Enregistre un passage ; un même modèle garde sa première mesure, faite avec le cache de vecteurs vide. */
export function recordRun(file: string, slug: string, run: ContestRun): void {
  const runs = readRuns(file);
  if (runs[slug]?.modelKey === run.modelKey) return;
  runs[slug] = run;
  const sorted = Object.fromEntries(Object.keys(runs).sort().map((k) => [k, runs[k]]));
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
}

/** Taille d'un dossier, sous-dossiers compris ; null s'il n'existe pas. */
export function directorySize(dir: string): number | null {
  if (!existsSync(dir)) return null;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? (directorySize(path) ?? 0) : statSync(path).size;
  }
  return total;
}

/** Décrit en une phrase l'écart entre les grilles du concours et celles de v0. */
export function gridsDescription(grids: Record<string, Notion[]>, v0: Record<string, Notion[]>): string {
  const same = (a: Notion, b: Notion | undefined) => !!b && a.id === b.id && a.fr === b.fr && a.en === b.en;
  const courses = [...new Set([...Object.keys(grids), ...Object.keys(v0)])].sort();
  let changed = 0;
  const touched: string[] = [];
  for (const sigle of courses) {
    const a = grids[sigle] ?? [];
    const b = v0[sigle] ?? [];
    const n = Math.max(a.length, b.length) - a.filter((x, i) => same(x, b[i])).length;
    if (n > 0) {
      changed += n;
      touched.push(sigle);
    }
  }
  if (changed === 0) return 'Grilles de notions : celles de v0.';
  const notions = `${changed} notion${changed > 1 ? 's' : ''}`;
  return `Grilles de notions : celles de v0 corrigées une fois après le premier calcul de l’accord (${notions} dans ${touched.length} cours : ${touched.join(', ')}).`;
}
