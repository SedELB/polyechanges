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
});
