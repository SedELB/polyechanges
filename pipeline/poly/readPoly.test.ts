import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseProgramCourses, parseProgramPage, readPolyCourses } from './readPoly.js';

const html = readFileSync(new URL('./fixtures/programme-extrait.html', import.meta.url), 'utf8');
const PROGRAM_URL = 'https://www.polymtl.ca/programmes/programmes/baccalaureat-en-genie-logiciel';
const courses = parseProgramCourses(html, PROGRAM_URL);
const get = (sigle: string) => {
  const c = courses.find((x) => x.sigle === sigle);
  if (!c) throw new Error(`absent : ${sigle}`);
  return c;
};

describe('lecture de la page du programme', () => {
  it('lit le titre, les crédits, le triplet et les préalables de LOG3430', () => {
    expect(get('LOG3430')).toMatchObject({
      title: 'Méthodes de test et de validation du logiciel',
      credits: 3,
      triplet: [3, 1.5, 4.5],
      prerequisites: 'LOG1810, LOG2400, MTH2302D ou MTH2304',
      sourceUrl: 'https://www.polymtl.ca/programmes/cours/methodes-de-test-et-de-validation-du-logiciel',
    });
    expect(get('LOG3430').description).toMatch(/^Importance de la validation et de la vérification/);
    expect(get('LOG3430').description).not.toMatch(/Détails|Description/);
  });

  it('lit le triplet et les crédits de INF3710', () => {
    expect(get('INF3710')).toMatchObject({ sigle: 'INF3710', credits: 3, triplet: [3, 1.5, 4.5] });
  });

  it('lit un triplet entier', () => {
    expect(get('INF1007')).toMatchObject({ credits: 4, triplet: [4, 4, 4] });
  });

  it("un cours par sigle, avec les sections où il apparaît dans l'ordre de la page", () => {
    expect(courses.filter((c) => c.sigle === 'INF3405')).toHaveLength(1);
    expect(get('INF3405').groups).toEqual([
      'Filière classique (93 crédits)',
      '6. Technologies de l’information pour ingénieurs (12 crédits)',
    ]);
    expect(get('INF8085').groups).toEqual([
      'Cours spécialisés de la filière classique (15 crédits)',
      '6. Technologies de l’information pour ingénieurs (12 crédits)',
      'Sécurité et mobilité en logiciel (27 crédits)',
    ]);
  });

  it('nomme les sous-sections avec leur section parente', () => {
    expect(get('GBM1611').groups).toEqual(['Filière classique (93 crédits) : 3 crédits parmi les cours suivants']);
    expect(get('LOG8970').groups).toEqual([
      'Cours spécialisés de la filière classique (15 crédits) : 6 crédits parmi les cours suivants',
    ]);
  });

  it('obligatoire seulement dans la section « Filière classique (93 crédits) » elle-même', () => {
    expect(get('LOG3430').status).toBe('obligatoire');
    expect(get('INF3405').status).toBe('obligatoire');
    expect(get('GBM1611').status).toBe('optionnel');
    expect(get('INF2705').status).toBe('optionnel');
    expect(parseProgramPage(html).find((c) => c.sigle === 'LOG3430')).toEqual({ sigle: 'LOG3430', status: 'obligatoire' });
  });

  it('garde les sigles à suffixe et lit les activités sans crédit', () => {
    expect(get('LOG3005I')).toMatchObject({ credits: 0, triplet: [0, 0, 0] });
    expect(get('INF8245AE').credits).toBe(4);
  });

  it('ignore les lignes sans fiche (stage, cours au choix)', () => {
    expect(courses.some((c) => /^STGO/.test(c.sigle))).toBe(false);
  });

  it("n'importe pas les sigles de l'année préparatoire (premier chiffre 0)", () => {
    const row = (sigle: string) => `<table><tr class="titre"><td class="sigle">${sigle}<br></td><td class="titre">Cours</td></tr>
      <tr class="contenu"><td><div class="details"><div class="tooltip triplet"><strong>Nombre de crédits : </strong>3 (3 - 1,5 - 4,5)</div></div><div class="desc"><div><strong>Description</strong><br>Texte.</div></div></td></tr></table>`;
    const page = `<h2 class="field-titre-groupe">Filière classique (93 crédits)</h2>${row('MTH0101')}${row('MTH1101')}`;
    const read = parseProgramCourses(page, PROGRAM_URL);
    expect(read.map((c) => c.sigle)).toEqual(['MTH1101']);
    expect(read[0]).toMatchObject({ triplet: [3, 1.5, 4.5], sourceUrl: PROGRAM_URL });
  });

  it("applique les règles d'admissibilité", () => {
    const all = readPolyCourses(html, PROGRAM_URL, '2026-11-10');
    const by = (s: string) => all.find((c) => c.sigle === s);
    expect(by('SSH3501')).toMatchObject({ eligible: false, compared: false });
    expect(by('LOG3005')).toMatchObject({ eligible: false });
    expect(by('LOG3900')).toMatchObject({ eligible: true, compared: false });
    expect(by('DDI8001')).toMatchObject({ eligible: true, compared: false });
    expect(by('INF1007')).toMatchObject({ eligible: true, compared: false });
    expect(by('LOG3430')).toMatchObject({ eligible: true, compared: true, collectedAt: '2026-11-10' });
    expect(by('LOG8100')).toMatchObject({ compared: true });
  });
});
