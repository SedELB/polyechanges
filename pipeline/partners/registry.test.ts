import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/open.js';
import { getUniversity } from '../db/universities.js';
import { buildSkeleton, loadUniversities, syncUniversities } from './registry.js';

const entry = {
  id: 'doshisha-jp',
  name: 'Doshisha University',
  moveOnName: 'Doshisha University',
  countryCode: 'JP',
  city: '',
  lat: 35.03,
  lng: 135.76,
  website: '',
  catalogUrl: null,
  creditSystem: 'local',
  contactHoursPerCredit: null,
  terms: { fall: null, spring: null },
  restrictions: null,
  exchangeContact: null,
  catalogPublic: true,
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'registry-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(content: unknown): string {
  const path = join(dir, 'universities.json');
  writeFileSync(path, JSON.stringify(content));
  return path;
}

describe('loadUniversities', () => {
  it('lit un registre valide', () => {
    expect(loadUniversities(write([entry]))).toEqual([{ ...entry, provenance: {} }]);
  });

  const prov = {
    url: 'https://example.org/a',
    retrievedAt: '2026-11-10T00:00:00.000Z',
    sha256: 'a'.repeat(64),
    locator: { page: 1, line: 3 },
    quote: 'Doshisha University',
  };
  it('lit et valide les sources des faits', () => {
    const ok = { ...entry, provenance: { name: prov } };
    expect(loadUniversities(write([ok]))[0].provenance).toEqual({ name: prov });
    const bad = (p: object) => () => loadUniversities(write([{ ...entry, provenance: { name: { ...prov, ...p } } }]));
    expect(bad({ sha256: 'xyz' })).toThrow();
    expect(bad({ locator: { page: 0, line: 1 } })).toThrow();
    expect(bad({ locator: { page: 1, line: 1.5 } })).toThrow();
    expect(() => loadUniversities(write([{ ...entry, provenance: { inconnu: prov } }]))).toThrow();
  });

  it('refuse une entrée invalide', () => {
    expect(() => loadUniversities(write([{ ...entry, countryCode: 'FR' }]))).toThrow();
  });

  it('refuse deux universités avec le même identifiant', () => {
    expect(() => loadUniversities(write([entry, entry]))).toThrow(/doshisha-jp/);
  });
});

describe('syncUniversities', () => {
  it('écrit les universités du fichier dans la base et met à jour les existantes', () => {
    const db = openDb(':memory:');
    syncUniversities(db, write([entry]));
    expect(getUniversity(db, 'doshisha-jp')?.lat).toBe(35.03);
    syncUniversities(db, write([{ ...entry, lat: 36 }]));
    expect(getUniversity(db, 'doshisha-jp')?.lat).toBe(36);
    db.close();
  });
});

describe('buildSkeleton', () => {
  const p = (moveOnName: string, countryCode: 'TW' | 'KR' = 'TW') => ({ countryCode, moveOnName, lat: 1, lng: 2 });

  it('attribue les identifiants et laisse les champs à remplir vides', () => {
    const [ntu, ntust, korea] = buildSkeleton([
      p('National Taiwan University'),
      p('National Taiwan University of Science and Technology (Taiwan Tech)'),
      p('Korea University- College of Engineering', 'KR'),
    ]);
    expect([ntu?.id, ntust?.id, korea?.id]).toEqual(['ntu-tw', 'ntust-tw', 'korea-kr']);
    expect(ntu).toEqual({
      id: 'ntu-tw',
      name: 'National Taiwan University',
      moveOnName: 'National Taiwan University',
      countryCode: 'TW',
      city: '',
      lat: 1,
      lng: 2,
      website: '',
      catalogUrl: null,
      creditSystem: 'local',
      contactHoursPerCredit: null,
      terms: { fall: null, spring: null },
      restrictions: null,
      exchangeContact: null,
      catalogPublic: true,
      provenance: {},
    });
  });

  it('refuse un partenaire sans identifiant connu', () => {
    expect(() => buildSkeleton([p('Université Inconnue')])).toThrow(/Inconnue/);
  });
});
