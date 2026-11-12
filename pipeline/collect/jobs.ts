import { groupByUniversity, type LoadedSourceFile, type SourceFile } from './sourceFile.js';

/** Une collecte à lancer : la source de Poly, ou une université avec toutes ses sources. */
export type CollectJob =
  | { kind: 'poly'; source: SourceFile }
  | { kind: 'university'; universityId: string; sources: SourceFile[] };

const jobId = (j: CollectJob): string => (j.kind === 'poly' ? j.source.id : j.universityId);

/**
 * Collectes désignées par la cible de `npm run collect -- <cible>` : `all` (chaque université une fois, et Poly),
 * un id d'université, ou un id de source. Une source qui partage son université avec d'autres désigne toute
 * l'université : une collecte ne désactive jamais les cours des autres sources. Cible inconnue : aucune collecte.
 */
export function collectJobs(target: string, sources: LoadedSourceFile[]): CollectJob[] {
  const universities: CollectJob[] = groupByUniversity(sources).map((g) => ({
    kind: 'university',
    universityId: g.universityId,
    sources: g.sources,
  }));
  const polys: CollectJob[] = sources.filter((s) => s.universityId === null).map((source) => ({ kind: 'poly', source }));
  if (target === 'all') return [...universities, ...polys].sort((a, b) => (jobId(a) < jobId(b) ? -1 : jobId(a) > jobId(b) ? 1 : 0));
  const byUniversity = universities.find((j) => j.kind === 'university' && j.universityId === target);
  if (byUniversity) return [byUniversity];
  const source = sources.find((s) => s.id === target);
  if (!source) return [];
  if (source.universityId === null) return polys.filter((j) => j.kind === 'poly' && j.source.id === target);
  return universities.filter((j) => j.kind === 'university' && j.universityId === source.universityId);
}

export const COLLECT_USAGE = 'Usage : npm run collect -- <universityId> | <sourceId> | all [--accept-loss "<raison>"]';

/** Lit les arguments de `npm run collect` : une cible, et au besoin `--accept-loss "<raison>"` pour une seule université. */
export function parseCollectArgs(args: string[]): { target: string; acceptLoss?: string } | { error: string } {
  let target: string | undefined;
  let acceptLoss: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--accept-loss') {
      const reason = args[i + 1];
      if (reason === undefined || reason.startsWith('--') || reason.trim() === '') {
        return { error: '--accept-loss demande une raison : npm run collect -- <universityId> --accept-loss "<raison>"' };
      }
      // Un seul mot avalerait un id (`--accept-loss kaist-kr ntu-tw`) : la raison se décrit, entre guillemets.
      if (reason.trim().split(/\s+/).length < 2) {
        return {
          error: `Raison de --accept-loss trop courte (« ${reason} ») : au moins deux mots, entre guillemets : npm run collect -- <universityId> --accept-loss "<raison>"`,
        };
      }
      acceptLoss = reason.trim();
      i++;
    } else if (arg.startsWith('--')) {
      return { error: `Option inconnue : ${arg}. ${COLLECT_USAGE}` };
    } else if (target !== undefined) {
      return { error: `Une seule cible à la fois (${target}, ${arg}). ${COLLECT_USAGE}` };
    } else {
      target = arg;
    }
  }
  if (target === undefined) return { error: COLLECT_USAGE };
  if (acceptLoss !== undefined && target === 'all') {
    return { error: '--accept-loss vaut pour une seule université à la fois : npm run collect -- <universityId> --accept-loss "<raison>"' };
  }
  return acceptLoss === undefined ? { target } : { target, acceptLoss };
}
