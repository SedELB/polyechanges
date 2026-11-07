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
  sourceUrl: 'https://www.polymtl.ca/programmes/cours/fichiers-et-bases-de-donnees',
  collectedAt: '2026-11-10',
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
});
