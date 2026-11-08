import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { openDb } from './open.js';
import { getUniversity, upsertUniversity } from './universities.js';
import { listPolyCourses, upsertPolyCourses } from './polyCourses.js';
import type { PolyCourse, University } from '../../shared/types.js';

const ntuFixture: University = {
  id: 'ntu-tw',
  name: 'National Taiwan University',
  moveOnName: 'National Taiwan University',
  countryCode: 'TW',
  city: 'Taipei',
  lat: 25.0174,
  lng: 121.5397,
  website: 'https://www.ntu.edu.tw',
  catalogUrl: null,
  creditSystem: 'local',
  contactHoursPerCredit: 1,
  terms: {
    fall: { start: '2027-09-06', end: '2028-01-07', examsEnd: '2028-01-07' },
    spring: null,
  },
  restrictions: null,
  exchangeContact: null,
  catalogPublic: true,
  provenance: {},
};

const inf3710Fixture: PolyCourse = {
  sigle: 'INF3710',
  title: 'Fichiers et bases de données',
  description: 'Modèle relationnel et SQL.',
  credits: 3,
  triplet: [3, 1.5, 4.5],
  prerequisites: 'INF2010',
  status: 'obligatoire',
  eligible: true,
  ineligibleReason: null,
  compared: true,
  groups: ['Filière classique (93 crédits)'],
  sourceUrl: 'https://www.polymtl.ca/programmes/cours/fichiers-et-bases-de-donnees',
  collectedAt: '2026-11-10',
  sourceLocator: null,
};

