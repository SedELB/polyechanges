import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/open.js';
import { upsertUniversity } from '../db/universities.js';
import { activeHostCourses } from '../db/hostCourses.js';
import { lastRun } from '../db/runs.js';
import { createPoliteFetcher } from '../fetch/politeFetch.js';
import { relocateCourses } from '../provenance/relocate.js';
import { startTestServer, type TestServer } from '../fetch/testServer.js';
import type { HostCourseInput, University } from '../../shared/types.js';
import { collectSource, collectUniversity } from './collect.js';
import { collectJobs } from './jobs.js';
import { registerReader } from './readers.js';
import { renderReport, writeReport } from './report.js';
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

describe('source sans descriptions publiées', () => {
  const noDescriptions = (): SourceFile => ({
    ...htmlSource(),
    descriptions: 'none',
    descriptionsNote: 'Seulement les titres.',
  });
  const titleOnly = (code: string): HostCourseInput => ({ ...course(code), description: '' });

  it('accepte des descriptions toutes vides', async () => {
    current = [titleOnly('A'), titleOnly('B'), titleOnly('C')];
    const res = await collectSource(db, fetcher, noDescriptions(), tmp, '2026-11-10T10:00:00.000Z');
    expect(res.status).toBe('ok');
  });

  it('garde le contrôle des descriptions vides pour les autres sources', async () => {
    current = [titleOnly('A'), titleOnly('B'), titleOnly('C')];
    const res = await collectSource(db, fetcher, htmlSource(), tmp, '2026-11-10T10:00:00.000Z');
    expect(res).toMatchObject({ status: 'failed', reason: '3 descriptions vides sur 3' });
  });

  it('garde les autres garde-fous', async () => {
    current = [];
    const res = await collectSource(db, fetcher, noDescriptions(), tmp, '2026-11-10T10:00:00.000Z');
    expect(res.status).toBe('failed');
  });
});

describe('renderReport, note de descriptions', () => {
  it('écrit la note de la source', () => {
    const text = renderReport({
      sourceId: 's', date: '2026-11-11', status: 'ok', courseCount: 1, diff: null, reason: null,
      descriptionsNote: 'Seulement les titres.',
    });
    expect(text).toContain('Descriptions non publiées : Seulement les titres.');
  });
});

/** Lecteur de test d'une liste enregistrée en texte : une ligne `code<TAB>titre<TAB>description<TAB>langue<TAB>trimestre`. */
registerReader('lignes', (pages) =>
  pages.flatMap((p) =>
    p.body
      .toString('utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .map((l): HostCourseInput => {
        const [code, title, description = '', language = 'unknown', term] = l.split('\t');
        return {
          code,
          title,
          description,
          outline: null,
          credits: null,
          contactHours: null,
          language: language as HostCourseInput['language'],
          terms: term ? [term as 'fall' | 'spring'] : [],
          level: 'undergrad',
          sourceUrl: p.url,
        };
      }),
  ),
);

