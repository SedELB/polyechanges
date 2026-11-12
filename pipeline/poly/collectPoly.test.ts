import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/open.js';
import { listPolyCourses } from '../db/polyCourses.js';
import { lastRun } from '../db/runs.js';
import { parseSourceFile, type SourceFile } from '../collect/sourceFile.js';
import { snapshotText } from '../provenance/snapshotText.js';
import { collectPoly, polySummary } from './collectPoly.js';

const fixture = new URL('./fixtures/programme-extrait.html', import.meta.url);
const URL_PROGRAMME = 'https://www.polymtl.ca/programmes/programmes/baccalaureat-en-genie-logiciel';
const SAVED_AT = new Date('2026-11-09T15:30:00.000Z');

let tmp: string;
let db: Db;
let page: string;
let source: SourceFile;
let rawDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'polyechanges-'));
  db = openDb(':memory:');
  page = join(tmp, 'programme-LOG.html');
  copyFileSync(fixture, page);
  utimesSync(page, SAVED_AT, SAVED_AT);
  rawDir = join(tmp, 'raw');
  source = parseSourceFile({
    id: 'poly-log',
    universityId: null,
    kind: 'saved',
    urls: [URL_PROGRAMME],
    files: [page],
    reader: 'poly',
  });
});
afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('collectPoly', () => {
  it('copie la page enregistrée, lit les cours et écrit les copies brutes', async () => {
    const res = await collectPoly(db, source, rawDir, '2026-11-10T10:00:00.000Z');
    expect(res.status).toBe('ok');
    expect(res.diff?.added).toHaveLength(16);

    const sha = createHash('sha256').update(readFileSync(page)).digest('hex');
    expect(existsSync(join(rawDir, 'poly-log', `${sha}.html`))).toBe(true);
    const snap = db.prepare('SELECT url, fetched_at, sha256, path, content_type FROM snapshots').get();
    expect(snap).toEqual({
      url: URL_PROGRAMME,
      fetched_at: SAVED_AT.toISOString(),
      sha256: sha,
      path: `poly-log/${sha}.html`,
      content_type: 'text/html',
    });
    expect(db.prepare('SELECT university_id, kind, url FROM sources').get()).toEqual({
      university_id: null,
      kind: 'saved',
      url: URL_PROGRAMME,
    });

    const courses = listPolyCourses(db);
    const log3430 = courses.find((c) => c.sigle === 'LOG3430');
    expect(log3430).toMatchObject({
      credits: 3,
      triplet: [3, 1.5, 4.5],
      status: 'obligatoire',
      eligible: true,
      compared: true,
      collectedAt: SAVED_AT.toISOString(),
    });
    expect(courses.find((c) => c.sigle === 'SSH3501')).toMatchObject({ eligible: false, compared: false });
    expect(lastRun(db, 'poly-log')).toEqual({ status: 'ok', startedAt: '2026-11-10T10:00:00.000Z' });
    expect(polySummary(db)).toMatchObject({ imported: 16, ineligible: 2, obligatoire: 9 });
  });

  it('enregistre la position du sigle dans la copie brute de la page', async () => {
    await collectPoly(db, source, rawDir, '2026-11-10T10:00:00.000Z');
    const sha = createHash('sha256').update(readFileSync(page)).digest('hex');
    const courses = listPolyCourses(db);
    expect(courses.every((c) => c.sourceLocator !== null && c.sourceLocator.sha256 === sha)).toBe(true);
    const loc = courses.find((c) => c.sigle === 'LOG3430')?.sourceLocator;
    expect(loc?.page).toBe(1);
    const lines = (await snapshotText(readFileSync(page), 'text/html'))[0];
    expect(lines[(loc?.line ?? 0) - 1]).toContain('LOG3430');
  });

  it('une deuxième collecte de la même page ne change rien', async () => {
    await collectPoly(db, source, rawDir, '2026-11-10T10:00:00.000Z');
    const again = await collectPoly(db, source, rawDir, '2026-11-11T10:00:00.000Z');
    expect(again.diff).toEqual({ added: [], removed: [], modified: [] });
    expect(listPolyCourses(db)).toHaveLength(16);
  });

  it('désactive les cours qui ont disparu de la page et les réactive à leur retour', async () => {
    await collectPoly(db, source, rawDir, '2026-11-10T10:00:00.000Z');
    const html = readFileSync(page, 'utf8');
    // Retire LOG8100 (une seule ligne de cours parmi seize : perte inférieure à 30 %).
    const start = html.lastIndexOf('<tr class="titre">', html.indexOf('>LOG8100<'));
    const end = html.indexOf('</tr>', html.indexOf('<tr class="contenu">', start)) + '</tr>'.length;
    writeFileSync(page, html.slice(0, start) + html.slice(end));

    const res = await collectPoly(db, source, rawDir, '2026-11-11T10:00:00.000Z');
    expect(res.status).toBe('ok');
    expect(res.diff).toEqual({ added: [], removed: ['LOG8100'], modified: [] });
    expect(listPolyCourses(db).map((c) => c.sigle)).not.toContain('LOG8100');
    expect(db.prepare("SELECT active FROM poly_courses WHERE sigle = 'LOG8100'").get()).toEqual({ active: 0 });

    writeFileSync(page, html);
    const back = await collectPoly(db, source, rawDir, '2026-11-12T10:00:00.000Z');
    expect(back.diff).toEqual({ added: ['LOG8100'], removed: [], modified: [] });
    expect(db.prepare("SELECT active FROM poly_courses WHERE sigle = 'LOG8100'").get()).toEqual({ active: 1 });
  });

  it('échoue sans toucher aux cours quand la page ne contient aucun cours', async () => {
    await collectPoly(db, source, rawDir, '2026-11-10T10:00:00.000Z');
    writeFileSync(page, '<html><body><p>Page vide</p></body></html>');
    const res = await collectPoly(db, source, rawDir, '2026-11-11T10:00:00.000Z');
    expect(res).toEqual({ status: 'failed', diff: null, reason: 'Aucun cours lu' });
    expect(listPolyCourses(db)).toHaveLength(16);
    expect(lastRun(db, 'poly-log')?.status).toBe('failed');
  });

  it('échoue quand plus de 30 % des cours ont disparu', async () => {
    await collectPoly(db, source, rawDir, '2026-11-10T10:00:00.000Z');
    const html = readFileSync(page, 'utf8');
    writeFileSync(page, html.slice(0, html.indexOf('>LOG3430<')) + '</body></html>');
    const res = await collectPoly(db, source, rawDir, '2026-11-11T10:00:00.000Z');
    expect(res.status).toBe('failed');
    expect(res.reason).toMatch(/perte de plus de 30 %/);
    expect(listPolyCourses(db)).toHaveLength(16);
  });

  it("échoue proprement quand le fichier enregistré est absent, en le nommant", async () => {
    rmSync(page);
    const res = await collectPoly(db, source, rawDir, '2026-11-10T10:00:00.000Z');
    expect(res.status).toBe('failed');
    expect(res.reason).toContain(`Fichier enregistré absent : ${page}`);
    expect(lastRun(db, 'poly-log')?.status).toBe('failed');
  });

  it('avec --accept-loss, une perte de plus de 30 % passe et sa raison est notée', async () => {
    await collectPoly(db, source, rawDir, '2026-11-10T10:00:00.000Z');
    const html = readFileSync(page, 'utf8');
    writeFileSync(page, html.slice(0, html.indexOf('>LOG3430<')) + '</body></html>');
    const res = await collectPoly(db, source, rawDir, '2026-11-11T10:00:00.000Z', { acceptLoss: 'Programme réduit' });
    expect(res.status).toBe('ok');
    expect(res.permanent?.[0]).toBe('2026-11-11T10:00Z Perte acceptée (--accept-loss) : Programme réduit');
    expect(listPolyCourses(db).length).toBeLessThan(16);
  });

  it('signale une page de Poly enregistrée il y a plus de 300 jours', async () => {
    const old = new Date('2025-09-01T10:00:00.000Z');
    utimesSync(page, old, old);
    const res = await collectPoly(db, source, rawDir, '2026-11-10T10:00:00.000Z');
    expect(res.warnings).toEqual(['Pages enregistrées le 2025-09-01 : à réenregistrer depuis un navigateur (source poly-log)']);
  });
});
