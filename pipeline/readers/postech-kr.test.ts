import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findQuote, snapshotText } from '../provenance/snapshotText.js';
import { listUrl, mergeSections, pageCount, parseDetail, parseList, toCourse } from './postech-kr.build.js';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

const list = fixture('postech-kr-list-2026-20.html');
const detail = fixture('postech-kr-detail-15725.html');

describe('construction de la saisie postech-kr', () => {
  it('lit les trois sections de la liste (fixture)', () => {
    const sections = parseList(list);
    expect(sections.map((s) => s.code)).toEqual(['CSED357', 'CSED536', 'CSED354']);
  });

  it('lit les champs d une section de la liste', () => {
    const [first] = parseList(list);
    expect(first).toMatchObject({
      code: 'CSED357',
      section: '01',
      language: 'EN',
      detailId: '15725',
      detailUrl: 'https://plms.postech.ac.kr/local/ubion/course/lists_view.php?lang=Y&year=2026&semester=20&dept=00039100&id=15725',
    });
  });

  it('lit le titre anglais, les crédits, le niveau et la langue de la fiche', () => {
    expect(parseDetail(detail)).toEqual({
      code: 'CSED357',
      title: 'Database Systems',
      credits: 4,
      level: 'undergrad',
      english: true,
      titleQuote: '영문 강좌명 | Database Systems',
    });
  });

  it('fusionne les trimestres d un même code', () => {
    const sections = parseList(list);
    const merged = mergeSections([
      { section: sections[0]!, term: 'fall', rawSha: 'a'.repeat(64) },
      { section: sections[0]!, term: 'spring', rawSha: 'b'.repeat(64) },
      { section: sections[1]!, term: 'spring', rawSha: 'b'.repeat(64) },
    ]);
    expect(merged.map((m) => [m.code, m.terms])).toEqual([
      ['CSED357', ['fall', 'spring']],
      ['CSED536', ['spring']],
    ]);
  });

  it('construit le cours complet sans description', () => {
    const [section] = parseList(list);
    const [merged] = mergeSections([{ section: section!, term: 'fall', rawSha: 'c'.repeat(64) }]);
    const course = toCourse(merged!, parseDetail(detail), 'd'.repeat(64), 7, '2026-11-10T20:00:00.000Z');
    expect(course).toMatchObject({
      code: 'CSED357',
      title: 'Database Systems',
      description: '',
      outline: null,
      credits: 4,
      contactHours: null,
      language: 'en',
      terms: ['fall'],
      level: 'undergrad',
      sourceUrl: section!.detailUrl,
    });
    expect(course.provenance).toEqual({
      url: section!.detailUrl,
      retrievedAt: '2026-11-10T20:00:00.000Z',
      sha256: 'd'.repeat(64),
      locator: { page: 1, line: 7 },
      quote: '영문 강좌명 | Database Systems',
    });
  });

  it('l extrait de provenance se retrouve dans la copie brute de la fiche', async () => {
    const pages = await snapshotText(Buffer.from(detail), 'text/html');
    const found = findQuote(pages, parseDetail(detail).titleQuote);
    expect(found).toHaveLength(1);
  });

  it('formule l adresse de liste', () => {
    expect(listUrl('2026', '20', '00039100')).toBe(
      'https://plms.postech.ac.kr/local/ubion/course/lists.php?lang=en&year=2026&semester=20&dept=00039100&lang=Y',
    );
  });
});

describe('pagination de la liste postech-kr', () => {
  it('lit le nombre de pages de la liste (2 dans la fixture)', () => {
    expect(pageCount(list)).toBe(2);
  });

  it('une liste sans pagination compte une page', () => {
    expect(pageCount('<html><body><table></table></body></html>')).toBe(1);
  });

  it('ajoute le numéro de page à l adresse de liste', () => {
    expect(listUrl('2026', '20', '00039100', 2)).toBe(
      'https://plms.postech.ac.kr/local/ubion/course/lists.php?lang=en&year=2026&semester=20&dept=00039100&lang=Y&page=2',
    );
  });
});
