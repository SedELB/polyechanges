import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { savedSourceUrls } from '../collect/saved.js';
import { loadSourceFiles } from '../collect/sourceFile.js';
import { openDb } from '../db/open.js';
import { createPoliteFetcher } from '../fetch/politeFetch.js';
import { readSnapshot, takeSnapshot } from '../fetch/snapshots.js';
import { UNIVERSITIES_PATH, loadUniversities, syncUniversities } from '../partners/registry.js';
import { ensureFactsSource, refreshFactSources, writeSourcesReport } from '../provenance/refresh.js';
import { findQuoteSpans, linesListing, snapshotText } from '../provenance/snapshotText.js';
import { relocateCourses, relocateFactSources } from '../provenance/relocate.js';
import { findRawCopy, RAW_CONTENT_TYPES, verifyAll } from '../provenance/verify.js';

const DATA_DIR = 'data';
const RAW_DIR = join(DATA_DIR, 'raw');
const DB_PATH = join(DATA_DIR, 'polyechanges.sqlite');

/** Télécharge une page de fait, la range comme copie brute et écrit son texte extrait à côté. */
async function add(universityId: string, url: string): Promise<number> {
  if (!loadUniversities().some((u) => u.id === universityId)) {
    console.error(`Université introuvable : ${universityId}`);
    return 2;
  }
  mkdirSync(DATA_DIR, { recursive: true });
  const db = openDb(DB_PATH);
  try {
    syncUniversities(db);
    const sourceId = ensureFactsSource(db, universityId, url);
    const snap = await takeSnapshot(db, createPoliteFetcher(), sourceId, url, RAW_DIR);
    const pages = await snapshotText(readSnapshot(snap, RAW_DIR), snap.contentType);
    const linesPath = join(RAW_DIR, dirname(snap.path), `${snap.sha256}.lines.txt`);
    writeFileSync(linesPath, linesListing(pages));
    console.log(`sha256 : ${snap.sha256}`);
    console.log(`retrievedAt : ${snap.fetchedAt}`);
    console.log(`copie brute : ${join(RAW_DIR, snap.path)}`);
    console.log(`texte extrait : ${linesPath} (${pages.reduce((n, p) => n + p.length, 0)} lignes sur ${pages.length} page(s))`);
    return 0;
  } finally {
    db.close();
  }
}

/** Affiche les positions (page, ligne) où le texte apparaît dans une copie brute. */
async function find(sha256: string, text: string): Promise<number> {
  const copy = findRawCopy(sha256, RAW_DIR);
  if (!copy) {
    console.error(`Copie brute absente : ${sha256}`);
    return 2;
  }
  const pages = await snapshotText(readFileSync(copy.path), copy.contentType);
  const hits = findQuoteSpans(pages, text);
  for (const h of hits) {
    const shown = pages[h.page - 1].slice(h.line - 1, h.line - 1 + h.lines).join(' ');
    console.log(`p${h.page}:l${h.line}${h.lines > 1 ? ` (${h.lines} lignes)` : ''} ${shown}`);
  }
  if (hits.length === 0) console.log('Aucune position trouvée.');
  return hits.length === 0 ? 1 : 0;
}

/** Hors ligne : chaque source de chaque université contre sa copie brute ; signale aussi les faits `stale`. */
async function verify(): Promise<number> {
  const { total, problems } = await verifyAll(loadUniversities(), RAW_DIR);
  for (const p of problems) {
    console.log(`${p.status} : ${p.universityId}, ${p.fact}, ${p.provenance.url} (${p.provenance.sha256.slice(0, 12)}) « ${p.provenance.quote} »${p.detail ? ` : ${p.detail}` : ''}`);
  }
  console.log(`${total} source(s) vérifiée(s), ${problems.length} problème(s).`);
  if (problems.some((p) => p.status === 'déplacé')) console.log('Position inexacte : lance npm run verify-sources -- --fix');
  return problems.length > 0 ? 1 : 0;
}

