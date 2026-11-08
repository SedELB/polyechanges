import { exportSiteData } from '../export/export.js';
import { openDb } from '../db/open.js';
import { syncUniversities } from '../partners/registry.js';

export const SITE_DATA_DIR = 'site/public/data';

async function main(): Promise<number> {
  const version = process.argv[2];
  if (!version) {
    console.error('Usage : npm run export -- <version>   (exemple : npm run export -- v0)');
    return 1;
  }
  const db = openDb('data/polyechanges.sqlite');
  try {
    syncUniversities(db);
    await exportSiteData(db, version, SITE_DATA_DIR);
    console.log(`Export du critère ${version} écrit dans ${SITE_DATA_DIR}.`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  } finally {
    db.close();
  }
}

process.exitCode = await main();
