import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../db/open.js';
import { activeHostCourses } from '../db/hostCourses.js';
import { createPoliteFetcher } from '../fetch/politeFetch.js';
import { collectUniversity, descriptionsNoteOf, type CollectResult } from '../collect/collect.js';
import { collectJobs, parseCollectArgs, type CollectJob } from '../collect/jobs.js';
import { writeReport } from '../collect/report.js';
import { emptySkippedWarning } from '../collect/saved.js';
import { collectPoly, polySummary } from '../poly/collectPoly.js';
import { loadSourceFiles } from '../collect/sourceFile.js';
import { syncUniversities } from '../partners/registry.js';
import '../readers/index.js';

async function main(): Promise<number> {
  const args = parseCollectArgs(process.argv.slice(2));
  if ('error' in args) {
    console.error(args.error);
    return 2;
  }
  const { target, acceptLoss } = args;
  const dataDir = 'data';
  let jobs: CollectJob[];
  try {
    jobs = collectJobs(target, loadSourceFiles(join(dataDir, 'sources')));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  if (jobs.length === 0) {
    console.error(`Université ou source introuvable : ${target}`);
    return 2;
  }
  mkdirSync(dataDir, { recursive: true });
  const db = openDb(join(dataDir, 'polyechanges.sqlite'));
  try {
    syncUniversities(db);
    const fetcher = createPoliteFetcher();
    let failures = 0;
    // Un rapport par université, toutes ses sources ensemble (et un pour Poly).
    for (const job of jobs) {
      const id = job.kind === 'poly' ? job.source.id : job.universityId;
      try {
        const now = new Date().toISOString();
        const rawDir = join(dataDir, 'raw');
        let result: CollectResult;
        let courseCount: number;
        let notes: string[];
        let descriptionsNote: string | undefined;
        if (job.kind === 'poly') {
          // Les pages de Poly sont enregistrées à la main : rien n'est téléchargé sur polymtl.ca.
          result = await collectPoly(db, job.source, rawDir, now, { acceptLoss });
          const poly = polySummary(db);
          courseCount = poly.imported;
          notes = [
            `Comparés : ${poly.compared}`,
            `Non admissibles : ${poly.ineligible}`,
            `Obligatoires : ${poly.obligatoire}`,
            `Sigles comparés : ${poly.comparedSigles.join(', ')}`,
            ...(result.notes ?? []),
          ];
          descriptionsNote = undefined;
          console.log(
            `${id} : ${poly.imported} cours importés, ${poly.compared} comparés, ${poly.ineligible} non admissibles, ${poly.obligatoire} obligatoires`,
          );
        } else {
          result = await collectUniversity(db, fetcher, job.sources, rawDir, now, { acceptLoss });
          courseCount = activeHostCourses(db, job.universityId).length;
          notes = result.notes ?? [];
          descriptionsNote = descriptionsNoteOf(job.sources);
        }
        // Ignorée et rien en base : dit en tête que le site montrera « catalogue non lu » (ou que l'export sera refusé, pour Poly).
        const empty = result.status === 'skipped' ? emptySkippedWarning(job.kind === 'poly' ? 'poly' : 'university', courseCount) : null;
        if (empty) result = { ...result, warnings: [empty, ...(result.warnings ?? [])] };
        const path = writeReport(join(dataDir, 'reports'), {
          sourceId: id,
          date: now.slice(0, 10),
          status: result.status,
          courseCount,
          diff: result.diff,
          reason: result.reason,
          descriptionsNote,
          notes: notes.length > 0 ? notes : undefined,
          warnings: result.warnings,
          permanent: result.permanent,
        });
        for (const w of result.warnings ?? []) console.warn(`${id} : ${w}`);
        console.log(`${id} : ${result.status}${result.reason ? ` (${result.reason})` : ''} -> ${path}`);
        if (result.status === 'failed') failures++;
      } catch (err) {
        console.error(`${id} : échec inattendu (${err instanceof Error ? err.message : String(err)})`);
        failures++;
      }
    }
    return failures > 0 ? 1 : 0;
  } finally {
    db.close();
  }
}

process.exitCode = await main();