/** Hors ligne : recale les positions des faits et des cours sur les copies brutes locales. */
async function fix(): Promise<number> {
  const r = await relocateFactSources(UNIVERSITIES_PATH, RAW_DIR);
  for (const m of r.moved) {
    console.log(`recalé${m.context ? ' (contexte)' : ''} : ${m.universityId}, ${m.fact} (p${m.from.page}:l${m.from.line} -> p${m.to.page}:l${m.to.line})`);
  }
  for (const p of r.problems) {
    console.log(`${p.status} : ${p.universityId}, ${p.fact}, ${p.provenance.url} (${p.provenance.sha256.slice(0, 12)}) « ${p.provenance.quote} »${p.detail ? ` : ${p.detail}` : ''}`);
  }
  console.log(`faits : ${r.total} source(s), ${r.moved.length} recalée(s), ${r.unchanged} inchangée(s), ${r.problems.length} problème(s).`);
  const db = openDb(DB_PATH);
  try {
    const c = await relocateCourses(db, RAW_DIR);
    console.log(`cours d'accueil : ${c.host.changed} position(s) recalculée(s) sur ${c.host.total}`);
    console.log(`cours de Poly : ${c.poly.changed} position(s) recalculée(s) sur ${c.poly.total}`);
  } finally {
    db.close();
  }
  console.log(`vues .lines.txt régénérées : ${await rewriteLinesViews()}`);
  return r.problems.length > 0 ? 1 : 0;
}

/** Réécrit chaque vue `<sha256>.lines.txt` à partir de sa copie brute, avec l'extraction actuelle. */
async function rewriteLinesViews(): Promise<number> {
  if (!existsSync(RAW_DIR)) return 0;
  let n = 0;
  const dirs = [RAW_DIR, ...readdirSync(RAW_DIR).map((d) => join(RAW_DIR, d)).filter((d) => statSync(d).isDirectory())];
  for (const dir of dirs) {
    for (const name of readdirSync(dir)) {
      const m = /^([0-9a-f]{64})\.(html|pdf|txt)$/.exec(name);
      if (!m || !existsSync(join(dir, `${m[1]}.lines.txt`))) continue;
      const pages = await snapshotText(readFileSync(join(dir, name)), RAW_CONTENT_TYPES[m[2]]);
      writeFileSync(join(dir, `${m[1]}.lines.txt`), linesListing(pages));
      n++;
    }
  }
  return n;
}

/** En ligne : retélécharge les sources des faits, met à jour le fichier et écrit le rapport. */
async function refresh(only?: string): Promise<number> {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = openDb(DB_PATH);
  try {
    const now = new Date().toISOString();
    // Les hôtes des pages enregistrées à la main bloquent les robots : leurs faits sont vérifiés hors ligne seulement.
    const savedUrls = savedSourceUrls(loadSourceFiles(join(DATA_DIR, 'sources')));
    const result = await refreshFactSources(db, createPoliteFetcher(), UNIVERSITIES_PATH, RAW_DIR, now, only, { savedUrls });
    const report = writeSourcesReport(join(DATA_DIR, 'reports'), now.slice(0, 10), result);
    const c = result.counts;
    console.log(`inchangés ${c.inchangé}, déplacés ${c.déplacé}, introuvables ${c.introuvable}, copies absentes ${c.copie_absente} -> ${report}`);
    const offline = result.saved.filter((s) => s.status === 'vérifiée hors ligne').length;
    const toSave = result.saved.filter((s) => s.status === 'à réenregistrer');
    console.log(`pages enregistrées à la main (jamais retéléchargées) : ${offline} fait(s) vérifié(s) hors ligne, ${toSave.length} à réenregistrer`);
    for (const s of toSave) console.warn(`à réenregistrer (copie brute absente, ne bloque pas) : ${s.universityId}, ${s.fact} (${s.url})`);
    for (const e of result.errors) console.error(`échec : ${e}`);
    return c.introuvable > 0 || c.copie_absente > 0 ? 1 : 0;
  } finally {
    db.close();
  }
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'add' && args.length === 2) return add(args[0], args[1]);
  if (command === 'find' && args.length === 2) return find(args[0], args[1]);
  if (command === 'verify' && args.length === 0) return verify();
  if (command === 'verify' && args.length === 1 && args[0] === '--fix') return fix();
  if (command === 'refresh') return refresh(args[0]);
  console.error(
    'Usage : npm run source:add -- <universityId> <url> | npm run source:find -- <sha256> "<texte>" | npm run verify-sources [-- --fix] | npm run refresh-sources [-- <universityId>]',
  );
  return 2;
}

process.exitCode = await main();
