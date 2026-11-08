import { beforeEach, describe, expect, it } from 'vitest';
import type { Embedder } from '../criterion/embedder.js';
import { openDb, type Db } from '../db/open.js';
import { applyCollection } from '../db/hostCourses.js';
import { upsertPolyCourses } from '../db/polyCourses.js';
import { upsertUniversity } from '../db/universities.js';
import type { HostCourseInput, PolyCourse, University } from '../../shared/types.js';
import type { LoadedCriterion } from '../criterion/loadCriterion.js';
import { detectNotions } from '../criterion/content.js';
import { splitPassages } from '../criterion/passages.js';
import { CriterionFrozenError, freezeCriterion, runCompare } from './compare.js';

/** Vecteur déterministe : un axe par mot-clé connu. */
const AXES = ['sql', 'transaction', 'kernel'];
const fake: Embedder = {
  key: 'fake@r@fp32@00000000',
  async embed(texts) {
    return texts.map((t) => {
      const v = AXES.map((a) => (t.toLowerCase().includes(a) ? 1 : 0));
      return v.every((x) => x === 0) ? [0, 0, 0, 1] : [...v, 0];
    });
  },
};

const v0: LoadedCriterion = {
  params: {
    version: 'v0',
    model: {
      slug: 'fake', id: 'fake', revision: 'r', dtype: 'fp32', pooling: 'mean',
      prefixes: { notion: '', passage: '' }, sizeMillions: 1, library: '@huggingface/transformers@4.3.2',
    },
    detectThreshold: 0.55, bandHigh: 0.7, bandLow: 0.4, workloadTolerance: 0.15, polyWeeks: 13,
  },
  notions: {
    INF3710: [
      { id: 'sql', fr: 'SQL', en: 'SQL' },
      { id: 'transactions', fr: 'transactions', en: 'transaction' },
    ],
  },
  paramsHash: 'hash-v0',
};

const poly = (sigle: string, compared: boolean): PolyCourse => ({
  sigle, title: 'Bases de données', description: 'SQL.', credits: 3, triplet: [3, 1.5, 4.5],
  prerequisites: '', status: 'optionnel', eligible: true, ineligibleReason: null, compared,
  groups: [], sourceUrl: 'https://poly.example', collectedAt: '2026-01-01', sourceLocator: null,
});

const uni = (id: string, creditSystem: 'ECTS' | 'local'): University => ({
  id, name: id, moveOnName: id, countryCode: 'TW', city: 'x', lat: 0, lng: 0, website: 'https://x',
  catalogUrl: null, creditSystem, contactHoursPerCredit: creditSystem === 'local' ? 16 : null,
  terms: { fall: null, spring: null }, restrictions: null, exchangeContact: null, catalogPublic: true, provenance: {},
});

const course = (code: string, over: Partial<HostCourseInput> = {}): HostCourseInput => ({
  code, title: 'Databases', description: 'SQL and transaction processing', outline: null, credits: 3,
  contactHours: null, language: 'en', terms: ['fall'], level: 'undergrad', sourceUrl: 'https://h.example/' + code, ...over,
});

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  upsertUniversity(db, uni('ntu', 'local'));
  upsertUniversity(db, uni('ects-u', 'ECTS'));
  upsertPolyCourses(db, [poly('INF3710', true), poly('INF9999', true), poly('LOG0000', false)]);
  applyCollection(
    db,
    'ntu',
    [course('A1'), course('A2', { language: 'unknown', outline: 'Indexes' }), course('A3', { language: 'other' })],
    () => null,
    '2026-01-02',
  );
  applyCollection(db, 'ects-u', [course('E1', { credits: 6 })], () => null, '2026-01-02');
});

const rows = () => db.prepare('SELECT * FROM matches ORDER BY host_course_id').all() as Record<string, unknown>[];
const byCode = (code: string) =>
  db.prepare('SELECT m.* FROM matches m JOIN host_courses h ON h.id = m.host_course_id WHERE h.code = ?').get(code) as Record<string, unknown>;

