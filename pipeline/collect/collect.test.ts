import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/open.js';
import { upsertUniversity } from '../db/universities.js';
import { activeHostCourses } from '../db/hostCourses.js';
import { lastRun } from '../db/runs.js';
import { createPoliteFetcher } from '../fetch/politeFetch.js';
import { startTestServer, type TestServer } from '../fetch/testServer.js';
import type { HostCourseInput, University } from '../../shared/types.js';
import { collectSource } from './collect.js';
import { registerReader } from './readers.js';
import { renderReport } from './report.js';
import { parseSourceFile, type SourceFile } from './sourceFile.js';

const university: University = {
  id: 'ntu',
  name: 'NTU',
  moveOnName: 'NTU',
  countryCode: 'TW',
  city: 'Taipei',
  lat: 0,
  lng: 0,
  website: 'https://example.org',
  catalogUrl: null,
  creditSystem: 'ECTS',
  contactHoursPerCredit: null,
  terms: { fall: null, spring: null },
  restrictions: null,
  exchangeContact: null,
  catalogPublic: true,
  provenance: {},
};

function course(code: string, title = `Titre ${code}`): HostCourseInput {
  return {
    code,
    title,
    description: `Description de ${code}`,
    outline: null,
    credits: 3,
    contactHours: 45,
    language: 'en',
    terms: ['fall'],
    level: 'undergrad',
    sourceUrl: 'https://example.org/' + code,
  };
}

const manualCourse = (code: string, line: number) => ({
  ...course(code),
  provenance: {
    url: 'https://example.org/catalogue',
    retrievedAt: '2026-11-10T00:00:00.000Z',
    sha256: 'c'.repeat(64),
    locator: { page: 1, line },
    quote: `Course code ${code}`,
  },
});

let server: TestServer;
let tmp: string;
let db: Db;
let current: HostCourseInput[] = [];
const fetcher = createPoliteFetcher({ minDelayMs: 0, sleep: async () => {} });

beforeAll(async () => {
  server = await startTestServer();
  registerReader('test', () => current);
});
afterAll(async () => {
  await server.close();
});
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'polyechanges-'));
  db = openDb(':memory:');
  upsertUniversity(db, university);
});
afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

const htmlSource = (): SourceFile => ({
  id: 'ntu-catalogue',
  universityId: 'ntu',
  kind: 'html',
  urls: [`${server.base}/catalogue`],
  reader: 'test',
});

