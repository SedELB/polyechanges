import type { ManualEntry } from './contract';

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

export const MANUAL_STORAGE_KEY = 'polyechanges.manuel.v1';

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

function validEntry(e: unknown): e is ManualEntry {
  if (typeof e !== 'object' || e === null) return false;
  const o = e as Record<string, unknown>;
  return (
    (o.kind === 'orientation' || o.kind === 'hors_genie') &&
    nonEmpty(o.hostCode) &&
    nonEmpty(o.hostTitle) &&
    (o.hostCredits === null || (typeof o.hostCredits === 'number' && Number.isFinite(o.hostCredits) && o.hostCredits >= 0)) &&
    typeof o.polyCredits === 'number' &&
    Number.isInteger(o.polyCredits) &&
    o.polyCredits >= 1 &&
    o.polyCredits <= 9
  );
}

/** Cours ajoutés à la main, par université. Contenu invalide ou erreur : rien (entrées invalides écartées une à une). */
export function loadManual(storage: Storage | null = defaultStorage()): Record<string, ManualEntry[]> {
  try {
    const raw = storage?.getItem(MANUAL_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, ManualEntry[]> = {};
    for (const [id, list] of Object.entries(parsed)) {
      if (!Array.isArray(list)) continue;
      const valid = list.filter(validEntry).map((e) => ({
        kind: e.kind,
        hostCode: e.hostCode,
        hostTitle: e.hostTitle,
        hostCredits: e.hostCredits,
        polyCredits: e.polyCredits,
      }));
      if (valid.length > 0) out[id] = valid;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveManual(manual: Record<string, ManualEntry[]>, storage: Storage | null = defaultStorage()): void {
  try {
    storage?.setItem(MANUAL_STORAGE_KEY, JSON.stringify(manual));
  } catch {
    // stockage indisponible : les ajouts restent en mémoire pour la session
  }
}