describe('runCompare', () => {
  it('enregistre la version du critère sur chaque résultat', async () => {
    const { pairs } = await runCompare(db, v0, fake);
    expect(pairs).toBe(3);
    expect(rows()).toHaveLength(3);
    expect(rows().every((r) => r.criterion_version === 'v0')).toBe(true);
  });

  it('exclut les cours en langue « other », les cours sans grille et les cours non comparés', async () => {
    await runCompare(db, v0, fake);
    expect(byCode('A3')).toBeUndefined();
    expect(new Set(rows().map((r) => r.poly_sigle))).toEqual(new Set(['INF3710']));
  });

  it('remplit text_used, notion_sims, la charge et le niveau', async () => {
    await runCompare(db, v0, fake);
    const a1 = byCode('A1');
    expect(a1.text_used).toBe('description');
    expect(byCode('A2').text_used).toBe('description+plan');
    expect(JSON.parse(a1.notion_sims as string)).toEqual({ sql: 0.707, transactions: 0.707 });
    expect(a1.content_score).toBe(1);
    expect(a1.content_band).toBe('tres');
    // NTU local : 3 crédits x 16 = 48 h ; attendu (3 + 1.5) x 13 = 58.5 h ; écart -0.18 : trop légère
    expect(a1.workload).toBe('trop_legere');
    expect(a1.level).toBe('moyenne');
    // ECTS : 6 = 2 x 3
    expect(byCode('E1').workload).toBe('conforme');
    expect(byCode('E1').level).toBe('elevee');
  });

  it("remplace les lignes d'une version non gelée", async () => {
    await runCompare(db, v0, fake);
    await runCompare(db, v0, fake);
    expect(rows()).toHaveLength(3);
  });

  it('enregistre la version dans criterion_versions', async () => {
    await runCompare(db, v0, fake);
    const r = db.prepare('SELECT * FROM criterion_versions').get() as Record<string, unknown>;
    expect(r.version).toBe('v0');
    expect(r.params_hash).toBe('hash-v0');
    expect(r.frozen_at).toBeNull();
  });

  it('refuse de recalculer une version gelée dont les paramètres ont changé', async () => {
    await runCompare(db, v0, fake);
    freezeCriterion(db, 'v0', '2026-12-10');
    await expect(runCompare(db, { ...v0, paramsHash: 'autre' }, fake)).rejects.toBeInstanceOf(CriterionFrozenError);
    await expect(runCompare(db, { ...v0, paramsHash: 'autre' }, fake)).rejects.toThrow(
      'Le critère v0 est gelé : crée une nouvelle version',
    );
    expect(rows()).toHaveLength(3);
  });

  it('accepte de recalculer une version gelée aux paramètres identiques', async () => {
    await runCompare(db, v0, fake);
    freezeCriterion(db, 'v0', '2026-12-10');
    await expect(runCompare(db, v0, fake)).resolves.toEqual({ pairs: 3 });
  });
});

describe('freezeCriterion', () => {
  it("échoue si la version n'a jamais été calculée", () => {
    expect(() => freezeCriterion(db, 'v9', '2026-12-10')).toThrow();
  });
  it('pose frozen_at', async () => {
    await runCompare(db, v0, fake);
    freezeCriterion(db, 'v0', '2026-12-10');
    expect((db.prepare('SELECT frozen_at FROM criterion_versions').get() as { frozen_at: string }).frozen_at).toBe('2026-12-10');
  });
});

describe('runCompare : une seule demande par texte', () => {
  it('donne exactement les lignes du calcul paire par paire (detectNotions)', async () => {
    await runCompare(db, v0, fake);
    const hosts = db.prepare('SELECT * FROM host_courses ORDER BY id').all() as { id: number; title: string; description: string; outline: string | null }[];
    for (const h of hosts.filter((x) => x.id)) {
      const row = db.prepare('SELECT * FROM matches WHERE host_course_id = ?').get(h.id) as Record<string, string> | undefined;
      if (!row) continue;
      const expected = await detectNotions(v0.notions.INF3710, splitPassages(h), fake, v0.params.detectThreshold);
      expect(JSON.parse(row.notions_found)).toEqual(expected.found);
      expect(JSON.parse(row.notions_missing)).toEqual(expected.missing);
      expect(JSON.parse(row.notion_sims)).toEqual(expected.maxSim);
    }
    expect(rows().length).toBeGreaterThan(0);
  });

  it('appelle l\'embedder interne au plus une fois par texte et par type', async () => {
    const seen = new Set<string>();
    let repeated = 0;
    const counting: Embedder = {
      key: fake.key,
      async embed(texts, kind) {
        for (const t of texts) {
          const k = kind + '|' + t;
          if (seen.has(k)) repeated++;
          seen.add(k);
        }
        return fake.embed(texts, kind);
      },
    };
    applyCollection(db, 'ntu', [course('A1'), course('A4', { description: 'SQL and transaction processing' })], () => null, '2026-01-03');
    await runCompare(db, v0, counting);
    expect(repeated).toBe(0);
    expect(seen.size).toBeGreaterThan(0);
  });
});