describe('base de données', () => {
  it('crée le schéma et relit une université', () => {
    const db = openDb(':memory:');
    upsertUniversity(db, ntuFixture);
    expect(getUniversity(db, 'ntu-tw')).toEqual(ntuFixture);
    expect(getUniversity(db, 'absente')).toBeNull();
  });

  it('relit les cours de Poly avec leur triplet', () => {
    const db = openDb(':memory:');
    upsertPolyCourses(db, [inf3710Fixture]);
    expect(listPolyCourses(db)[0].triplet).toEqual([3, 1.5, 4.5]);
    expect(listPolyCourses(db)[0]).toEqual(inf3710Fixture);
  });
  it('garde les sections des cours de Poly et masque les cours retirés', () => {
    const db = openDb(':memory:');
    upsertPolyCourses(db, [inf3710Fixture, { ...inf3710Fixture, sigle: 'INF9999', groups: ['A', 'B'] }]);
    expect(listPolyCourses(db).find((c) => c.sigle === 'INF9999')?.groups).toEqual(['A', 'B']);
    db.prepare("UPDATE poly_courses SET active = 0 WHERE sigle = 'INF9999'").run();
    expect(listPolyCourses(db).map((c) => c.sigle)).toEqual(['INF3710']);
  });
  it('accepte une version de critère en texte', () => {
    const db = openDb(':memory:');
    upsertUniversity(db, ntuFixture);
    upsertPolyCourses(db, [inf3710Fixture]);
    db.prepare("INSERT INTO criterion_versions (version, params_hash, params_json) VALUES ('v0', 'h', '{}')").run();
    db.prepare("INSERT INTO host_courses (id, university_id, code, title, description, language, terms_json, level, source_url, collected_at) VALUES (1, 'ntu-tw', 'CSIE1000', 't', 'd', 'en', '[]', 'undergrad', 'https://example.org', '2026-11-10')").run();
    db.prepare("INSERT INTO matches (poly_sigle, host_course_id, criterion_version, notions_found, notions_missing, notion_sims, content_score, content_band, workload, text_used) VALUES ('INF3710', 1, 'v0', '[]', '[]', '{}', 0.5, 'partiel', 'conforme', 'd')").run();
    expect(db.prepare('SELECT version FROM criterion_versions').get()).toEqual({ version: 'v0' });
    expect(db.prepare('SELECT criterion_version FROM matches').get()).toEqual({ criterion_version: 'v0' });
  });
  it('passe une base de la première version à la dernière sans perte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'polyechanges-'));
    const path = join(dir, 'ancienne.sqlite');
    try {
      const old = new Database(path);
      old.pragma('foreign_keys = ON');
      old.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
      old.pragma('user_version = 1');
      const u = ntuFixture;
      old.prepare(
        'INSERT INTO universities VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(u.id, u.name, u.moveOnName, u.countryCode, u.city, u.lat, u.lng, u.website, null, u.creditSystem, 1, '{}', null, null, 1);
      old.prepare("INSERT INTO sources VALUES ('ntu-tw', 'ntu-tw', 'html', 'https://example.org/a', 'ntu-tw')").run();
      old.prepare("INSERT INTO snapshots (id, source_id, url, fetched_at, sha256, path, content_type) VALUES (7, 'ntu-tw', 'https://example.org/a', '2026-11-10', 'abc', 'ntu-tw/abc.html', 'text/html')").run();
      old.prepare("INSERT INTO collection_runs (source_id, started_at, status, courses_found) VALUES ('ntu-tw', '2026-11-10', 'ok', 3)").run();
      old.prepare(
        "INSERT INTO poly_courses VALUES ('INF3710', 'Fichiers', 'd', 3, '[3,1.5,4.5]', 'INF2010', 'obligatoire', 1, NULL, 1, 'https://example.org', '2026-11-10')",
      ).run();
      old.close();

      const db = openDb(path);
      expect(db.pragma('user_version', { simple: true })).toBe(3);
      expect(db.prepare('SELECT * FROM sources').all()).toEqual([
        { id: 'ntu-tw', university_id: 'ntu-tw', kind: 'html', url: 'https://example.org/a', reader: 'ntu-tw' },
      ]);
      expect(db.prepare('SELECT id FROM snapshots').all()).toEqual([{ id: 7 }]);
      expect(db.prepare('SELECT source_id, courses_found FROM collection_runs').all()).toEqual([
        { source_id: 'ntu-tw', courses_found: 3 },
      ]);
      expect(db.prepare('SELECT sigle, groups_json, active FROM poly_courses').all()).toEqual([
        { sigle: 'INF3710', groups_json: '[]', active: 1 },
      ]);
      // La nouvelle table accepte une source de Poly (université nulle, type saved).
      db.prepare("INSERT INTO sources VALUES ('poly-log', NULL, 'saved', 'https://www.polymtl.ca/', 'poly')").run();
      // Les clés étrangères sont toujours actives et pointent vers la nouvelle table.
      expect(() => db.prepare("INSERT INTO collection_runs (source_id, started_at, status, courses_found) VALUES ('absente', 'x', 'ok', 1)").run()).toThrow();
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      db.close();
      // Réouverture : rien à migrer.
      openDb(path).close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('garde les sources des faits et les positions de cours', () => {
    const db = openDb(':memory:');
    const provenance = {
      name: {
        url: 'https://example.org/a',
        retrievedAt: '2026-11-10T00:00:00.000Z',
        sha256: 'a'.repeat(64),
        locator: { page: 1, line: 2 },
        quote: 'National Taiwan University',
      },
    };
    upsertUniversity(db, { ...ntuFixture, provenance });
    expect(getUniversity(db, 'ntu-tw')?.provenance).toEqual(provenance);
    upsertPolyCourses(db, [{ ...inf3710Fixture, sourceLocator: { sha256: 'b'.repeat(64), page: 1, line: 7 } }]);
    expect(listPolyCourses(db)[0].sourceLocator).toEqual({ sha256: 'b'.repeat(64), page: 1, line: 7 });
  });

  function seedOld(path: string, version: number): void {
    const old = new Database(path);
    old.pragma('foreign_keys = ON');
    old.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    const u = ntuFixture;
    old.prepare('INSERT INTO universities VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      u.id, u.name, u.moveOnName, u.countryCode, u.city, u.lat, u.lng, u.website, null, u.creditSystem, 1, '{}', null, null, 1,
    );
    old.prepare("INSERT INTO sources VALUES ('ntu-tw', 'ntu-tw', 'html', 'https://example.org/a', 'ntu-tw')").run();
    old.prepare("INSERT INTO snapshots (id, source_id, url, fetched_at, sha256, path, content_type) VALUES (7, 'ntu-tw', 'https://example.org/a', '2026-11-10', 'abc', 'ntu-tw/abc.html', 'text/html')").run();
    old.prepare("INSERT INTO host_courses (university_id, code, title, description, language, terms_json, level, source_url, snapshot_id, collected_at) VALUES ('ntu-tw', 'CSIE1000', 't', 'd', 'en', '[\"fall\"]', 'undergrad', 'https://example.org/a', 7, '2026-11-10')").run();
    old.prepare("INSERT INTO poly_courses VALUES ('INF3710', 'Fichiers', 'd', 3, '[3,1.5,4.5]', 'INF2010', 'obligatoire', 1, NULL, 1, 'https://example.org', '2026-11-10')").run();
    old.pragma(`user_version = ${version}`);
    old.close();
  }

  function expectKept(db: ReturnType<typeof openDb>): void {
    expect(db.pragma('user_version', { simple: true })).toBe(3);
    expect(db.prepare('SELECT id, provenance_json FROM universities').all()).toEqual([{ id: 'ntu-tw', provenance_json: '{}' }]);
    expect(db.prepare('SELECT code, snapshot_id, source_page, source_line FROM host_courses').all()).toEqual([
      { code: 'CSIE1000', snapshot_id: 7, source_page: null, source_line: null },
    ]);
    expect(db.prepare('SELECT sigle, source_locator_json FROM poly_courses').all()).toEqual([
      { sigle: 'INF3710', source_locator_json: null },
    ]);
    expect(db.prepare('SELECT id FROM snapshots').all()).toEqual([{ id: 7 }]);
    expect(db.prepare('SELECT id FROM sources').all()).toEqual([{ id: 'ntu-tw' }]);
  }

  it('passe une base de la version 0 (tables déjà là, avant les versions) à la dernière sans perte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'polyechanges-'));
    try {
      const path = join(dir, 'v0.sqlite');
      seedOld(path, 0);
      const db = openDb(path);
      expectKept(db);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passe une base de la version 2 à la 3 sans perte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'polyechanges-'));
    try {
      const path = join(dir, 'v2.sqlite');
      seedOld(path, 1);
      openDb(path).close(); // version 3
      const mid = new Database(path);
      mid.exec(`
        ALTER TABLE universities DROP COLUMN provenance_json;
        ALTER TABLE host_courses DROP COLUMN source_page;
        ALTER TABLE host_courses DROP COLUMN source_line;
        ALTER TABLE poly_courses DROP COLUMN source_locator_json;
      `);
      mid.pragma('user_version = 2');
      mid.close();
      const db = openDb(path);
      expectKept(db);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('annule la migration si une clé étrangère est violée', () => {
    const dir = mkdtempSync(join(tmpdir(), 'polyechanges-'));
    try {
      const path = join(dir, 'cassee.sqlite');
      seedOld(path, 1);
      const bad = new Database(path);
      bad.pragma('foreign_keys = OFF');
      bad.prepare("INSERT INTO collection_runs (source_id, started_at, status, courses_found) VALUES ('absente', 'x', 'ok', 1)").run();
      bad.close();
      expect(() => openDb(path)).toThrow(/clés étrangères/);
      const check = new Database(path);
      expect(check.pragma('user_version', { simple: true })).toBe(1);
      expect(check.prepare("SELECT sql FROM sqlite_master WHERE name = 'sources'").get()).toMatchObject({
        sql: expect.stringContaining("'html','pdf','manual')"),
      });
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
