import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isInScope,
  levelOf,
  mergeListed,
  parseCourse,
  parseListCodes,
  parseSearch,
  searchUrl,
  toCourse,
} from './sciencetokyo-jp.build.js';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

/** Texte extrait de la liste (lignes préfixées `p<page>:l<ligne>`), rangé par page. */
function listPages(): string[][] {
  const pages: string[][] = [];
  for (const raw of fixture('sciencetokyo-jp-list-lines.txt').split('\n')) {
    const m = raw.match(/^p(\d+):l(\d+) (.*)$/);
    if (!m) continue;
    (pages[Number(m[1]) - 1] ??= [])[Number(m[2]) - 1] = m[3]!;
  }
  return pages.map((p) => Array.from(p, (l) => l ?? ''));
}

describe('construction de la saisie sciencetokyo-jp', () => {
  const listed = parseListCodes(listPages(), 'fall');

  it('retient les codes de l informatique, du génie électrique et des mathématiques', () => {
    expect(listed.map((l) => l.code)).toEqual([
      'MTH.A403', 'MTH.A404', 'MTH.B403', 'MTH.B404', 'MTH.C403', 'MTH.C404',
      'EEE.D471', 'EEE.P402', 'EEE.P414', 'EEE.P461',
      'ICT.A418', 'ICT.I415', 'ICT.I419', 'ICT.I420',
      'MCS.T408', 'MCS.T410', 'MCS.T416', 'MCS.T419',
      'CSC.T431', 'CSC.T440',
    ]);
    expect(listed[0]).toMatchObject({ code: 'MTH.A403', term: 'fall', page: 1, line: 3 });
  });

  it('ignore la physique, la biologie et les cours dont le code est au milieu d une ligne', () => {
    expect(isInScope('PHY.C449')).toBe(false);
    expect(isInScope('LST.A408')).toBe(false);
    expect(isInScope('CSC.T431')).toBe(true);
  });

  it('fusionne les trimestres d un même code (automne avant printemps)', () => {
    const spring = parseListCodes(listPages(), 'spring').filter((l) => l.code === 'MTH.A403');
    const merged = mergeListed([...spring, ...listed]).find((m) => m.code === 'MTH.A403')!;
    expect(merged.terms).toEqual(['fall', 'spring']);
    expect(merged.first.term).toBe('spring');
  });

  it('classe les codes à partir de 400 comme cycles supérieurs', () => {
    expect(levelOf('MTH.A403')).toBe('grad');
    expect(levelOf('MTH.A303')).toBe('undergrad');
  });

  it('trouve l adresse de la fiche dans le résultat de recherche', () => {
    expect(searchUrl('MTH.A403')).toBe('https://syllabus.s.isct.ac.jp/courses/2026/search?q=MTH.A403&hl=en');
    expect(parseSearch(fixture('sciencetokyo-jp-search-MTH.A403.html'), 'MTH.A403')).toBe(
      'https://syllabus.s.isct.ac.jp/courses/2026/1/1-11-411111-0-0/202603871?hl=en',
    );
    expect(parseSearch(fixture('sciencetokyo-jp-search-MTH.A403.html'), 'MTH.A404')).toBeNull();
  });

  it('lit les champs complets d une fiche de cours', () => {
    const s = parseCourse(fixture('sciencetokyo-jp-course-MTH.A403.html'));
    expect(s.code).toBe('MTH.A403');
    expect(s.title).toBe('Advanced topics in Algebra C');
    expect(s.credits).toBe(1);
    expect(s.language).toBe('English');
    expect(s.quarter).toBe('3Q');
    expect(s.description.startsWith('This is an introductory course on the representation theory of quantum groups.')).toBe(true);
    expect(s.description).toContain('To be able to explain the construction of universal R-matrix.');
    expect(s.titleQuote).toBe('Advanced topics in Algebra C');
  });

  it('construit la saisie avec la position du titre dans la fiche', () => {
    const s = parseCourse(fixture('sciencetokyo-jp-course-MTH.A403.html'));
    const c = toCourse(
      { code: 'MTH.A403', terms: ['fall'], first: listed[0]! },
      s,
      'https://syllabus.s.isct.ac.jp/courses/2026/1/1-11-411111-0-0/202603871?hl=en',
      'abc',
      7,
      '2026-11-10T00:00:00.000Z',
    );
    expect(c).toMatchObject({
      code: 'MTH.A403',
      title: 'Advanced topics in Algebra C',
      credits: 1,
      language: 'en',
      terms: ['fall'],
      level: 'grad',
      contactHours: null,
    });
    expect(c.provenance).toMatchObject({ sha256: 'abc', locator: { page: 1, line: 7 }, quote: 'Advanced topics in Algebra C' });
  });
});
