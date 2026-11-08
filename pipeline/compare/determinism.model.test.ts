import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalEmbedder } from '../criterion/embedder.js';
import { loadCriterion } from '../criterion/loadCriterion.js';
import { applyCollection } from '../db/hostCourses.js';
import { openDb, type Db } from '../db/open.js';
import { upsertPolyCourses } from '../db/polyCourses.js';
import { upsertUniversity } from '../db/universities.js';
import type { HostCourseInput, PolyCourse, University } from '../../shared/types.js';
import { runCompare } from './compare.js';

const run = process.env.RUN_MODEL_TESTS === '1';
const version = process.env.CRITERION_VERSION ?? 'v0';

const university: University = {
  id: 'test-u', name: 'Test', moveOnName: 'Test', countryCode: 'TW', city: 'x', lat: 0, lng: 0, website: 'https://x',
  catalogUrl: null, creditSystem: 'ECTS', contactHoursPerCredit: null, terms: { fall: null, spring: null },
  restrictions: null, exchangeContact: null, catalogPublic: true, provenance: {},
};

const host = (code: string, title: string, description: string, outline: string | null): HostCourseInput => ({
  code, title, description, outline, credits: 6, contactHours: null, language: 'en', terms: ['fall'],
  level: 'undergrad', sourceUrl: `https://h/${code}`,
});

const HOST_COURSES = [
  host('D1', 'Database Systems', 'Relational model, SQL queries and transaction management. Indexing and hashing.', 'Normal forms; concurrency control'),
  host('D2', 'Operating Systems', 'Processes, threads, scheduling, deadlocks and memory management.', null),
  host('D3', 'Software Testing', 'Unit testing, integration testing and software reliability.', null),
];

function seed(db: Db, sigles: string[]): void {
  upsertUniversity(db, university);
  upsertPolyCourses(
    db,
    sigles.map((sigle): PolyCourse => ({
      sigle, title: sigle, description: 'x', credits: 3, triplet: [3, 1.5, 4.5], prerequisites: '', status: 'optionnel',
      eligible: true, ineligibleReason: null, compared: true, groups: [], sourceUrl: 'https://p', collectedAt: '2026-01-01',
      sourceLocator: null,
    })),
  );
  applyCollection(db, 'test-u', HOST_COURSES, () => null, '2026-01-02');
}

describe.skipIf(!run)('déterminisme avec le vrai modèle', () => {
  it('donne un contenu de matches identique, octet par octet, dans deux bases neuves', async () => {
    const criterion = loadCriterion(version);
    const sigles = Object.keys(criterion.notions);
    const contents: string[] = [];
    for (let i = 0; i < 2; i++) {
      const db = openDb(join(mkdtempSync(join(tmpdir(), 'polyechanges-det-')), 'db.sqlite'));
      seed(db, sigles);
      // Embedder recréé pour chaque base : rien ne passe d'une exécution à l'autre.
      const embedder = await createLocalEmbedder(criterion.params.model, 'data/models');
      const { pairs } = await runCompare(db, criterion, embedder);
      expect(pairs).toBe(sigles.length * HOST_COURSES.length);
      const rows = db.prepare('SELECT * FROM matches ORDER BY poly_sigle, host_course_id').all();
      contents.push(JSON.stringify(rows));
      db.close();
    }
    expect(contents[0]).toBe(contents[1]);
  }, 600_000);
});
