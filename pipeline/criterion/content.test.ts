import { describe, expect, it } from 'vitest';
import { cosine, detectNotions } from './content.js';
import type { Embedder } from './embedder.js';

describe('detectNotions', () => {
  it('trouve une notion au-dessus du seuil avec un embedder factice', async () => {
    const fake: Embedder = { key: 'fake', embed: async (t) => t.map((s) => (s === 'SQL' ? [1, 0, 0] : s === 'Cooking' ? [0, 1, 0] : [0, 0, 1])) };
    const r = await detectNotions(
      [{ id: 'sql', fr: 'SQL', en: 'SQL' }, { id: 'tx', fr: 'transactions', en: 'transactions' }],
      ['SQL', 'Cooking'],
      fake,
      0.55,
    );
    expect(r.found).toEqual(['sql']);
    expect(r.missing).toEqual(['tx']);
    expect(r.maxSim).toEqual({ sql: 1, tx: 0 });
  });

  it('appelle l\'embedder une fois par type de texte', async () => {
    const kinds: string[] = [];
    const fake: Embedder = { key: 'fake', embed: async (t, k) => (kinds.push(k), t.map(() => [1, 0])) };
    await detectNotions([{ id: 'a', fr: 'a', en: 'a' }], ['x'], fake, 0.5);
    expect(kinds).toEqual(['notion', 'passage']);
  });

  it('sans passage, toutes les notions manquent', async () => {
    const fake: Embedder = { key: 'fake', embed: async (t) => t.map(() => [1, 0]) };
    const r = await detectNotions([{ id: 'a', fr: 'a', en: 'a' }], [], fake, 0.5);
    expect(r.missing).toEqual(['a']);
    expect(r.maxSim).toEqual({ a: 0 });
  });
});

describe('cosine', () => {
  it('vecteurs orthogonaux, identiques, nuls', () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([2, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });
});