describe('source enregistrée d’une université d’accueil', () => {
  const SAVED_AT = new Date('2026-10-20T09:00:00.000Z');
  const NOW = '2026-11-10T10:00:00.000Z';
  /** Adresse d'origine sur le serveur de test : tout téléchargement de la page enregistrée serait compté. */
  const listUrl = () => `${server.base}/liste`;

  /** Écrit `data/saved/ntu/<name>` sous la racine de test et renvoie son chemin depuis la racine. */
  function save(name: string, body: string, at = SAVED_AT): string {
    mkdirSync(join(tmp, 'data', 'saved', 'ntu'), { recursive: true });
    writeFileSync(join(tmp, 'data', 'saved', 'ntu', name), body);
    utimesSync(join(tmp, 'data', 'saved', 'ntu', name), at, at);
    return `data/saved/ntu/${name}`;
  }

  const listSource = (files: string[], extra: Partial<SourceFile> = {}): SourceFile =>
    parseSourceFile({ id: 'ntu-liste', universityId: 'ntu', kind: 'saved', urls: files.map(() => listUrl()), files, reader: 'lignes', ...extra });

  const opts = () => ({ rootDir: tmp });

  it('un lecteur asynchrone (extraction d’un PDF) est attendu avant la fusion', async () => {
    registerReader('lignes-async', async (pages) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return pages.map((p) => ({ ...course('Z1'), sourceUrl: p.url }));
    });
    const file = save('async.txt', 'Z1 - Cours lu en différé\n');
    const source = parseSourceFile({ id: 'ntu-async', universityId: 'ntu', kind: 'saved', urls: [listUrl()], files: [file], reader: 'lignes-async' });
    const res = await collectSource(db, fetcher, source, join(tmp, 'raw'), NOW, opts());
    expect(res).toEqual({ status: 'ok', diff: { added: ['Z1'], removed: [], modified: [] }, reason: null });
  });

  it('lit une page enregistrée sans requête réseau : copie brute, date du fichier, position du code', async () => {
    const file = save('liste.html', '<html><body><h1>Cours</h1><p>A1 - Intro</p><p>B2 - Algo</p></body></html>');
    const source = parseSourceFile({ id: 'ntu-liste', universityId: 'ntu', kind: 'saved', urls: [listUrl()], files: [file], reader: 'test' });
    current = [course('A1'), course('B2')];
    const hitsBefore = server.hits.length;
    const res = await collectSource(db, fetcher, source, join(tmp, 'raw'), NOW, opts());
    expect(res).toEqual({ status: 'ok', diff: { added: ['A1', 'B2'], removed: [], modified: [] }, reason: null });
    expect(server.hits.length).toBe(hitsBefore);
    const rows = db
      .prepare('SELECT h.code, h.source_line, s.url, s.fetched_at, s.content_type FROM host_courses h JOIN snapshots s ON s.id = h.snapshot_id ORDER BY h.code')
      .all();
    expect(rows).toEqual([
      { code: 'A1', source_line: 2, url: listUrl(), fetched_at: SAVED_AT.toISOString(), content_type: 'text/html' },
      { code: 'B2', source_line: 3, url: listUrl(), fetched_at: SAVED_AT.toISOString(), content_type: 'text/html' },
    ]);
  });

  it('plusieurs fichiers de même adresse : chaque cours garde la copie et la ligne du fichier où son code est', async () => {
    const one = save('page-1.txt', 'A1\tAlpha\tDescription A1.\nA2\tBeta\tDescription A2.\n');
    const two = save('page-2.txt', 'B0\tGamma\tDescription B0.\nB1\tDelta\tDescription B1.\n');
    const sha = (f: string) => createHash('sha256').update(readFileSync(join(tmp, f))).digest('hex');
    const rawDir = join(tmp, 'raw');
    const res = await collectSource(db, fetcher, listSource([one, two]), rawDir, NOW, opts());
    expect(res.status).toBe('ok');
    const placed = () =>
      db
        .prepare('SELECT h.code, s.sha256, h.source_line FROM host_courses h JOIN snapshots s ON s.id = h.snapshot_id ORDER BY h.code')
        .all();
    const expected = [
      { code: 'A1', sha256: sha(one), source_line: 1 },
      { code: 'A2', sha256: sha(one), source_line: 2 },
      { code: 'B0', sha256: sha(two), source_line: 1 },
      { code: 'B1', sha256: sha(two), source_line: 2 },
    ];
    expect(placed()).toEqual(expected);

    db.prepare("UPDATE host_courses SET source_line = 9 WHERE code = 'B1'").run();
    await relocateCourses(db, rawDir);
    expect(placed()).toEqual(expected);
  });

  it('un lecteur peut citer la rangée retenue : la ligne et la copie fournies l’emportent sur la première apparition du code', async () => {
    registerReader('lignes-placees', (pages) => [
      // A1 apparaît d'abord ligne 1 du premier fichier (section écartée), la section retenue est ligne 2 du second.
      { ...course('A1'), sourceUrl: pages[0].url, placement: { pageIndex: 1, line: 2 } },
      // Ligne fournie qui ne contient pas le code : retour à la première apparition.
      { ...course('A2'), sourceUrl: pages[0].url, placement: { pageIndex: 0, line: 3 } },
      // Fichier fourni hors des pages : retour à la première apparition.
      { ...course('A3'), sourceUrl: pages[0].url, placement: { pageIndex: 9, line: 1 } },
    ]);
    const one = save('placee-1.txt', 'A1\tAlpha\tcoréen\nA2\tBeta\nA3\tGamma\nA3 bis\n');
    const two = save('placee-2.txt', 'B0\tAutre\nA1\tAlpha\tanglais\n');
    const sha = (f: string) => createHash('sha256').update(readFileSync(join(tmp, f))).digest('hex');
    const source = parseSourceFile({ id: 'ntu-placee', universityId: 'ntu', kind: 'saved', urls: [listUrl(), listUrl()], files: [one, two], reader: 'lignes-placees' });
    const res = await collectSource(db, fetcher, source, join(tmp, 'raw'), NOW, opts());
    expect(res.status).toBe('ok');
    const placed = db
      .prepare('SELECT h.code, s.sha256, h.source_line FROM host_courses h JOIN snapshots s ON s.id = h.snapshot_id ORDER BY h.code')
      .all();
    expect(placed).toEqual([
      { code: 'A1', sha256: sha(two), source_line: 2 },
      { code: 'A2', sha256: sha(one), source_line: 2 },
      { code: 'A3', sha256: sha(one), source_line: 3 },
    ]);
  });

  it('fichier absent : la collecte échoue en nommant le fichier, sans toucher aux cours existants', async () => {
    current = [course('A1'), course('A2')];
    await collectSource(db, fetcher, htmlSource(), tmp, NOW);
    const res = await collectUniversity(db, fetcher, [htmlSource(), listSource(['data/saved/ntu/absent.txt'])], join(tmp, 'raw'), NOW, opts());
    expect(res.status).toBe('failed');
    expect(res.reason).toMatch(/^ntu-liste : .*data\/saved\/ntu\/absent\.txt.*navigateur/);
    expect(activeHostCourses(db, 'ntu').map((c) => c.code)).toEqual(['A1', 'A2']);
    expect(lastRun(db, 'ntu-catalogue')?.status).toBe('failed');
    expect(lastRun(db, 'ntu-liste')?.status).toBe('failed');
  });

  it('deux sources d’une même université : la collecte par l’id de l’une ne désactive pas les cours de l’autre', async () => {
    const txt = save('liste.txt', 'B1\tGraphes\tThéorie des graphes.\nB2\tCompilateurs\tAnalyse et génération de code.\n');
    const catalogue = { ...htmlSource(), fileName: 'ntu.json' };
    const liste = { ...listSource([txt]), fileName: 'ntu-liste.json' };
    current = [course('A1'), course('A2'), course('A3')];

    const [job] = collectJobs('ntu-liste', [liste, catalogue]);
    if (job?.kind !== 'university') throw new Error('collecte inattendue');
    expect(job.sources.map((s) => s.id)).toEqual(['ntu-catalogue', 'ntu-liste']);
    const first = await collectUniversity(db, fetcher, job.sources, join(tmp, 'raw'), NOW, opts());
    expect(first.diff?.added).toEqual(['A1', 'A2', 'A3', 'B1', 'B2']);

    const again = await collectUniversity(db, fetcher, job.sources, join(tmp, 'raw'), '2026-11-11T10:00:00.000Z', opts());
    expect(again.diff).toEqual({ added: [], removed: [], modified: [] });
    expect(activeHostCourses(db, 'ntu').map((c) => c.code)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2']);
    expect(lastRun(db, 'ntu-catalogue')?.status).toBe('ok');
    expect(lastRun(db, 'ntu-liste')?.status).toBe('ok');
    const b1 = db
      .prepare("SELECT h.source_line, s.content_type, s.url FROM host_courses h JOIN snapshots s ON s.id = h.snapshot_id WHERE code = 'B1'")
      .get();
    expect(b1).toEqual({ source_line: 1, content_type: 'text/plain', url: listUrl() });
    expect(again.notes?.[0]).toBe('Sources : ntu-catalogue (html), ntu-liste (saved)');
  });

  it('une liste enrich complète les cours existants et le rapport compte les codes ignorés', async () => {
    const txt = save('liste.txt', 'A1\tIntroduction to Computing\t\ten\tspring\nZ9\tHors périmètre\t\ten\tfall\n');
    current = [{ ...course('A1'), language: 'unknown' }, course('A2'), course('A3')];
    const res = await collectUniversity(
      db,
      fetcher,
      [htmlSource(), listSource([txt], { role: 'enrich', priority: 1, descriptions: 'none', descriptionsNote: 'Liste des cours ouverts.' })],
      join(tmp, 'raw'),
      NOW,
      opts(),
    );
    expect(res.status).toBe('ok');
    expect(res.diff?.added).toEqual(['A1', 'A2', 'A3']);
    const a1 = activeHostCourses(db, 'ntu').find((c) => c.code === 'A1');
    expect(a1).toMatchObject({
      title: 'Introduction to Computing',
      language: 'en',
      description: 'Description de A1',
      sourceUrl: 'https://example.org/A1',
    });
    expect([...(a1?.terms ?? [])].sort()).toEqual(['fall', 'spring']);
    expect(res.notes).toContain('Codes ignorés de la source ntu-liste (enrich, absents des autres sources) : 1');
  });

  it('descriptions: none se juge sur le résultat fusionné', async () => {
    const txt = save('liste.txt', 'B1\tGraphes\nB2\tCompilateurs\n');
    const titleOnly = (code: string): HostCourseInput => ({ ...course(code), description: '' });
    const none = { descriptions: 'none' as const, descriptionsNote: 'Seulement les titres.' };
    current = [titleOnly('A1'), titleOnly('A2')];
    const mixed = await collectUniversity(db, fetcher, [{ ...htmlSource(), ...none }, listSource([txt])], join(tmp, 'raw'), NOW, opts());
    expect(mixed).toMatchObject({ status: 'failed', reason: '4 descriptions vides sur 4' });
    const both = await collectUniversity(db, fetcher, [{ ...htmlSource(), ...none }, listSource([txt], none)], join(tmp, 'raw'), NOW, opts());
    expect(both.status).toBe('ok');
  });

  it('descriptions: none de la source principale : une source enrich avec quelques descriptions ne change rien', async () => {
    const txt = save('liste.txt', 'A1\tGraphes\tThéorie des graphes.\n');
    const titleOnly = (code: string): HostCourseInput => ({ ...course(code), description: '' });
    const none = { descriptions: 'none' as const, descriptionsNote: 'Seulement les titres.' };
    current = [titleOnly('A1'), titleOnly('A2'), titleOnly('A3'), titleOnly('A4')];
    const enrich = listSource([txt], { role: 'enrich' });
    const ok = await collectUniversity(db, fetcher, [{ ...htmlSource(), ...none }, enrich], join(tmp, 'raw'), NOW, opts());
    expect(ok.status).toBe('ok');
    expect(activeHostCourses(db, 'ntu').filter((c) => c.description !== '')).toHaveLength(1);
    // Sans « none » sur la source principale, trop de descriptions vides échouent toujours.
    const bad = await collectUniversity(db, fetcher, [htmlSource(), enrich], join(tmp, 'raw'), NOW, opts());
    expect(bad).toMatchObject({ status: 'failed', reason: '3 descriptions vides sur 4' });
  });

  it('pages enregistrées il y a plus de 300 jours : le rapport l’écrit en tête', async () => {
    const txt = save('liste.txt', 'B1\tGraphes\tThéorie des graphes.\n', new Date('2025-11-01T12:00:00.000Z'));
    const res = await collectSource(db, fetcher, listSource([txt]), join(tmp, 'raw'), NOW, opts());
    expect(res.status).toBe('ok');
    expect(res.warnings).toEqual(['Pages enregistrées le 2025-11-01 : à réenregistrer depuis un navigateur (source ntu-liste)']);
    const text = renderReport({ sourceId: 'ntu', date: '2026-11-10', status: res.status, courseCount: 1, diff: res.diff, reason: null, warnings: res.warnings });
    expect(text.split('\n')[0]).toBe('Pages enregistrées le 2025-11-01 : à réenregistrer depuis un navigateur (source ntu-liste)');
  });
});

