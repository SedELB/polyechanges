export const DEFAULT_MODELS_DIR = 'data/models';

/**
 * Répertoire du cache des modèles : `POLYECHANGES_MODELS_DIR` si elle est posée, sinon `data/models`.
 * Seul endroit qui lit cette variable : les gros modèles peuvent ainsi rester hors d'un dossier synchronisé.
 */
export function modelsDir(env: Record<string, string | undefined> = process.env): string {
  const dir = env.POLYECHANGES_MODELS_DIR?.trim();
  return dir ? dir : DEFAULT_MODELS_DIR;
}
