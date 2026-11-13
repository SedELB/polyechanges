import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { SITE_DATA_FILES } from '../../shared/siteData.js';
import type { HostCourseInput, PolyCourse, Provenance, University } from '../../shared/types.js';
import { applyCollection } from '../db/hostCourses.js';
import { replaceMatches, type MatchRow } from '../db/matches.js';
import { openDb, type Db } from '../db/open.js';
import { upsertPolyCourses } from '../db/polyCourses.js';
import { recordRun } from '../db/runs.js';
import { upsertUniversity } from '../db/universities.js';
import { loadCriterion } from '../criterion/loadCriterion.js';
import { exportSiteData } from './export.js';

const prov: Provenance = {
  url: 'https://u.example', retrievedAt: '2026-01-01', sha256: 'abc', locator: { page: 1, line: 2 }, quote: 'Taipei',
};

const uni = (id: string, provenance: University['provenance'] = { city: prov }): University => ({
  id, name: id, moveOnName: id, countryCode: 'TW', city: 'x', lat: 0, lng: 0, website: 'https://x',
  catalogUrl: null, creditSystem: 'ECTS', contactHoursPerCredit: null,
  terms: { fall: null, spring: null }, restrictions: null, exchangeContact: null, catalogPublic: true, provenance,
});

const poly = (sigle: string, eligible = true): PolyCourse => ({
  sigle, title: 'T', description: 'D', credits: 3, triplet: [3, 1.5, 4.5], prerequisites: '',
  status: 'optionnel', eligible, ineligibleReason: eligible ? null : 'non', compared: eligible,
  groups: ['Bloc A'], sourceUrl: 'https://poly.example', collectedAt: '2026-01-01',
  sourceLocator: { sha256: 'def', page: 1, line: 3 },
});

const course = (code: string, over: Partial<HostCourseInput> = {}): HostCourseInput => ({
  code, title: 'Databases', description: 'SQL', outline: null, credits: 6, contactHours: null,
  language: 'en', terms: ['fall'], level: 'undergrad', sourceUrl: 'https://h.example/' + code, ...over,
});

const match = (polySigle: string, hostCourseId: number, level: MatchRow['level']): MatchRow => ({
  polySigle, hostCourseId, notionsFound: ['sql'], notionsMissing: [], notionSims: { sql: 0.9 },
  contentScore: 1, contentBand: 'tres', workload: 'conforme', level, textUsed: 'description',
});

const hostId = (db: Db, code: string) =>
  (db.prepare('SELECT id FROM host_courses WHERE code = ?').get(code) as { id: number }).id;

let db: Db;
let tmp: string;
let criterionDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'export-'));
  criterionDir = mkdtempSync(join(tmpdir(), 'criterion-'));
  mkdirSync(join(criterionDir, 'v0'));
  writeFileSync(
    join(criterionDir, 'v0', 'criterion.json'),
    JSON.stringify({
      version: 'v0',
      model: {
        slug: 'm', id: 'm', revision: 'r', dtype: 'fp32', pooling: 'mean', prefixes: { notion: '', passage: '' },
        sizeMillions: 1, library: '@huggingface/transformers@4.3.2',
      },
      detectThreshold: 0.5, bandHigh: 0.7, bandLow: 0.4, workloadTolerance: 0.15, polyWeeks: 13,
    }),
  );
  writeFileSync(join(criterionDir, 'v0', 'notions.json'), JSON.stringify({ INF3710: [{ id: 'sql', fr: 'SQL', en: 'SQL' }] }));

  db = openDb(':memory:');
  upsertUniversity(db, uni('ntu-tw'));
  upsertUniversity(db, uni('a-tw'));
  upsertPolyCourses(db, [poly('INF3710'), { ...poly('ABC1000', false), sourceLocator: null }]);
  db.prepare("INSERT INTO sources (id, university_id, kind, url, reader) VALUES ('poly-log', NULL, 'saved', 'https://poly.example/programme', 'poly')").run();
  db.prepare(
    "INSERT INTO snapshots (id, source_id, url, fetched_at, sha256, path, content_type) VALUES (50, 'poly-log','https://poly.example/programme','2026-01-01','def','poly-log/def.html','text/html')",
  ).run();
  db.prepare("INSERT INTO sources (id, university_id, kind, url, reader) VALUES ('ntu-tw','ntu-tw','html','https://x','r')").run();
  db.prepare(
    "INSERT INTO snapshots (id, source_id, url, fetched_at, sha256, path, content_type) VALUES (1,'ntu-tw','https://x','2026-01-02','shaX','p','text/html')",
  ).run();
  applyCollection(
    db, 'ntu-tw',
    [course('B2'), course('A1', { language: 'unknown', level: 'grad' }), course('O1', { language: 'other' })],
    () => 1, '2026-01-02', () => ({ page: 2, line: 5 }),
  );
  // Cours retiré de la page : désactivé, jamais exporté.
  applyCollection(db, 'a-tw', [course('Z9')], () => null, '2026-01-01');
  db.prepare("UPDATE host_courses SET active = 0 WHERE code = 'Z9'").run();
  db.prepare("INSERT INTO criterion_versions (version, params_hash, params_json) VALUES ('v0', ?, '{}')").run(loadCriterion('v0', criterionDir).paramsHash);
  replaceMatches(db, 'v0', [
    match('INF3710', hostId(db, 'B2'), 'elevee'),
    match('INF3710', hostId(db, 'A1'), 'moyenne'),
    match('INF3710', hostId(db, 'O1'), null),
  ]);
  recordRun(db, {
    sourceId: 'ntu-tw', startedAt: '2026-01-02', status: 'ok', coursesFound: 3, previousCount: 3,
    added: 0, removed: 0, modified: 0, failureReason: null,
  });
});

