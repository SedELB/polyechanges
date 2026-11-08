import { createHash } from 'node:crypto';

export interface ModelConfig {
  slug: string;
  id: string;
  revision: string;
  dtype: 'fp32';
  pooling: 'mean' | 'cls' | 'last_token';
  prefixes: { notion: string; passage: string };
  sizeMillions: number;
}

export type EmbedKind = 'notion' | 'passage';

export interface Embedder {
  /** `${id}@${revision}@${dtype}@${hash des réglages}` */
  key: string;
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
}

/** Le court hash couvre pooling et préfixes : un réglage changé ne réutilise jamais d'anciens vecteurs. */
export const embedderKey = (m: Pick<ModelConfig, 'id' | 'revision' | 'dtype' | 'pooling' | 'prefixes'>): string => {
  const settings = createHash('sha256')
    .update(JSON.stringify({ pooling: m.pooling, prefixes: m.prefixes }))
    .digest('hex')
    .slice(0, 8);
  return `${m.id}@${m.revision}@${m.dtype}@${settings}`;
};

/** Embedder local (transformers.js). Le modèle est téléchargé une fois dans `cacheDir`. */
export async function createLocalEmbedder(model: ModelConfig, cacheDir: string): Promise<Embedder> {
  const { env, pipeline } = await import('@huggingface/transformers');
  env.cacheDir = cacheDir;
  const extractor = await pipeline('feature-extraction', model.id, {
    revision: model.revision,
    dtype: model.dtype,
  });
  return {
    key: embedderKey(model),
    async embed(texts, kind) {
      const vectors: number[][] = [];
      // Un texte à la fois : la composition d'un lot ne doit pas pouvoir modifier les vecteurs.
      for (const t of texts) {
        const output = await extractor([model.prefixes[kind] + t], { pooling: model.pooling, normalize: true });
        vectors.push((output.tolist() as number[][])[0]);
      }
      return vectors;
    },
  };
}