describe('baisse voulue', () => {
  const ten = () => Array.from({ length: 10 }, (_, i) => course(`C${i}`));

  it('sans --accept-loss, une perte de plus de 30 % échoue et ne retire rien', async () => {
    current = ten();
    await collectSource(db, fetcher, htmlSource(), tmp, '2026-11-10T10:00:00.000Z');
    current = ten().slice(0, 3);
    const res = await collectSource(db, fetcher, htmlSource(), tmp, '2026-11-11T10:00:00.000Z');
    expect(res.status).toBe('failed');
    expect(res.reason).toMatch(/3 cours lus contre 10 .*perte de plus de 30 %.*--accept-loss/);
    expect(activeHostCourses(db, 'ntu')).toHaveLength(10);
  });

  it('avec --accept-loss, la perte passe et le rapport écrit la raison et les codes retirés', async () => {
    current = ten();
    await collectSource(db, fetcher, htmlSource(), tmp, '2026-11-10T10:00:00.000Z');
    current = ten().slice(0, 3);
    const res = await collectSource(db, fetcher, htmlSource(), tmp, '2026-11-11T10:00:00.000Z', {
      acceptLoss: 'NTU ne publie plus que les cours en anglais',
    });
    expect(res.status).toBe('ok');
    expect(res.diff?.removed).toEqual(['C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9']);
    expect(activeHostCourses(db, 'ntu')).toHaveLength(3);

    const report = (r: typeof res) =>
      writeReport(join(tmp, 'reports'), {
        sourceId: 'ntu',
        date: '2026-11-11',
        status: r.status,
        courseCount: activeHostCourses(db, 'ntu').length,
        diff: r.diff,
        reason: r.reason,
        notes: r.notes,
        permanent: r.permanent,
      });
    const lines = [
      '2026-11-11T10:00Z Perte acceptée (--accept-loss) : NTU ne publie plus que les cours en anglais',
      '2026-11-11T10:00Z Codes retirés par cette baisse voulue (7) : C3, C4, C5, C6, C7, C8, C9',
    ];
    expect(readFileSync(report(res), 'utf8')).toContain(lines.join('\n'));

    // Une autre collecte du même jour réécrit le bloc automatique, jamais les lignes de la baisse voulue.
    const later = await collectSource(db, fetcher, htmlSource(), tmp, '2026-11-11T15:00:00.000Z');
    expect(later.permanent).toBeUndefined();
    const text = readFileSync(report(later), 'utf8');
    expect(text).toContain('Retirés (0) : aucun');
    expect(text).toContain(lines.join('\n'));
    expect(text.indexOf(lines[0])).toBeGreaterThan(text.indexOf('=== fin de la collecte automatique ==='));
  });

  it('--accept-loss sans perte ne change rien et le dit', async () => {
    current = ten();
    await collectSource(db, fetcher, htmlSource(), tmp, '2026-11-10T10:00:00.000Z');
    const res = await collectSource(db, fetcher, htmlSource(), tmp, '2026-11-11T10:00:00.000Z', { acceptLoss: 'inutile' });
    expect(res.status).toBe('ok');
    expect(res.notes).toEqual(['Option --accept-loss sans effet : pas de perte de plus de 30 %']);
  });
});