const read = (name: string) => JSON.parse(readFileSync(join(tmp, `${name}.json`), 'utf8'));

describe('exportSiteData', () => {
  it('porte l’année du catalogue sur les cours dont la description vient d’une source datée, et seulement eux', async () => {
    const sourcesDir = mkdtempSync(join(tmpdir(), 'sources-'));
    writeFileSync(
      join(sourcesDir, 'ntu-tw-catalogue.json'),
      JSON.stringify({
        id: 'ntu-tw-catalogue', universityId: 'ntu-tw', kind: 'pdf', urls: ['https://h.example/B2'],
        reader: 'r', role: 'enrich', descriptionsDated: '2020',
      }),
    );
    await exportSiteData(db, 'v0', tmp, criterionDir, sourcesDir);
    const byCode = Object.fromEntries(read('host-courses').map((c: { code: string }) => [c.code, c]));
    expect(byCode.B2.descriptionsDated).toBe('2020');
    expect('descriptionsDated' in byCode.A1).toBe(false);
  });

  it('sans source datée, le fichier des cours n’a aucun champ descriptionsDated', async () => {
    const sourcesDir = mkdtempSync(join(tmpdir(), 'sources-'));
    await exportSiteData(db, 'v0', tmp, criterionDir, sourcesDir);
    expect(readFileSync(join(tmp, 'host-courses.json'), 'utf8')).not.toContain('descriptionsDated');
  });

  it('écrit les six fichiers, indentés de 2 espaces, avec saut de ligne final', async () => {
    await exportSiteData(db, 'v0', tmp, criterionDir);
    expect(readdirSync(tmp).sort()).toEqual(SITE_DATA_FILES.map((f) => `${f}.json`).sort());
    const text = readFileSync(join(tmp, 'meta.json'), 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "criterionVersion": "v0"');
  });

  it('deux exports successifs sont identiques octet par octet', async () => {
    const other = mkdtempSync(join(tmpdir(), 'export-b-'));
    await exportSiteData(db, 'v0', tmp, criterionDir);
    await new Promise((r) => setTimeout(r, 5));
    await exportSiteData(db, 'v0', other, criterionDir);
    for (const f of SITE_DATA_FILES) {
      expect(readFileSync(join(other, `${f}.json`)).equals(readFileSync(join(tmp, `${f}.json`)))).toBe(true);
    }
  });

  it('remplace un export précédent sans laisser de dossier temporaire', async () => {
    await exportSiteData(db, 'v0', tmp, criterionDir);
    await exportSiteData(db, 'v0', tmp, criterionDir);
    expect(readdirSync(tmp).sort()).toEqual(SITE_DATA_FILES.map((f) => `${f}.json`).sort());
    expect(readdirSync(join(tmp, '..')).filter((n) => n === basename(tmp) + '.tmp' || n === basename(tmp) + '.old')).toEqual([]);
  });

  it('meta : date de collecte la plus récente, semaines, tolérance et catalogues non lus', async () => {
    await exportSiteData(db, 'v0', tmp, criterionDir);
    // a-tw : catalogue public mais aucun cours actif en base (université ignorée faute de pages, par exemple).
    expect(read('meta')).toEqual({
      criterionVersion: 'v0', generatedAt: '2026-01-02', polyWeeks: 13, workloadTolerance: 0.15, unreadCatalogs: ['a-tw'],
    });
  });

  it('un catalogue non public sans cours n’est pas compté comme non lu', async () => {
    upsertUniversity(db, { ...uni('a-tw'), catalogPublic: false });
    await exportSiteData(db, 'v0', tmp, criterionDir);
    expect(read('meta').unreadCatalogs).toEqual([]);
  });

  it('refuse un site sans cours de Poly comparé et dit d’enregistrer la page du programme', async () => {
    const sourcesDir = mkdtempSync(join(tmpdir(), 'sources-'));
    writeFileSync(
      join(sourcesDir, 'poly-log.json'),
      JSON.stringify({
        id: 'poly-log', universityId: null, kind: 'saved', urls: ['https://poly.example/programme'],
        files: ['data/manual/poly/programme-LOG.html'], reader: 'poly',
      }),
    );
    db.prepare("UPDATE poly_courses SET active = 0 WHERE sigle = 'INF3710'").run();
    await expect(exportSiteData(db, 'v0', tmp, criterionDir, sourcesDir)).rejects.toThrow(
      /aucun cours de Poly comparé.*data\/manual\/poly\/programme-LOG\.html/,
    );
    expect(readdirSync(tmp)).toHaveLength(0);
  });

  it('refuse un cours de Poly comparé sans grille comme s’il n’y en avait aucun', async () => {
    upsertPolyCourses(db, [{ ...poly('INF3710'), sigle: 'LOG9999' }]);
    db.prepare("UPDATE poly_courses SET active = 0 WHERE sigle = 'INF3710'").run();
    await expect(exportSiteData(db, 'v0', tmp, criterionDir)).rejects.toThrow(/aucun cours de Poly comparé/);
  });

  it('refuse un site sans aucune paire calculée', async () => {
    db.prepare("DELETE FROM matches WHERE criterion_version = 'v0'").run();
    await expect(exportSiteData(db, 'v0', tmp, criterionDir)).rejects.toThrow(/aucune paire calculée.*page du programme de Poly/);
    expect(readdirSync(tmp)).toHaveLength(0);
  });

  it('n’exporte pas les paires de niveau null, triées par sigle puis cours d’accueil', async () => {
    await exportSiteData(db, 'v0', tmp, criterionDir);
    const matches = read('matches');
    expect(matches).toHaveLength(2);
    expect(matches.every((m: { level: unknown }) => m.level !== null)).toBe(true);
    const ids = matches.map((m: { hostCourseId: number }) => m.hostCourseId);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('exporte tous les cours de Poly, avec sections et position', async () => {
    await exportSiteData(db, 'v0', tmp, criterionDir);
    const list = read('poly-courses');
    expect(list.map((c: PolyCourse) => c.sigle)).toEqual(['ABC1000', 'INF3710']);
    expect(list[1].groups).toEqual(['Bloc A']);
    expect(list[1].sourceLocator).toEqual({ sha256: 'def', page: 1, line: 3 });
    // Adresse de la copie lue (page du programme), retrouvée par l'empreinte de la position.
    expect(list[1].pageUrl).toBe('https://poly.example/programme');
    expect(list[0].pageUrl).toBeNull();
  });

  it('exporte les cours d’accueil actifs en anglais ou de langue inconnue, avec leur copie brute', async () => {
    await exportSiteData(db, 'v0', tmp, criterionDir);
    const hosts = read('host-courses');
    expect(hosts.map((h: { code: string }) => h.code)).toEqual(['B2', 'A1']);
    expect(hosts[0]).toMatchObject({ sourcePage: 2, sourceLine: 5, snapshotSha256: 'shaX', collectedAt: '2026-01-02' });
    expect(hosts[0]).not.toHaveProperty('outline');
    expect(hosts.map((h: { level: string }) => h.level)).toEqual(['undergrad', 'grad']);
  });

  it('exporte les universités avec leur provenance et les notions', async () => {
    await exportSiteData(db, 'v0', tmp, criterionDir);
    expect(read('universities').map((u: University) => u.id)).toEqual(['a-tw', 'ntu-tw']);
    expect(read('universities')[0].provenance.city.quote).toBe('Taipei');
    expect(read('notions').INF3710[0].id).toBe('sql');
  });

  it('bloque l’export si la dernière collecte a échoué', async () => {
    recordRun(db, {
      sourceId: 'ntu-tw', startedAt: '2026-01-05', status: 'failed', coursesFound: 0, previousCount: 3,
      added: 0, removed: 0, modified: 0, failureReason: 'x',
    });
    await expect(exportSiteData(db, 'v0', tmp, criterionDir)).rejects.toThrow('ntu-tw');
    expect(readdirSync(tmp)).toHaveLength(0);
  });

  it('bloque l’export si un fait d’université est périmé', async () => {
    upsertUniversity(db, uni('a-tw', { city: { ...prov, stale: true } }));
    await expect(exportSiteData(db, 'v0', tmp, criterionDir)).rejects.toThrow(/city.*a-tw/);
    expect(readdirSync(tmp)).toHaveLength(0);
  });
});
