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

describe('parseSourceFile', () => {
  const poly = {
    id: 'poly-log',
    universityId: null,
    kind: 'saved',
    urls: ['https://www.polymtl.ca/programmes/programmes/baccalaureat-en-genie-logiciel'],
    files: ['data/manual/poly/programme-LOG.html'],
    reader: 'poly',
  };

  it('accepte la source enregistrée de Poly, sans université', () => {
    expect(parseSourceFile(poly)).toMatchObject({ universityId: null, kind: 'saved', files: poly.files });
  });

  it('exige un fichier par adresse pour une source enregistrée', () => {
    expect(() => parseSourceFile({ ...poly, files: undefined })).toThrow(/un fichier par adresse/);
    expect(() => parseSourceFile({ ...poly, files: [] })).toThrow(/un fichier par adresse/);
    expect(() => parseSourceFile({ ...poly, files: ['a.html', 'b.html'] })).toThrow(/un fichier par adresse/);
  });

  it("refuse l'absence d'université pour une autre source que celle de Poly", () => {
    expect(() => parseSourceFile({ ...poly, reader: 'ntu-tw' })).toThrow(/pas d'université/);
    expect(() =>
      parseSourceFile({ id: 'x', universityId: null, kind: 'html', urls: ['https://example.org'], reader: 'r' }),
    ).toThrow(/pas d'université/);
  });

  it("assertOneSourcePerUniversity ignore la source de Poly", () => {
    expect(() => assertOneSourcePerUniversity([parseSourceFile(poly), source('a', 'u1')])).not.toThrow();
  });
});

describe('parseSourceFile, descriptions non publiées', () => {
  const base = { id: 'k', universityId: 'u', kind: 'manual', urls: [], reader: 'manual' };
  it('accepte descriptions none avec une note', () => {
    expect(parseSourceFile({ ...base, descriptions: 'none', descriptionsNote: 'Seulement les titres.' })).toMatchObject({
      descriptions: 'none',
      descriptionsNote: 'Seulement les titres.',
    });
  });
  it('refuse descriptions none sans note ou avec une note vide', () => {
    expect(() => parseSourceFile({ ...base, descriptions: 'none' })).toThrow(/descriptionsNote/);
    expect(() => parseSourceFile({ ...base, descriptions: 'none', descriptionsNote: '  ' })).toThrow(/descriptionsNote/);
  });
  it('refuse une autre valeur', () => {
    expect(() => parseSourceFile({ ...base, descriptions: 'some', descriptionsNote: 'x' })).toThrow();
  });
  it('sans le champ, rien ne change', () => {
    expect(parseSourceFile(base).descriptions).toBeUndefined();
  });
});
