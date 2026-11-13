import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PolyCourse, University } from '../../shared/types.js';
import { compareVersion, freezeCriterion } from '../compare/compare.js';
import { applyCollection } from '../db/hostCourses.js';
import { openDb, type Db } from '../db/open.js';
import { upsertPolyCourses } from '../db/polyCourses.js';
import { upsertUniversity } from '../db/universities.js';
import { exportSiteData } from '../export/export.js';
import type { Embedder } from './embedder.js';
import { CriterionFrozenError, FROZEN_FILE, latestFrozenVersion, readFrozenMark, refreshVersion } from './frozen.js';
import { CRITERION_DIR, loadCriterion } from './loadCriterion.js';

/** Versions du dépôt marquées gelées (un FROZEN.json à côté de criterion.json). */
const frozenOnDisk = (): string[] =>
  readdirSync(CRITERION_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(CRITERION_DIR, d.name, FROZEN_FILE)))
    .map((d) => d.name);

describe('versions gelées du dépôt', () => {
  it('v1 est marquée gelée dans le dépôt', () => {
    expect(readFrozenMark('v1')).toMatchObject({ version: 'v1', frozenAt: '2026-11-12' });
    expect(latestFrozenVersion()).not.toBeNull();
  });

  it.each(frozenOnDisk())('critère %s : le hachage recalculé est celui du gel', (version) => {
    expect(loadCriterion(version).paramsHash).toBe(readFrozenMark(version)!.paramsHash);
  });
});

/** Tout texte ressemble à tout texte : chaque notion est retrouvée, la paire a un niveau. */
const fake: Embedder = {
  key: 'fake@r@fp32@00000000',
  async embed(texts) {
    return texts.map(() => [1, 0]);
  },
};

const uni: University = {
  id: 'u-tw', name: 'U', moveOnName: 'U', countryCode: 'TW', city: 'x', lat: 0, lng: 0, website: 'https://x',
  catalogUrl: null, creditSystem: 'ECTS', contactHoursPerCredit: null, terms: { fall: null, spring: null },
  restrictions: null, exchangeContact: null, catalogPublic: true, provenance: {},
};

/** Base neuve : un cours de Poly doté d'une grille dans v1, un cours d'accueil. */
function freshDb(sigle: string): Db {
  const db = openDb(':memory:');
  upsertUniversity(db, uni);
  const poly: PolyCourse = {
    sigle, title: 'T', description: 'D', credits: 3, triplet: [3, 1.5, 4.5], prerequisites: '', status: 'optionnel',
    eligible: true, ineligibleReason: null, compared: true, groups: [], sourceUrl: 'https://poly.example/c',
    collectedAt: '2026-01-01', sourceLocator: null,
  };
  upsertPolyCourses(db, [poly]);
  applyCollection(
    db, 'u-tw',
    [{ code: 'DB1', title: 'Databases', description: 'SQL', outline: null, credits: 6, contactHours: null, language: 'en', terms: ['fall'], level: 'undergrad', sourceUrl: 'https://h/DB1' }],
    () => null, '2026-01-02',
  );
  return db;
}

let dir: string;
let out: string;
let sigle: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'criterion-gel-'));
  out = join(mkdtempSync(join(tmpdir(), 'export-gel-')), 'data');
  cpSync(join(CRITERION_DIR, 'v1'), join(dir, 'v1'), { recursive: true });
  sigle = Object.keys(loadCriterion('v1').notions).sort()[0];
});

