import { describe, expect, it } from 'vitest';
import { missingProvenance } from '../provenance/verify.js';
import { loadUniversities } from './registry.js';

describe('sources des faits du registre', () => {
  it('chaque fait non vide d’une université sourcée a une source', () => {
    for (const u of loadUniversities()) {
      // Les universités encore en squelette (aucune source sur le nom) sont ignorées.
      if (u.provenance.name === undefined) continue;
      expect(missingProvenance(u), u.id).toEqual([]);
    }
  });
});
