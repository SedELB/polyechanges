import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getReader } from '../collect/readers.js';
import './index.js';
import { exclusionOf, parseExport, parseTabular, readSnuExports, termOfExport } from './snu-kr.js';
import { parseCatalogue, readSnuCatalogue } from './snu-kr-catalog.js';

const URL_SEARCH = 'https://sugang.snu.ac.kr/sugang/cc/cc100InterfaceSrch.action';
function page(name: string) {
  return { url: URL_SEARCH, body: readFileSync(new URL(`./fixtures/snu-kr-${name}.txt`, import.meta.url)), contentType: 'text/plain' };
}
const engFall = page('eng-fall'); // interface anglaise, 2nd semester
const sciFall = page('sci-fall'); // interface coréenne, 2학기
const engSpring = page('eng-spring'); // interface coréenne, 1학기
const sciSpring = page('sci-spring');

describe('lecteur snu-kr, export Excel', () => {
  it('est enregistré sous le nom snu-kr', () => {
    expect(getReader('snu-kr')).toBe(readSnuExports);
    expect(getReader('snu-kr-catalog')).toBe(readSnuCatalogue);
  });

  it('lit le trimestre de la ligne de filtres, en anglais et en coréen', () => {
    expect(parseExport(engFall.body).term).toBe('fall');
    expect(parseExport(sciFall.body).term).toBe('fall');
    expect(parseExport(engSpring.body).term).toBe('spring');
    expect(() => termOfExport([['Course Search'], ['Year : 2026']])).toThrow(/Trimestre/);
  });

  it('lit les rangées des deux interfaces avec les mêmes champs', () => {
    const en = parseExport(engFall.body).rows;
    expect(en).toHaveLength(5);
    expect(en[2]).toEqual({
      classification: 'Elective Subject for Major',
      department: 'Department of Computer Science and Engineering',
      degree: 'Bachelor',
      courseNumber: '4190.428',
      lectureNumber: '001',
      title: 'Introduction to Machine Learning',
      subtitle: '',
      credits: 3,
      language: 'English',
      status: 'Open Lecture',
    });
    const ko = parseExport(sciFall.body).rows;
    expect(ko).toHaveLength(4);
    expect(ko[0]).toMatchObject({ department: '수리과학부', degree: '석박사통합', courseNumber: '3341.715', subtitle: '디오판토스 해석', language: '영어', status: '설강' });
  });

  it('refuse un fichier sans les en-têtes attendus', () => {
    expect(() => parseExport(Buffer.from('Course Search\r\nautre chose\r\n', 'utf8'))).toThrow(/En-têtes/);
  });

  it('lit le texte tabulé avec cellules entre guillemets', () => {
    expect(parseTabular('a\t"b\tc"\t"d ""e"""\r\nf\tg\r\n')).toEqual([['a', 'b\tc', 'd "e"'], ['f', 'g']]);
  });

  it('écarte les départements hors périmètre, les cours fermés, en coréen, et les thèses, avec leur raison', () => {
    const reasons = (p: typeof engFall) => parseExport(p.body).rows.map((r) => exclusionOf(r));
    // 430.301C ×2, 4190.428, M3244 (coréen), 445.206 (matériaux)
    expect(reasons(engFall)).toEqual([null, null, null, 'language', 'department']);
    // 3341.715, 326.521, F31.105 001 (coréen), F31.105 011 (fermé, aussi en coréen : la fermeture est jugée d'abord)
    expect(reasons(sciFall)).toEqual([null, null, 'language', 'closed']);
    // 4190.428, M1522.007400, 4190.960 (thèse), 430.629A ×2
    expect(reasons(engSpring)).toEqual([null, null, 'not-a-course', null, null]);
    expect(reasons(sciSpring)).toEqual(['not-a-course', null, null]);
  });

  it('un cours : les sections d un même numéro sont fusionnées, les trimestres sont l union des sections retenues', () => {
    const courses = readSnuExports([engFall, sciFall, engSpring, sciSpring]);
    const byCode = new Map(courses.map((c) => [c.code, c]));
    expect(courses.map((c) => c.code)).toEqual([
      '430.301C', '4190.428', '3341.715', '326.521', 'M1522.007400', '430.629A', '3341.454', '326.638',
    ]);
    // Deux sections 430.301C en un cours.
    expect(byCode.get('430.301C')).toEqual({
      code: '430.301C',
      title: 'Analog Electronic Circuits',
      description: '',
      outline: null,
      credits: 3,
      contactHours: null,
      language: 'en',
      terms: ['fall'],
      level: 'undergrad',
      sourceUrl: URL_SEARCH,
    });
    // Automne (interface anglaise) et printemps (interface coréenne) : trimestres réunis, titre sans hangul.
    expect(byCode.get('4190.428')).toMatchObject({ title: 'Introduction to Machine Learning', terms: ['fall', 'spring'], level: 'undergrad' });
  });

  it('niveau : Bachelor donne undergrad, tout le reste grad (en anglais ou en coréen)', () => {
    const byCode = new Map(readSnuExports([engFall, sciFall, engSpring, sciSpring]).map((c) => [c.code, c]));
    expect(byCode.get('326.521')?.level).toBe('grad'); // 석사
    expect(byCode.get('3341.715')?.level).toBe('grad'); // 석박사통합
    expect(byCode.get('3341.454')?.level).toBe('undergrad'); // 학사
  });

  it('titre : le sous-titre s ajoute après « : » seulement quand toutes les sections le partagent', () => {
    const byCode = new Map(readSnuExports([engSpring, sciFall]).map((c) => [c.code, c]));
    expect(byCode.get('3341.715')?.title).toBe('대수학특강 : 디오판토스 해석');
    // 430.629A : deux sections de sous-titres différents, donc le titre seul.
    expect(byCode.get('430.629A')?.title).toBe('전기에너지변환 및 회로특강');
  });

  it('une rangée sans numéro de cours fait échouer la lecture', () => {
    const text = '﻿Course Search\r\n"Year : 2026, Semester : 2nd Semester"\r\n' +
      ['Course Classification', 'College', 'Department', 'Degree Program', 'Academic Year', 'Course Number', 'Lecture Number', 'Course Title', 'Course Subtitle', 'Credits', 'Language for the lecture', 'Status'].join('\t') + '\r\n' +
      ['x', 'y', 'Department of Statistics', 'Bachelor', '1', '', '001', 'Probability', '', '3', 'English', 'Open Lecture'].join('\t') + '\r\n';
    const body = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text.slice(1), 'utf16le')]);
    expect(() => readSnuExports([{ url: URL_SEARCH, body, contentType: 'text/plain' }])).toThrow(/numéro de cours/);
  });
});

