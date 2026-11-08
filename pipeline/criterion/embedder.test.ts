import { describe, expect, it } from 'vitest';
import { embedderKey, type ModelConfig } from './embedder.js';

const base: ModelConfig = {
  slug: 'm',
  id: 'org/m',
  revision: 'abc',
  dtype: 'fp32',
  pooling: 'mean',
  prefixes: { notion: '', passage: '' },
  sizeMillions: 1,
};

describe('embedderKey', () => {
  it('commence par id@revision@dtype puis un court hash de 8 caractères', () => {
    expect(embedderKey(base)).toMatch(/^org\/m@abc@fp32@[0-9a-f]{8}$/);
  });
  it('change quand le pooling change', () => {
    expect(embedderKey({ ...base, pooling: 'cls' })).not.toBe(embedderKey(base));
  });
  it('change quand un préfixe change', () => {
    expect(embedderKey({ ...base, prefixes: { notion: 'query: ', passage: '' } })).not.toBe(embedderKey(base));
  });
  it('est stable pour une même configuration', () => {
    expect(embedderKey({ ...base })).toBe(embedderKey(base));
  });
});
