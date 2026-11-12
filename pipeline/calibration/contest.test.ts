import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCriterion } from '../criterion/loadCriterion.js';
import {
  candidateSlugs,
  contestVersionsOnDisk,
  gridsDescription,
  prepareContest,
  readCandidate,
  recordRun,
  type ContestRun,
} from './contest.js';

const candidate = {
  slug: 'bge-base',
  id: 'Xenova/bge-base-en-v1.5',
  revision: '4d6cd88e18e51a5e020c2c305726d76ada9c03cf',
  dtype: 'fp32',
  pooling: 'cls',
  prefixes: { notion: 'Represent this sentence for searching relevant passages: ', passage: '' },
  sizeMillions: 109,
};

/** Dossier de critère temporaire : une copie de v0 et un candidat. */
function criterionDir(c: Record<string, unknown> = candidate): string {
  const dir = mkdtempSync(join(tmpdir(), 'polyechanges-contest-'));
  mkdirSync(join(dir, 'v0'));
  for (const f of ['criterion.json', 'notions.json']) {
    writeFileSync(join(dir, 'v0', f), readFileSync(join('data/criterion/v0', f)));
  }
  mkdirSync(join(dir, 'candidates'));
  writeFileSync(join(dir, 'candidates', `${c.slug as string}.json`), JSON.stringify(c));
  return dir;
}

describe('prepareContest', () => {
  it('écrit contest-<slug> : grilles et seuils de v0, modèle du candidat', () => {
    const dir = criterionDir();
    prepareContest('bge-base', dir, '@huggingface/transformers@4.3.2');
    const contest = loadCriterion('contest-bge-base', dir);
    const v0 = loadCriterion('v0', dir);
    expect(contest.notions).toEqual(v0.notions);
    expect(contest.params).toEqual({
      ...v0.params,
      version: 'contest-bge-base',
      model: { ...candidate, library: '@huggingface/transformers@4.3.2' },
    });
    expect(contestVersionsOnDisk(dir)).toEqual(['contest-bge-base']);
  });

  it('peut prendre des grilles corrigées à la place de celles de v0', () => {
    const dir = criterionDir();
    const notions = join(dir, 'corrigees.json');
    writeFileSync(notions, JSON.stringify({ INF3710: [{ id: 'sql', fr: 'SQL', en: 'SQL' }] }));
    prepareContest('bge-base', dir, '@huggingface/transformers@4.3.2', notions);
    expect(loadCriterion('contest-bge-base', dir).notions).toEqual({ INF3710: [{ id: 'sql', fr: 'SQL', en: 'SQL' }] });
  });
});

describe('readCandidate', () => {
  it('refuse une révision qui n’est pas un hachage de commit', () => {
    const dir = criterionDir({ ...candidate, revision: 'main' });
    expect(() => readCandidate('bge-base', dir)).toThrow();
  });
  it('refuse un fichier dont le slug ne correspond pas au nom', () => {
    const dir = criterionDir({ ...candidate, slug: 'autre' });
    writeFileSync(join(dir, 'candidates', 'bge-base.json'), JSON.stringify({ ...candidate, slug: 'autre' }));
    expect(() => readCandidate('bge-base', dir)).toThrow(/autre/);
  });
  it.each(candidateSlugs())('le candidat %s du dépôt est valide', (slug) => {
    expect(readCandidate(slug).slug).toBe(slug);
  });
});

describe('recordRun', () => {
  const run = (compareSeconds: number, modelKey = 'org/m@r@fp32@00000000'): ContestRun => ({
    modelKey, pairs: 10, loadSeconds: 1, compareSeconds, embeddedTexts: 5, diskBytes: 100,
  });
  it('garde la première mesure d’un même modèle (cache des vecteurs encore vide)', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'polyechanges-runs-')), 'runs.json');
    recordRun(file, 'm', run(50));
    recordRun(file, 'm', run(2));
    expect(JSON.parse(readFileSync(file, 'utf8')).m.compareSeconds).toBe(50);
  });
  it('remplace la mesure quand le modèle change', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'polyechanges-runs-')), 'runs.json');
    recordRun(file, 'm', run(50));
    recordRun(file, 'm', run(7, 'org/m@autre@fp32@00000000'));
    expect(JSON.parse(readFileSync(file, 'utf8')).m.compareSeconds).toBe(7);
  });
});

describe('gridsDescription', () => {
  const v0 = {
    LOG3420: [{ id: 'a', fr: 'a', en: 'requirements analysis' }, { id: 'b', fr: 'b', en: 'risk assessment' }],
    INF8111: [{ id: 'c', fr: 'c', en: 'data reduction' }],
  };
  it('dit quand les grilles sont celles de v0', () => {
    expect(gridsDescription(v0, v0)).toBe('Grilles de notions : celles de v0.');
  });
  it('compte les notions corrigées et nomme les cours', () => {
    const corrected = { ...v0, LOG3420: [{ id: 'a', fr: 'a', en: 'software requirements analysis' }, v0.LOG3420[1]] };
    expect(gridsDescription(corrected, v0)).toBe(
      'Grilles de notions : celles de v0 corrigées une fois après le premier calcul de l’accord (1 notion dans 1 cours : LOG3420).',
    );
  });
});
