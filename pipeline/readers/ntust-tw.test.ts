import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findQuote, snapshotText } from '../provenance/snapshotText.js';
import {
  detailUrl,
  levelOf,
  listForm,
  mergeSections,
  parseDescription,
  parseList,
  toCourse,
} from './ntust-tw.build.js';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

const fall = fixture('ntust-tw-list-1151.json');
const spring = fixture('ntust-tw-list-1142.json');

describe('construction de la saisie ntust-tw', () => {
  it('ne garde que les sections en anglais des départements visés (4 sur 6 dans la fixture d automne)', () => {
    const sections = parseList(fall);
    expect(sections.map((s) => s.courseNo)).toEqual(['CS3004301', 'CS3004302', 'EE5628701', 'ET2107301']);
  });

  it('lit tous les champs d une section et nettoie le titre', () => {
    const [networks] = parseList(fall);
    expect(networks).toMatchObject({
      courseNo: 'CS3004301',
      code: 'CS3004',
      title: 'Introduction to Computer Networks',
      credits: 3,
      level: 'undergrad',
    });
    expect(parseList(fall).find((s) => s.courseNo === 'ET2107301')?.title).toBe('Electronics (I)');
  });

  it('classe 1er cycle et cycles supérieurs d après le numéro du cours', () => {
    expect(levelOf('CS3004301')).toBe('undergrad');
    expect(levelOf('CS161A001')).toBe('undergrad');
    expect(levelOf('EE5628701')).toBe('grad');
    expect(levelOf('ET6207701')).toBe('grad');
  });

  it('fusionne deux sections et deux trimestres d un même code en un seul cours', () => {
    const merged = mergeSections([
      ...parseList(fall).map((section) => ({ section, term: 'fall' as const, rawSha: 'a'.repeat(64) })),
      ...parseList(spring).map((section) => ({ section, term: 'spring' as const, rawSha: 'b'.repeat(64) })),
    ]);
    expect(merged.map((m) => [m.code, m.terms])).toEqual([
      ['CS3004', ['fall']],
      ['CS5024', ['spring']],
      ['EE5628', ['fall', 'spring']],
      ['ET2107', ['fall']],
      ['ET5310', ['spring']],
    ]);
    const networks = merged[0]!;
    expect(networks.byTerm.fall?.section.courseNo).toBe('CS3004301');
  });

  it('construit le cours complet avec l adresse de son plan de cours', () => {
    const sections = parseList(fall);
    const [merged] = mergeSections([{ section: sections[0]!, term: 'fall', rawSha: 'c'.repeat(64) }]);
    const description = parseDescription(fixture('ntust-tw-detail-CS3004301.json'));
    const course = toCourse(merged!, 'fall', description, '2026-11-10T20:00:00.000Z');
    expect(course).toMatchObject({
      code: 'CS3004',
      title: 'Introduction to Computer Networks',
      credits: 3,
      contactHours: null,
      language: 'en',
      terms: ['fall'],
      level: 'undergrad',
      sourceUrl: 'https://querycourse.ntust.edu.tw/QueryCourse/api/coursedetials?semester=1151&course_no=CS3004301&language=en',
    });
    expect(course.description).toContain('familiarize students with the concepts, techniques, and systems of computer networks');
    expect(course.provenance.sha256).toBe('c'.repeat(64));
  });

  it('l extrait de provenance se retrouve dans la copie brute de la liste', async () => {
    for (const body of [fall, spring]) {
      const pages = await snapshotText(Buffer.from(body), 'text/html');
      for (const section of parseList(body)) {
        expect(findQuote(pages, section.quote)).toEqual([{ page: 1, line: 1 }]);
        expect(section.quote).toContain('English Program');
      }
    }
  });

  it('formule la requête de liste et l adresse du plan de cours', () => {
    expect(listForm('1151')).toMatchObject({ Semester: '1151', CourseNotes: 'eng', OnlyMaster: '0', Language: 'en' });
    expect(detailUrl('1142', 'EE5628701')).toBe(
      'https://querycourse.ntust.edu.tw/QueryCourse/api/coursedetials?semester=1142&course_no=EE5628701&language=en',
    );
  });
});
