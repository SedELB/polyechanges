import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/open.js';
import { createPoliteFetcher } from '../fetch/politeFetch.js';
import { takeSnapshot } from '../fetch/snapshots.js';
import { startTestServer, type TestServer } from '../fetch/testServer.js';
import { ensureFactsSource, factsSourceId, formatSourcesReport, refreshFactSources } from './refresh.js';
import type { Provenance } from '../../shared/types.js';

const page = (lines: string[]) => `<html><body><h1>Academic Calendar</h1>${lines.map((l) => `<p>${l}</p>`).join('')}</body></html>`;
const START = 'Fall semester begins: September 7, 2026';
const EXAMS = 'Final exams end: January 8, 2027';
const SPRING = 'Spring semester begins: February 1, 2027';

let server: TestServer;
let tmp: string;
let db: Db;
let path: string;
let rawDir: string;
const fetcher = createPoliteFetcher({ minDelayMs: 0, sleep: async () => {} });

beforeAll(async () => {
  server = await startTestServer();
});
afterAll(async () => {
  await server.close();
});
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'polyechanges-'));
  db = openDb(':memory:');
  path = join(tmp, 'universities.json');
  rawDir = join(tmp, 'raw');
});
afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

async function seed(id: string, route: string, facts: Record<string, [string, number]>, over: object = {}): Promise<Record<string, Provenance>> {
  const url = `${server.base}${route}`;
  db.prepare("INSERT OR IGNORE INTO universities (id, name, move_on_name, country_code, city, lat, lng, website, credit_system, terms_json, catalog_public) VALUES (?, 'U', 'U', 'TW', '', 0, 0, '', 'local', '{}', 1)").run(id);
  ensureFactsSource(db, id, url);
  const snap = await takeSnapshot(db, fetcher, factsSourceId(id), url, rawDir);
  const provenance: Record<string, Provenance> = {};
  for (const [fact, [quote, line]] of Object.entries(facts)) {
    provenance[fact] = { url, retrievedAt: '2026-11-01T00:00:00.000Z', sha256: snap.sha256, locator: { page: 1, line }, quote };
  }
  return provenance;
}

const university = (id: string, provenance: object, extra: object = {}) => ({
  id, name: `Université ${id}`, moveOnName: `Université ${id}`, countryCode: 'TW', city: 'Taipei', lat: 1, lng: 2,
  website: 'https://x.example', catalogUrl: null, creditSystem: 'local', contactHoursPerCredit: null,
  terms: { fall: { start: '2026-09-07', end: '2027-01-08', examsEnd: '2027-01-08' }, spring: null },
  restrictions: null, exchangeContact: null, catalogPublic: true, provenance, ...extra,
});

