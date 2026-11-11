import { describe, expect, it } from 'vitest';
import type { UniversityFact } from '../../shared/types.js';
import { missingProvenance } from '../provenance/verify.js';
import { loadUniversities } from './registry.js';

// Seuls faits non annulables (creditSystem, catalogPublic) encore sans source parce que le site est bloqué.
// Chaque entrée doit disparaître dès que le fait reçoit sa source.
const UNSOURCED_ALLOWED: Record<string, UniversityFact[]> = {
  // catalogue bloqué : Incapsula
  'cityu-hk': ['creditSystem', 'catalogPublic'],
  // hôte injoignable : Joint Institute, aucune page lisible ne définit le crédit
  'sjtu-cn': ['creditSystem'],
};

describe('sources des faits du registre', () => {
  it('chaque fait non vide a une source, sauf ceux de la table des exceptions', () => {
    for (const u of loadUniversities()) {
      expect(missingProvenance(u), u.id).toEqual(UNSOURCED_ALLOWED[u.id] ?? []);
    }
  });

  it('la table des exceptions ne garde que des faits encore sans source', () => {
    const ids = new Set(loadUniversities().map((u) => u.id));
    for (const [id, facts] of Object.entries(UNSOURCED_ALLOWED)) {
      expect(ids.has(id), id).toBe(true);
      const u = loadUniversities().find((x) => x.id === id)!;
      for (const f of facts) expect(u.provenance[f], `${id} ${f}`).toBeUndefined();
    }
  });
});
