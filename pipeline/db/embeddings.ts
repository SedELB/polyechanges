import type { Db } from './open.js';

export type EmbeddingKind = 'notion' | 'passage';

const toBlob = (v: number[]): Buffer => {
  const f = new Float32Array(v);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
};

const fromBlob = (b: Buffer): number[] =>
  Array.from(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));

/** Vecteurs déjà calculés, par empreinte SHA-256 du texte. */
export function getEmbeddings(db: Db, modelKey: string, kind: EmbeddingKind, hashes: string[]): Map<string, number[]> {
  const stmt = db.prepare(
    'SELECT vector FROM embeddings WHERE model_key = ? AND kind = ? AND text_sha256 = ?',
  );
  const found = new Map<string, number[]>();
  for (const h of hashes) {
    const row = stmt.get(modelKey, kind, h) as { vector: Buffer } | undefined;
    if (row) found.set(h, fromBlob(row.vector));
  }
  return found;
}

export function putEmbeddings(db: Db, modelKey: string, kind: EmbeddingKind, rows: { hash: string; vector: number[] }[]): void {
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO embeddings (model_key, text_sha256, kind, vector) VALUES (?, ?, ?, ?)',
  );
  db.transaction(() => {
    for (const r of rows) stmt.run(modelKey, r.hash, kind, toBlob(r.vector));
  })();
}
