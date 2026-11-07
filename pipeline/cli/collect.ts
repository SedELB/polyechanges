import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../db/open.js';
import { activeHostCourses } from '../db/hostCourses.js';
import { createPoliteFetcher } from '../fetch/politeFetch.js';
import { collectSource } from '../collect/collect.js';
import { writeReport } from '../collect/report.js';
import { loadSourceFiles } from '../collect/sourceFile.js';

async function main(): Promise<number> {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage : npm run collect -- <sourceId> | all');
    return 2;
  }
  const dataDir = 'data';
  const sources = loadSourceFiles(join(dataDir, 'sources'));
  const chosen = target === 'all' ? sources : sources.filter((s) => s.id === target);
  if (chosen.length === 0) {
    console.error(`Source introuvable : ${target}`);
    return 2;
  }
  mkdirSync(dataDir, { recursive: true });
  const db = openDb(join(dataDir, 'polyechanges.sqlite'));
  const fetcher = createPoliteFetcher();
  let failures = 0;
  for (const source of chosen) {
    const now = new Date().toISOString();
    const result = await collectSource(db, fetcher, source, join(dataDir, 'raw'), now);
    const path = writeReport(join(dataDir, 'reports'), {
      sourceId: source.id,
      date: now.slice(0, 10),
      status: result.status,
      courseCount: activeHostCourses(db, source.universityId).length,
      diff: result.diff,
      reason: result.reason,
    });
    console.log(`${source.id} : ${result.status}${result.reason ? ` (${result.reason})` : ''} -> ${path}`);
    if (result.status === 'failed') failures++;
  }
  db.close();
  return failures > 0 ? 1 : 0;
}

process.exitCode = await main();