describe('refreshFactSources', () => {
  it('met à jour les faits déplacés et marque les introuvables', async () => {
    server.pages.set('/cal', page([START, EXAMS, SPRING]));
    const provenance = await seed('u1', '/cal', { 'terms.fall.start': [START, 2], 'terms.fall.examsEnd': [EXAMS, 3] });
    writeFileSync(path, JSON.stringify([university('u1', provenance)], null, 2) + '\n');
    server.pages.set('/cal', page(['Notice: dates updated', 'Exams schedule published separately', START, 'Final exams end: January 15, 2027 (revised)', SPRING]));
    const hitsBefore = server.hits.filter((h) => h === '/cal').length;

    const res = await refreshFactSources(db, fetcher, path, rawDir, '2026-11-12T10:00:00.000Z');

    expect(res.counts).toEqual({ inchangé: 0, déplacé: 1, introuvable: 1, copie_absente: 0 });
    expect(server.hits.filter((h) => h === '/cal').length - hitsBefore).toBe(1);
    const file = JSON.parse(readFileSync(path, 'utf8'));
    const start = file[0].provenance['terms.fall.start'];
    expect(start.locator).toEqual({ page: 1, line: 4 });
    expect(start.retrievedAt).toBe('2026-11-12T10:00:00.000Z');
    expect(start.sha256).not.toBe(provenance['terms.fall.start'].sha256);
    expect(start.stale).toBeUndefined();
    const exams = file[0].provenance['terms.fall.examsEnd'];
    expect(exams).toEqual({ ...provenance['terms.fall.examsEnd'], stale: true });
    expect(file[0].terms.fall.examsEnd).toBe('2027-01-08');
    expect(readFileSync(path, 'utf8')).toBe(JSON.stringify(file, null, 2) + '\n');

    expect(res.missing).toHaveLength(1);
    expect(res.missing[0]).toMatchObject({ universityId: 'u1', fact: 'terms.fall.examsEnd', quote: EXAMS });
    expect(res.missing[0].nearest).toHaveLength(3);
    expect(res.missing[0].nearest[0]).toBe('Final exams end: January 15, 2027 (revised)');
    const report = formatSourcesReport('2026-11-12', res);
    expect(report).toContain(EXAMS);
    expect(report).toContain('Final exams end: January 15, 2027 (revised)');
    expect(report).toContain('terms.fall.examsEnd');
  });

  it('garde les faits inchangés, lève la marque stale et respecte le filtre par université', async () => {
    server.pages.set('/cal', page([START, EXAMS]));
    const p1 = await seed('u1', '/cal', { 'terms.fall.start': [START, 2] });
    p1['terms.fall.start'].stale = true;
    const p2 = await seed('u2', '/cal', { 'terms.fall.start': [START, 2] });
    writeFileSync(path, JSON.stringify([university('u1', p1), university('u2', p2)], null, 2) + '\n');

    const res = await refreshFactSources(db, fetcher, path, rawDir, '2026-11-12T10:00:00.000Z', 'u1');
    expect(res.counts).toEqual({ inchangé: 1, déplacé: 0, introuvable: 0, copie_absente: 0 });
    const file = JSON.parse(readFileSync(path, 'utf8'));
    expect(file[0].provenance['terms.fall.start'].stale).toBeUndefined();
    expect(file[0].provenance['terms.fall.start'].retrievedAt).toBe('2026-11-12T10:00:00.000Z');
    expect(file[1].provenance).toEqual(p2); // u2 intact
  });

  it('marque périmé un fait dont l’adresse est injoignable, sans toucher à sa valeur', async () => {
    server.pages.set('/cal', page([START]));
    const provenance = await seed('u1', '/cal', { 'terms.fall.start': [START, 2] });
    const bad = { ...provenance['terms.fall.start'], url: `${server.base}/absent` };
    writeFileSync(path, JSON.stringify([university('u1', { 'terms.fall.start': bad })], null, 2) + '\n');
    const res = await refreshFactSources(db, fetcher, path, rawDir, '2026-11-12T10:00:00.000Z');
    expect(res.counts.copie_absente).toBe(1);
    expect(res.errors).toHaveLength(1);
    const file = JSON.parse(readFileSync(path, 'utf8'));
    expect(file[0].provenance['terms.fall.start']).toEqual({ ...bad, stale: true });
    expect(file[0].terms.fall.start).toBe('2026-09-07');
    expect(res.missing).toHaveLength(1);
    expect(res.missing[0].error).toBeTruthy();
    const report = formatSourcesReport('2026-11-12', res);
    expect(report).toContain('Non confirmé');
    expect(report).toContain(res.missing[0].error as string);
    expect(readdirSync(tmp).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('traite le contexte comme l’extrait principal : déplacé mis à jour, introuvable marqué périmé', async () => {
    const CTX = '2026 Academic Calendar';
    server.pages.set('/cal', page([CTX, START]));
    const prov = await seed('u1', '/cal', { 'terms.fall.start': [START, 3] });
    const withCtx = { ...prov['terms.fall.start'], context: [{ locator: { page: 1, line: 2 }, quote: CTX }] };
    writeFileSync(path, JSON.stringify([university('u1', { 'terms.fall.start': withCtx })], null, 2) + '\n');

    server.pages.set('/cal', page(['Notice', CTX, START]));
    const moved = await refreshFactSources(db, fetcher, path, rawDir, '2026-11-12T10:00:00.000Z');
    expect(moved.counts.déplacé).toBe(1);
    let p = JSON.parse(readFileSync(path, 'utf8'))[0].provenance['terms.fall.start'];
    expect(p.context).toEqual([{ locator: { page: 1, line: 3 }, quote: CTX }]);
    expect(p.locator).toEqual({ page: 1, line: 4 });
    expect(p.stale).toBeUndefined();

    server.pages.set('/cal', page(['Notice', '2027 Academic Calendar', START]));
    const lost = await refreshFactSources(db, fetcher, path, rawDir, '2026-11-13T10:00:00.000Z');
    expect(lost.counts.introuvable).toBe(1);
    p = JSON.parse(readFileSync(path, 'utf8'))[0].provenance['terms.fall.start'];
    expect(p.stale).toBe(true);
    expect(p.context[0].quote).toBe(CTX);
  });

  it('choisit le contexte avant l’extrait principal ; sans occurrence avant, marque périmé sans rien écrire', async () => {
    const CTX = '2026 Academic Calendar';
    server.pages.set('/cal', page([CTX, START, CTX]));
    const prov = await seed('u1', '/cal', { 'terms.fall.start': [START, 3] });
    const withCtx = { ...prov['terms.fall.start'], context: [{ locator: { page: 1, line: 2 }, quote: CTX }] };
    writeFileSync(path, JSON.stringify([university('u1', { 'terms.fall.start': withCtx })], null, 2) + '\n');
    await refreshFactSources(db, fetcher, path, rawDir, '2026-11-12T10:00:00.000Z');
    let p = JSON.parse(readFileSync(path, 'utf8'))[0].provenance['terms.fall.start'];
    expect(p.context[0].locator).toEqual({ page: 1, line: 2 });
    expect(p.stale).toBeUndefined();

    server.pages.set('/cal', page([START, CTX]));
    const res = await refreshFactSources(db, fetcher, path, rawDir, '2026-11-13T10:00:00.000Z');
    expect(res.counts.introuvable).toBe(1);
    p = JSON.parse(readFileSync(path, 'utf8'))[0].provenance['terms.fall.start'];
    expect(p.stale).toBe(true);
    expect(p.locator).toEqual({ page: 1, line: 3 });
  });

  it('refuse une université inconnue', async () => {
    writeFileSync(path, JSON.stringify([university('u1', {})]));
    await expect(refreshFactSources(db, fetcher, path, rawDir, '2026-11-12T10:00:00.000Z', 'zzz')).rejects.toThrow(/zzz/);
  });
});
