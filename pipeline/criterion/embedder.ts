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
  /** `${id}@${revision}@${dtype}` */
  key: string;
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
}

export const embedderKey = (m: Pick<ModelConfig, 'id' | 'revision' | 'dtype'>): string =>
  `${m.id}@${m.revision}@${m.dtype}`;

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
      if (texts.length === 0) return [];
      const prefix = model.prefixes[kind];
      const output = await extractor(
        texts.map((t) => prefix + t),
        { pooling: model.pooling, normalize: true },
      );
      return output.tolist() as number[][];
    },
  };
}
