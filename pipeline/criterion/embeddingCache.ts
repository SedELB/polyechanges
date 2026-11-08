import { createHash } from 'node:crypto';
import type { Db } from '../db/open.js';
import { getEmbeddings, putEmbeddings } from '../db/embeddings.js';
import type { Embedder } from './embedder.js';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Enveloppe un embedder : seuls les textes absents de la table `embeddings` sont calculés. */
export function createCachedEmbedder(db: Db, inner: Embedder): Embedder {
  return {
    key: inner.key,
    async embed(texts, kind) {
      const hashes = texts.map(sha256);
      const cached = getEmbeddings(db, inner.key, kind, [...new Set(hashes)]);
      const missing: { text: string; hash: string }[] = [];
      const seen = new Set<string>();
      texts.forEach((text, i) => {
        const hash = hashes[i];
        if (!cached.has(hash) && !seen.has(hash)) {
          seen.add(hash);
          missing.push({ text, hash });
        }
      });
      if (missing.length > 0) {
        const vectors = await inner.embed(missing.map((m) => m.text), kind);
        if (vectors.length !== missing.length) {
          throw new Error(`L'embedder a renvoyé ${vectors.length} vecteurs pour ${missing.length} textes`);
        }
        // Float32 comme les vecteurs relus depuis la base : même valeur, qu'il soit neuf ou en cache.
        const rows = missing.map((m, i) => ({ hash: m.hash, vector: vectors[i].map(Math.fround) }));
        putEmbeddings(db, inner.key, kind, rows);
        for (const r of rows) cached.set(r.hash, r.vector);
      }
      return hashes.map((h) => cached.get(h) as number[]);
    },
  };
}
