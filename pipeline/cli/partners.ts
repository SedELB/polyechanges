import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createPoliteFetcher } from '../fetch/politeFetch.js';
import { diffPartners, fetchMoveOnPartners } from '../partners/moveOn.js';
import { UNIVERSITIES_PATH, buildSkeleton, loadUniversities } from '../partners/registry.js';

async function init(force: boolean): Promise<number> {
  if (existsSync(UNIVERSITIES_PATH) && !force) {
    console.error(`${UNIVERSITIES_PATH} existe déjà. Relance avec --force pour l'écraser.`);
    return 1;
  }
  const partners = await fetchMoveOnPartners(createPoliteFetcher());
  const universities = buildSkeleton(partners);
  mkdirSync(dirname(UNIVERSITIES_PATH), { recursive: true });
  writeFileSync(UNIVERSITIES_PATH, `${JSON.stringify(universities, null, 2)}\n`);
  console.log(`${universities.length} universités écrites dans ${UNIVERSITIES_PATH}`);
  return 0;
}

async function check(): Promise<number> {
  const registry = loadUniversities();
  const live = await fetchMoveOnPartners(createPoliteFetcher());
  const { missing, unknown } = diffPartners(registry, live);
  if (missing.length === 0 && unknown.length === 0) {
    console.log(`Le registre correspond à MoveOn (${registry.length} partenaires).`);
    return 0;
  }
  for (const name of missing) console.log(`Manquant sur MoveOn (dans le registre) : ${name}`);
  for (const name of unknown) console.log(`Inconnu du registre (sur MoveOn) : ${name}`);
  return 1;
}

async function main(): Promise<number> {
  const [command, ...flags] = process.argv.slice(2);
  if (command === 'init') return init(flags.includes('--force'));
  if (command === 'check') return check();
  console.error('Usage : npm run partners:init [-- --force] | npm run partners:check');
  return 2;
}

process.exitCode = await main();
