import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCriterion } from './loadCriterion.js';

const params = (version: string, over: Record<string, unknown> = {}) => ({
  version,
  model: {
    slug: 'm', id: 'org/m', revision: 'abc', dtype: 'fp32', pooling: 'mean',
    prefixes: { notion: '', passage: '' }, sizeMillions: 1, library: '@huggingface/transformers@4.3.2',
  },
  detectThreshold: 0.55, bandHigh: 0.7, bandLow: 0.4, workloadTolerance: 0.15, polyWeeks: 13,
  ...over,
});

function write(version: string, p: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'polyechanges-crit-'));
  mkdirSync(join(dir, version));
  writeFileSync(join(dir, version, 'criterion.json'), JSON.stringify(p));
  writeFileSync(join(dir, version, 'notions.json'), JSON.stringify({ INF3710: [{ id: 'sql', fr: 'SQL', en: 'SQL' }] }));
  return dir;
}

describe('loadCriterion', () => {
  it('accepte une version du concours « contest-<slug> »', () => {
    const dir = write('contest-bge-base', params('contest-bge-base'));
    expect(loadCriterion('contest-bge-base', dir).params.version).toBe('contest-bge-base');
  });

  it('refuse un nom de version libre', () => {
    const dir = write('essai', params('essai'));
    expect(() => loadCriterion('essai', dir)).toThrow();
  });

  it('lit le plafond des paires comparées sur le titre seul, compris dans le hash', () => {
    const avec = loadCriterion('v1', write('v1', params('v1', { titleOnlyMaxLevel: 'faible' })));
    const sans = loadCriterion('v1', write('v1', params('v1')));
    expect(avec.params.titleOnlyMaxLevel).toBe('faible');
    expect(sans.params.titleOnlyMaxLevel).toBeUndefined();
    expect(avec.paramsHash).not.toBe(sans.paramsHash);
  });

  it('refuse un plafond qui n’est pas un niveau', () => {
    expect(() => loadCriterion('v1', write('v1', params('v1', { titleOnlyMaxLevel: 'tres' })))).toThrow();
  });

  it('accepte le vecteur de phrase calculé par le modèle lui-même', () => {
    const p = params('v1');
    const dir = write('v1', { ...p, model: { ...p.model, pooling: 'sentence_embedding' } });
    expect(loadCriterion('v1', dir).params.model.pooling).toBe('sentence_embedding');
  });

  it('v0 n’a pas de plafond', () => {
    expect(loadCriterion('v0').params.titleOnlyMaxLevel).toBeUndefined();
  });
});
