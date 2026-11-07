import { describe, expect, it } from 'vitest';
import { assertOneSourcePerUniversity, parseSourceFile } from './sourceFile.js';

const source = (id: string, universityId: string) =>
  parseSourceFile({ id, universityId, kind: 'html', urls: ['https://example.org/a'], reader: 'r' });

describe('assertOneSourcePerUniversity', () => {
  it('accepte une fiche par université', () => {
    expect(() => assertOneSourcePerUniversity([source('a', 'u1'), source('b', 'u2')])).not.toThrow();
  });

  it('refuse deux fiches pour la même université et nomme les deux', () => {
    expect(() => assertOneSourcePerUniversity([source('a', 'u1'), source('b', 'u1')])).toThrow(/a et b.*u1/);
  });
});
