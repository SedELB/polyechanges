import { freezeCriterion } from '../compare/compare.js';
import { FROZEN_FILE } from '../criterion/frozen.js';
import { CRITERION_DIR } from '../criterion/loadCriterion.js';
import { openDb } from '../db/open.js';

function main(): number {
  const version = process.argv[2];
  if (!version) {
    console.error('Usage : npm run freeze -- <version>   (exemple : npm run freeze -- v2)');
    return 1;
  }
  const db = openDb('data/polyechanges.sqlite');
  try {
    const { frozenAt, paramsHash } = freezeCriterion(db, version, new Date().toISOString().slice(0, 10));
    console.log(`Critère ${version} gelé le ${frozenAt} (hachage ${paramsHash.slice(0, 12)}…).`);
    console.log(`Marque de gel : ${CRITERION_DIR}/${version}/${FROZEN_FILE}, à committer avec la version.`);
    console.log('Pour changer un réglage, crée une nouvelle version.');
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  } finally {
    db.close();
  }
}

process.exitCode = main();
