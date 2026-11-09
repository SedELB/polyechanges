import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findQuote, snapshotText } from '../provenance/snapshotText.js';
import {
  listForm,
  mergeSections,
  outlineUrl,
  parseDescription,
  parseList,
  toCourse,
} from './nycu-tw.build.js';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

const list = fixture('nycu-tw-list-114-2.json');

describe('construction de la saisie nycu-tw', () => {
  it('ne garde que les sections données en anglais (3 sur 4 dans la fixture)', () => {
    const sections = parseList(list);
    expect(sections.map((s) => s.cosId)).toEqual(['515502', '515512', '515513']);
  });

  it('lit tous les champs d une section', () => {
    const [digital] = parseList(list);
    expect(digital).toMatchObject({
      acy: '114',
      sem: '2',
      cosId: '515502',
      code: 'CSCS10005',
      title: 'Digital Circuit Design',
      credits: 3,
      level: 'undergrad',
    });
  });

  it('fusionne deux sections et deux trimestres d un même code en un seul cours', () => {
    const sections = parseList(list);
    const merged = mergeSections([
      ...sections.map((section) => ({ section, term: 'spring' as const, rawSha: 'a'.repeat(64) })),
      { section: sections[1]!, term: 'fall' as const, rawSha: 'b'.repeat(64) },
    ]);
    expect(merged.map((m) => [m.code, m.terms])).toEqual([
      ['CSCS10005', ['spring']],
      ['CSCS20007', ['fall', 'spring']],
    ]);
  });

  it('construit le cours complet avec l adresse de son plan de cours', () => {
    const sections = parseList(list);
    const [merged] = mergeSections([{ section: sections[0]!, term: 'spring', rawSha: 'c'.repeat(64) }]);
    const description = parseDescription(fixture('nycu-tw-description-515502.json'));
    const course = toCourse(merged!, description, '2026-11-10T20:00:00.000Z');
    expect(course).toMatchObject({
      code: 'CSCS10005',
      title: 'Digital Circuit Design',
      credits: 3,
      contactHours: null,
      language: 'en',
      terms: ['spring'],
      level: 'undergrad',
      sourceUrl: 'https://timetable.nycu.edu.tw/?r=main/crsoutline&Acy=114&Sem=2&CrsNo=515502&lang=en-us',
    });
    expect(course.description).toBe('This course covers the theory and practice of digital logic design.');
    expect(course.provenance.sha256).toBe('c'.repeat(64));
  });

  it('l extrait de provenance se retrouve dans la copie brute de la liste', async () => {
    for (const section of parseList(list)) {
      const pages = await snapshotText(Buffer.from(list), 'text/html');
      expect(findQuote(pages, section.quote)).toEqual([{ page: 1, line: 1 }]);
    }
  });

  it('formule la requête de liste et l adresse du plan de cours', () => {
    expect(listForm('UID', '115', '1')).toMatchObject({ m_acy: '115', m_sem: '1', m_dep_uid: 'UID', m_option: '**' });
    expect(outlineUrl('115', '1', '9')).toBe('https://timetable.nycu.edu.tw/?r=main/crsoutline&Acy=115&Sem=1&CrsNo=9&lang=en-us');
  });
});
