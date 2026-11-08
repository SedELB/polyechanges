export const MAX_CHOICES = 3;
export const STORAGE_KEY = 'polyechanges.choix.v1';

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Universités gardées. Toute erreur (stockage bloqué, contenu invalide) donne une liste vide. */
export function loadChoices(storage: Storage | null = defaultStorage()): string[] {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string')) return [];
    return [...new Set(parsed as string[])].slice(0, MAX_CHOICES);
  } catch {
    return [];
  }
}

/** Enregistre les choix ; toute erreur est ignorée (le site marche sans stockage). */
export function saveChoices(ids: string[], storage: Storage | null = defaultStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // stockage indisponible : les choix restent en mémoire pour la session
  }
}

export function addChoice(ids: string[], id: string): { ids: string[]; error: 'max' | null } {
  if (ids.includes(id)) return { ids, error: null };
  if (ids.length >= MAX_CHOICES) return { ids, error: 'max' };
  return { ids: [...ids, id], error: null };
}
