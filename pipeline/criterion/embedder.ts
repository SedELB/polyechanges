import { createHash } from 'node:crypto';

export interface ModelConfig {
  slug: string;
  id: string;
  revision: string;
  dtype: 'fp32';
  /** `sentence_embedding` : le vecteur de phrase calculé par le modèle ONNX lui-même (regroupement et projection compris). */
  pooling: 'mean' | 'cls' | 'last_token' | 'sentence_embedding';
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
  if (model.pooling === 'sentence_embedding') return createSentenceEmbedder(model);
  const pooling = model.pooling;
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
        const output = await extractor([model.prefixes[kind] + t], { pooling, normalize: true });
        vectors.push((output.tolist() as number[][])[0]);
      }
      return vectors;
    },
  };
}

/**
 * Modèle dont le graphe ONNX rend lui-même le vecteur de phrase (sortie `sentence_embedding`), comme le montre sa fiche :
 * le pipeline `feature-extraction` ne lit que les vecteurs de chaque jeton et sauterait la projection finale.
 */
async function createSentenceEmbedder(model: ModelConfig): Promise<Embedder> {
  const { AutoConfig, AutoModel, AutoTokenizer } = await import('@huggingface/transformers');
  const config = (await AutoConfig.from_pretrained(model.id, { revision: model.revision })) as unknown as Record<string, unknown>;
  // Seul du texte est comparé : les encodeurs d'images et de son d'un modèle multimodal ne sont ni téléchargés ni chargés.
  if ('vision_config' in config) config.vision_config = null;
  if ('audio_config' in config) config.audio_config = null;
  const tokenizer = await AutoTokenizer.from_pretrained(model.id, { revision: model.revision });
  const encoder = await AutoModel.from_pretrained(model.id, {
    revision: model.revision,
    dtype: model.dtype,
    config: config as never,
  });
  return {
    key: embedderKey(model),
    async embed(texts, kind) {
      const vectors: number[][] = [];
      // Un texte à la fois, sans remplissage : la composition d'un lot ne doit pas pouvoir modifier les vecteurs.
      for (const t of texts) {
        const inputs = tokenizer([model.prefixes[kind] + t], { padding: true, truncation: true });
        const { sentence_embedding } = (await encoder(inputs)) as { sentence_embedding?: import('@huggingface/transformers').Tensor };
        if (!sentence_embedding) throw new Error(`Le modèle ${model.id} ne rend pas de vecteur de phrase (sentence_embedding)`);
        vectors.push((sentence_embedding.normalize(2, -1).tolist() as number[][])[0]);
      }
      return vectors;
    },
  };
}