describe('lecteur snu-kr-catalog, catalogue de département', () => {
  // Lignes extraites du PDF du département d'informatique, telles que le collecteur les lit (page 3 coupée en deux).
  const page3a = [
    '공과대학(College of Engineering) ∴컴퓨터공학부(Dept. of Computer Science and Engineering)',
    '`',
    '- 385 -',
    '4190.308* 컴퓨터구조 3-3-0',
    'Computer Architecture',
    '디지털  컴퓨터를  구성하는  주요  구성요소들의  기능과  그들',
    '시스템의  성능  분석에  필요한  기본적인  지식  등을  배운다.',
    'This course introduces main components of digital',
    'computers, their functionalities and interactions. It studies',
    'various design techniques for implementing modern com-',
  ];
  const page3b = [
    '공과대학(College of Engineering) ∴컴퓨터공학부(Dept. of Computer Science and Engineering)',
    '`',
    '- 386 -',
    'puter systems. Specific topics will include instruction set ar-',
    'chitecture, CPU, pipelining, and hierarchical memory',
    'organization.',
    '4190.309A 하드웨어시스템설계 3-3-0',
    'Hardware System Design',
    '일단  하드웨어  디자인에  필요한  기본을  배운다. 납땜  방법',
    '어로써, VHDL을  배운다.',
    'This course introduces computer hardware design using',
    'CAD tools. It also covers VHDL as a hardware description',
    'language.',
    '4190.310* 프로그래밍언어 3-3-0',
    'Programming Language',
    '프로그래밍  언어론에  대한  전반적인  이해를  높이고, 다양한',
    'This course examines fundamental syntactic and se-',
    'mantic concepts underlying modern programming',
    'languages.',
  ];

  it('lit le titre anglais et la description anglaise de chaque fiche, astérisque et coupures de mots compris', () => {
    const entries = parseCatalogue([page3a, page3b]);
    expect(entries.map((e) => [e.code, e.title])).toEqual([
      ['4190.308', 'Computer Architecture'],
      ['4190.309A', 'Hardware System Design'],
      ['4190.310', 'Programming Language'],
    ]);
    expect(entries[0].description).toBe(
      'This course introduces main components of digital computers, their functionalities and interactions. ' +
        'It studies various design techniques for implementing modern computer systems. ' +
        'Specific topics will include instruction set architecture, CPU, pipelining, and hierarchical memory organization.',
    );
    expect(entries[1].description).toBe(
      'This course introduces computer hardware design using CAD tools. It also covers VHDL as a hardware description language.',
    );
    expect(entries[2].description).toBe(
      'This course examines fundamental syntactic and semantic concepts underlying modern programming languages.',
    );
  });

  it('ignore les lignes de bandeau, de numéro de page et de légende', () => {
    const lines = parseCatalogue([page3a, page3b]).flatMap((e) => [e.title, e.description]).join(' ');
    expect(lines).not.toMatch(/College of Engineering|- 38\d -/);
  });
});
