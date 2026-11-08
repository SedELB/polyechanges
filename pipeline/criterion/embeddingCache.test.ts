import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/open.js';
import { createCachedEmbedder } from './embeddingCache.js';

describe('createCachedEmbedder', () => {
  it('ne recalcule pas un texte déjà en cache', async () => {
    const inner = { key: 'm@r@fp32', embed: vi.fn(async (t: string[]) => t.map(() => [0.5, 0.25])) };
    const cached = createCachedEmbedder(openDb(':memory:'), inner);
    await cached.embed(['SQL', 'B+ trees'], 'passage');
    expect(await cached.embed(['SQL'], 'passage')).toEqual([[0.5, 0.25]]);
    expect(inner.embed).toHaveBeenCalledTimes(1);
  });

  it('ne transmet que les textes absents, rend les vecteurs dans l\'ordre demandé', async () => {
    const inner = { key: 'm@r@fp32', embed: vi.fn(async (t: string[]) => t.map((s) => [s.length, 1])) };
    const cached = createCachedEmbedder(openDb(':memory:'), inner);
    await cached.embed(['bb'], 'passage');
    const out = await cached.embed(['a', 'bb', 'ccc', 'a'], 'passage');
    expect(inner.embed).toHaveBeenLastCalledWith(['a', 'ccc'], 'passage');
    expect(out).toEqual([[1, 1], [2, 1], [3, 1], [1, 1]]);
  });

  it('sépare les types et les modèles', async () => {
    const db = openDb(':memory:');
    const a = { key: 'a', embed: vi.fn(async (t: string[]) => t.map(() => [1])) };
    const b = { key: 'b', embed: vi.fn(async (t: string[]) => t.map(() => [2])) };
    await createCachedEmbedder(db, a).embed(['x'], 'passage');
    await createCachedEmbedder(db, a).embed(['x'], 'notion');
    expect(await createCachedEmbedder(db, b).embed(['x'], 'passage')).toEqual([[2]]);
    expect(a.embed).toHaveBeenCalledTimes(2);
  });

  it('arrondit les vecteurs neufs en Float32, comme ceux relus depuis la base', async () => {
    const inner = { key: 'm@r@fp32', embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 1 / 3])) };
    const cached = createCachedEmbedder(openDb(':memory:'), inner);
    const fresh = await cached.embed(['x'], 'passage');
    const reread = await cached.embed(['x'], 'passage');
    expect(fresh).toEqual(reread);
    expect(fresh[0][0]).toBe(Math.fround(0.1));
  });
});
