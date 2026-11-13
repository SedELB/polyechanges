import { compareVersion } from '../compare/compare.js';
import { createLocalEmbedder } from '../criterion/embedder.js';
import { modelsDir } from '../criterion/modelsDir.js';
import { openDb } from '../db/open.js';
import { syncUniversities } from '../partners/registry.js';

async function main(): Promise<number> {
  const version = process.argv[2];
  if (!version) {
    console.error('Usage : npm run compare -- <version>   (exemple : npm run compare -- v1)');
    return 1;
  }
  const db = openDb('data/polyechanges.sqlite');
  try {
    syncUniversities(db);
    const started = Date.now();
    // Une version gelée dont les fichiers ont changé est refusée avant tout calcul.
    const { pairs } = await compareVersion(db, version, (model) => createLocalEmbedder(model, modelsDir()));
    console.log(`Critère ${version} : ${pairs} paires comparées en ${((Date.now() - started) / 1000).toFixed(1)} s.`);
    const levels = db
      .prepare("SELECT COALESCE(level, 'aucun') AS level, COUNT(*) AS n FROM matches WHERE criterion_version = ? GROUP BY 1 ORDER BY 1")
      .all(version) as { level: string; n: number }[];
    for (const l of levels) console.log(`  ${l.level} : ${l.n}`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  } finally {
    db.close();
  }
}

process.exitCode = await main();