describe('collectSource', () => {
  it('ajoute, modifie et retire des cours, et garde le lien vers la copie brute', async () => {
    const source = htmlSource();
    current = [course('A'), course('B'), course('C')];
    const first = await collectSource(db, fetcher, source, tmp, '2026-11-10T10:00:00.000Z');
    expect(first.status).toBe('ok');
    expect(first.diff).toEqual({ added: ['A', 'B', 'C'], removed: [], modified: [] });

    current = [course('A', 'Nouveau titre'), course('B'), course('D')];
    const second = await collectSource(db, fetcher, source, tmp, '2026-11-11T10:00:00.000Z');
    expect(second.diff).toEqual({ added: ['D'], removed: ['C'], modified: ['A'] });

    const active = activeHostCourses(db, 'ntu');
    expect(active.map((c) => c.code)).toEqual(['A', 'B', 'D']);
    expect(active.find((c) => c.code === 'A')?.title).toBe('Nouveau titre');
    expect(active.every((c) => typeof c.snapshotId === 'number' && c.snapshotId > 0)).toBe(true);
    const c = db.prepare("SELECT active FROM host_courses WHERE code = 'C'").get() as { active: number };
    expect(c.active).toBe(0);
    expect(lastRun(db, source.id)).toEqual({ status: 'ok', startedAt: '2026-11-11T10:00:00.000Z' });
  });

  it('une collecte qui échoue ne touche pas aux cours existants', async () => {
    const source = htmlSource();
    current = [course('A'), course('B'), course('C')];
    await collectSource(db, fetcher, source, tmp, '2026-11-10T10:00:00.000Z');

    current = [];
    const res = await collectSource(db, fetcher, source, tmp, '2026-11-11T10:00:00.000Z');
    expect(res).toEqual({ status: 'failed', diff: null, reason: 'Aucun cours lu' });
    expect(activeHostCourses(db, 'ntu')).toHaveLength(3);
    expect(lastRun(db, source.id)?.status).toBe('failed');
    const row = db
      .prepare("SELECT failure_reason FROM collection_runs WHERE status = 'failed'")
      .get() as { failure_reason: string };
    expect(row.failure_reason).toBe('Aucun cours lu');
  });

  it('échoue proprement quand le téléchargement échoue', async () => {
    current = [course('A')];
    const source = { ...htmlSource(), urls: [`${server.base}/absent`] };
    const res = await collectSource(db, fetcher, source, tmp, '2026-11-10T10:00:00.000Z');
    expect(res.status).toBe('failed');
    expect(res.reason).toBeTruthy();
    expect(lastRun(db, source.id)?.status).toBe('failed');
  });

  it('lit une source manuelle sans téléchargement', async () => {
    const manualDir = join(tmp, 'manual');
    mkdirSync(manualDir);
    writeFileSync(join(manualDir, 'ntu-manuel.json'), JSON.stringify([manualCourse('M1', 4), manualCourse('M2', 9)]));
    const source: SourceFile = {
      id: 'ntu-manuel',
      universityId: 'ntu',
      kind: 'manual',
      urls: [],
      reader: 'manual',
    };
    const hitsBefore = server.hits.length;
    const res = await collectSource(db, fetcher, source, tmp, '2026-11-10T10:00:00.000Z', { manualDir });
    expect(res.status).toBe('ok');
    expect(res.diff?.added).toEqual(['M1', 'M2']);
    const rows = db.prepare('SELECT snapshot_id, source_page, source_line FROM host_courses ORDER BY code').all() as {
      snapshot_id: number | null;
      source_page: number | null;
      source_line: number | null;
    }[];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.snapshot_id === null)).toBe(true);
    expect(rows.map((r) => [r.source_page, r.source_line])).toEqual([[1, 4], [1, 9]]);
    expect(server.hits.length).toBe(hitsBefore);
  });

  it('refuse une saisie manuelle sans provenance', async () => {
    const manualDir = join(tmp, 'manual');
    mkdirSync(manualDir);
    writeFileSync(join(manualDir, 'ntu-manuel.json'), JSON.stringify([course('M1')]));
    const source: SourceFile = { id: 'ntu-manuel', universityId: 'ntu', kind: 'manual', urls: [], reader: 'manual' };
    const res = await collectSource(db, fetcher, source, tmp, '2026-11-10T10:00:00.000Z', { manualDir });
    expect(res.status).toBe('failed');
    expect(res.reason).toContain('provenance');
  });

  it('enregistre la position de chaque cours dans sa copie brute', async () => {
    server.pages.set('/liste', '<html><body><h1>Cours</h1><ul><li>A1 - Intro</li><li>B2 - Algo</li></ul></body></html>');
    const source = { ...htmlSource(), urls: [`${server.base}/liste`] };
    current = [course('A1'), course('B2'), course('Z9')];
    const res = await collectSource(db, fetcher, source, tmp, '2026-11-10T10:00:00.000Z');
    expect(res.status).toBe('ok');
    const rows = db.prepare('SELECT code, source_page, source_line FROM host_courses ORDER BY code').all();
    expect(rows).toEqual([
      { code: 'A1', source_page: 1, source_line: 2 },
      { code: 'B2', source_page: 1, source_line: 3 },
      { code: 'Z9', source_page: null, source_line: null },
    ]);
    const stored = activeHostCourses(db, 'ntu').find((c) => c.code === 'A1');
    expect([stored?.sourcePage, stored?.sourceLine]).toEqual([1, 2]);
  });

  it('échoue si le fichier manuel est invalide', async () => {
    const manualDir = join(tmp, 'manual');
    mkdirSync(manualDir);
    writeFileSync(join(manualDir, 'ntu-manuel.json'), JSON.stringify([{ code: 'X' }]));
    const source: SourceFile = { id: 'ntu-manuel', universityId: 'ntu', kind: 'manual', urls: [], reader: 'manual' };
    const res = await collectSource(db, fetcher, source, tmp, '2026-11-10T10:00:00.000Z', { manualDir });
    expect(res.status).toBe('failed');
  });
});

describe('fiche de source', () => {
  it('valide la forme', () => {
    expect(() => parseSourceFile({ id: 'x', universityId: 'u', kind: 'html', urls: [], reader: 'r' })).toThrow();
    expect(parseSourceFile({ id: 'x', universityId: 'u', kind: 'html', urls: ['https://a'], reader: 'r' }).id).toBe('x');
  });
});

describe('renderReport', () => {
  it('liste statut, nombre de cours et différences', () => {
    const text = renderReport({
      sourceId: 'ntu-catalogue',
      date: '2026-11-11',
      status: 'ok',
      courseCount: 3,
      diff: { added: ['D'], removed: ['C'], modified: ['A'] },
      reason: null,
    });
    expect(text).toContain('Statut : ok');
    expect(text).toContain('Cours actifs : 3');
    expect(text).toContain('Ajoutés (1) : D');
    expect(text).toContain('Retirés (1) : C');
    expect(text).toContain('Modifiés (1) : A');
  });
  it('indique la raison d’échec', () => {
    const text = renderReport({
      sourceId: 's',
      date: '2026-11-11',
      status: 'failed',
      courseCount: 3,
      diff: null,
      reason: 'Aucun cours lu',
    });
    expect(text).toContain('Raison de l’échec : Aucun cours lu');
  });
});