describe('gel versionné dans le dépôt', () => {
  it('grille de v1 modifiée : compare et export refusent, même sur une base neuve', async () => {
    const path = join(dir, 'v1', 'notions.json');
    const notions = JSON.parse(readFileSync(path, 'utf8')) as Record<string, { id: string; fr: string; en: string }[]>;
    notions[sigle][0] = { ...notions[sigle][0], en: `${notions[sigle][0].en} (modifiée)` };
    writeFileSync(path, JSON.stringify(notions, null, 2));

    expect(() => loadCriterion('v1', dir)).toThrow(CriterionFrozenError);
    const db = freshDb(sigle);
    await expect(compareVersion(db, 'v1', async () => fake, dir)).rejects.toThrow(/gelé.*FROZEN\.json/);
    await expect(exportSiteData(db, 'v1', out, dir, join(dir, 'sources'))).rejects.toThrow(/gelé/);
    expect(existsSync(out)).toBe(false);
  });

  it('réglage de v1 modifié : refusé aussi', () => {
    const path = join(dir, 'v1', 'criterion.json');
    const params = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    writeFileSync(path, JSON.stringify({ ...params, detectThreshold: 0.5 }));
    expect(() => loadCriterion('v1', dir)).toThrow(CriterionFrozenError);
  });

  it('base neuve et v1 intacte : compare et export acceptent, et la base apprend le gel', async () => {
    const db = freshDb(sigle);
    await expect(compareVersion(db, 'v1', async () => fake, dir)).resolves.toMatchObject({ pairs: 1 });
    const row = db.prepare("SELECT params_hash, frozen_at FROM criterion_versions WHERE version = 'v1'").get();
    expect(row).toEqual({ params_hash: readFrozenMark('v1', dir)!.paramsHash, frozen_at: '2026-11-12' });
    await exportSiteData(db, 'v1', out, dir, join(dir, 'sources'));
    expect(JSON.parse(readFileSync(join(out, 'meta.json'), 'utf8')).criterionVersion).toBe('v1');
  });

  it('l’export refuse des paires calculées avec d’autres réglages que les fichiers', async () => {
    const db = freshDb(sigle);
    await compareVersion(db, 'v1', async () => fake, dir);
    db.prepare("UPDATE criterion_versions SET params_hash = 'ancien' WHERE version = 'v1'").run();
    await expect(exportSiteData(db, 'v1', out, dir, join(dir, 'sources'))).rejects.toThrow(/npm run compare -- v1/);
  });

  it('l’export refuse une version jamais calculée sur cette base', async () => {
    const db = freshDb(sigle);
    await expect(exportSiteData(db, 'v1', out, dir, join(dir, 'sources'))).rejects.toThrow(/npm run compare -- v1/);
  });
});

describe('freezeCriterion écrit le gel dans le dépôt', () => {
  it('écrit FROZEN.json avec la date et le hachage, puis refuse toute modification', async () => {
    const v2 = join(dir, 'v2');
    cpSync(join(dir, 'v1'), v2, { recursive: true });
    const params = JSON.parse(readFileSync(join(v2, 'criterion.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(join(v2, 'criterion.json'), JSON.stringify({ ...params, version: 'v2' }, null, 2));
    rmSync(join(v2, FROZEN_FILE));

    const db = freshDb(sigle);
    expect(() => freezeCriterion(db, 'v2', '2027-01-05', dir)).toThrow(/npm run compare -- v2/);
    await compareVersion(db, 'v2', async () => fake, dir);
    freezeCriterion(db, 'v2', '2027-01-05', dir);
    const mark = readFrozenMark('v2', dir)!;
    expect(mark).toEqual({ version: 'v2', frozenAt: '2027-01-05', paramsHash: loadCriterion('v2', dir).paramsHash });
    expect(readFileSync(join(v2, FROZEN_FILE), 'utf8').endsWith('}\n')).toBe(true);
    expect(latestFrozenVersion(dir)).toBe('v2');

    // Regeler ne change ni la date ni le hachage.
    freezeCriterion(db, 'v2', '2027-02-01', dir);
    expect(readFrozenMark('v2', dir)).toEqual(mark);

    writeFileSync(join(v2, 'criterion.json'), JSON.stringify({ ...params, version: 'v2', bandLow: 0.2 }, null, 2));
    expect(() => freezeCriterion(db, 'v2', '2027-02-01', dir)).toThrow(CriterionFrozenError);
  });

  it('garde la date de gel déjà notée dans la base', async () => {
    const db = freshDb(sigle);
    const v3 = join(dir, 'v3');
    cpSync(join(dir, 'v1'), v3, { recursive: true });
    rmSync(join(v3, FROZEN_FILE));
    const params = JSON.parse(readFileSync(join(v3, 'criterion.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(join(v3, 'criterion.json'), JSON.stringify({ ...params, version: 'v3' }, null, 2));
    await compareVersion(db, 'v3', async () => fake, dir);
    db.prepare("UPDATE criterion_versions SET frozen_at = '2026-12-01' WHERE version = 'v3'").run();
    freezeCriterion(db, 'v3', '2027-01-05', dir);
    expect(readFrozenMark('v3', dir)!.frozenAt).toBe('2026-12-01');
  });
});

describe('refreshVersion', () => {
  it('sans argument : la dernière version gelée du dépôt', () => {
    expect(refreshVersion(undefined, 'v1')).toEqual({ version: 'v1' });
  });
  it('le même argument que la version gelée est accepté', () => {
    expect(refreshVersion('v1', 'v1')).toEqual({ version: 'v1' });
  });
  it('un autre argument que la version gelée est refusé', () => {
    expect(refreshVersion('v2', 'v1')).toMatchObject({ error: expect.stringMatching(/v1/) });
  });
  it('aucune version gelée : l’argument est obligatoire', () => {
    expect(refreshVersion('v0', null)).toEqual({ version: 'v0' });
    expect(refreshVersion(undefined, null)).toMatchObject({ error: expect.any(String) });
  });
});
