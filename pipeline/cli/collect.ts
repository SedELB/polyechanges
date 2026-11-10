import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../db/open.js';
import { activeHostCourses } from '../db/hostCourses.js';
import { createPoliteFetcher } from '../fetch/politeFetch.js';
import { collectSource } from '../collect/collect.js';
import { writeReport } from '../collect/report.js';
import { collectPoly, polySummary } from '../poly/collectPoly.js';
import { assertOneSourcePerUniversity, loadSourceFiles } from '../collect/sourceFile.js';
import { syncUniversities } from '../partners/registry.js';
import '../readers/index.js';

async function main(): Promise<number> {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage : npm run collect -- <sourceId> | all');
    return 2;
  }
  const dataDir = 'data';
  const sources = loadSourceFiles(join(dataDir, 'sources'));
  try {
    assertOneSourcePerUniversity(sources);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  const chosen = target === 'all' ? sources : sources.filter((s) => s.id === target);
  if (chosen.length === 0) {
    console.error(`Source introuvable : ${target}`);
    return 2;
  }
  mkdirSync(dataDir, { recursive: true });
  const db = openDb(join(dataDir, 'polyechanges.sqlite'));
  try {
    syncUniversities(db);
    const fetcher = createPoliteFetcher();
    let failures = 0;
    for (const source of chosen) {
      try {
        const now = new Date().toISOString();
        const rawDir = join(dataDir, 'raw');
        const isPoly = source.kind === 'saved';
        // Les pages de Poly sont enregistrées à la main : rien n'est téléchargé sur polymtl.ca.
        const result = isPoly
          ? await collectPoly(db, source, rawDir, now)
          : await collectSource(db, fetcher, source, rawDir, now);
        const poly = isPoly ? polySummary(db) : null;
        const path = writeReport(join(dataDir, 'reports'), {
          sourceId: source.id,
          date: now.slice(0, 10),
          status: result.status,
          courseCount: poly ? poly.imported : activeHostCourses(db, source.universityId ?? undefined).length,
          diff: result.diff,
          reason: result.reason,
          descriptionsNote: source.descriptions === 'none' ? source.descriptionsNote : undefined,
          notes: poly
            ? [
                `Comparés : ${poly.compared}`,
                `Non admissibles : ${poly.ineligible}`,
                `Obligatoires : ${poly.obligatoire}`,
                `Sigles comparés : ${poly.comparedSigles.join(', ')}`,
              ]
            : undefined,
        });
        if (poly) {
          console.log(
            `${source.id} : ${poly.imported} cours importés, ${poly.compared} comparés, ${poly.ineligible} non admissibles, ${poly.obligatoire} obligatoires`,
          );
        }
        console.log(`${source.id} : ${result.status}${result.reason ? ` (${result.reason})` : ''} -> ${path}`);
        if (result.status === 'failed') failures++;
      } catch (err) {
        console.error(`${source.id} : échec inattendu (${err instanceof Error ? err.message : String(err)})`);
        failures++;
      }
    }
    return failures > 0 ? 1 : 0;
  } finally {
    db.close();
  }
}

process.exitCode = await main();
