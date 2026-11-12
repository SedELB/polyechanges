import { describe, expect, it } from 'vitest';
import { groupByUniversity, parseSourceFile, type LoadedSourceFile } from './sourceFile.js';

const source = (id: string, universityId: string, extra: Record<string, unknown> = {}, fileName = `${id}.json`): LoadedSourceFile => ({
  ...parseSourceFile({ id, universityId, kind: 'html', urls: ['https://example.org/a'], reader: 'r', ...extra }),
  fileName,
});

describe('groupByUniversity', () => {
  it('une fiche par université : un groupe chacune, par ordre d’université', () => {
    const groups = groupByUniversity([source('b', 'u2'), source('a', 'u1')]);
    expect(groups.map((g) => [g.universityId, g.sources.map((s) => s.id)])).toEqual([['u1', ['a']], ['u2', ['b']]]);
  });

  it('plusieurs fiches pour une université : la fiche <universityId>.json d’abord, puis l’ordre alphabétique des noms de fichier', () => {
    const groups = groupByUniversity([
      source('kaist-kr-saved', 'kaist-kr'),
      source('kaist-kr', 'kaist-kr'),
      source('kaist-kr-annexe', 'kaist-kr', {}, 'a-annexe.json'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].sources.map((s) => s.id)).toEqual(['kaist-kr', 'kaist-kr-annexe', 'kaist-kr-saved']);
  });

  it('refuse deux fiches de même id et nomme les deux fichiers', () => {
    expect(() => groupByUniversity([source('a', 'u1', {}, 'a.json'), source('a', 'u2', {}, 'b.json')])).toThrow(/a\.json.*b\.json/);
  });

  it('refuse une université dont toutes les fiches sont enrich', () => {
    expect(() => groupByUniversity([source('a', 'u1', { role: 'enrich' })])).toThrow(/u1.*enrich/);
  });

  it('ignore la source de Poly', () => {
    const poly = { ...parseSourceFile({ id: 'poly-log', universityId: null, kind: 'saved', urls: ['https://p.example'], files: ['p.html'], reader: 'poly' }), fileName: 'poly-log.json' };
    expect(groupByUniversity([poly, source('a', 'u1')]).map((g) => g.universityId)).toEqual(['u1']);
  });
});

describe('parseSourceFile, priorité et rôle', () => {
  const base = { id: 'x', universityId: 'u', kind: 'html', urls: ['https://example.org/a'], reader: 'r' };
  it('priority est un entier, absent par défaut', () => {
    expect(parseSourceFile(base).priority).toBeUndefined();
    expect(parseSourceFile({ ...base, priority: 2 }).priority).toBe(2);
    expect(parseSourceFile({ ...base, priority: -1 }).priority).toBe(-1);
    expect(() => parseSourceFile({ ...base, priority: 1.5 })).toThrow();
  });
  it('role vaut enrich ou est absent', () => {
    expect(parseSourceFile({ ...base, role: 'enrich' }).role).toBe('enrich');
    expect(() => parseSourceFile({ ...base, role: 'main' })).toThrow();
  });
});

describe('parseSourceFile, source enregistrée d’une université d’accueil', () => {
  const saved = { id: 'kaist-kr-saved', universityId: 'kaist-kr', kind: 'saved', urls: ['https://kaist.example/liste'], reader: 'r' };
  it('accepte des fichiers sous data/saved/<universityId>/', () => {
    expect(parseSourceFile({ ...saved, files: ['data/saved/kaist-kr/liste.html'] }).files).toEqual(['data/saved/kaist-kr/liste.html']);
  });
  it('refuse un fichier hors de data/saved/<universityId>/ et le nomme', () => {
    for (const f of ['data/saved/snu-kr/liste.html', 'data/manual/liste.html', 'data/saved/kaist-kr/../snu-kr/liste.html', 'liste.html']) {
      expect(() => parseSourceFile({ ...saved, files: [f] }), f).toThrow(`${f} doit être sous data/saved/kaist-kr/`);
    }
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

  it('les fichiers de Poly ne sont pas tenus d’être sous data/saved/', () => {
    expect(parseSourceFile(poly).files).toEqual(['data/manual/poly/programme-LOG.html']);
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
