import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getReader } from '../collect/readers.js';
import './index.js';
import { isKept, levelOf, parseRows, readNckuList, termOfList } from './ncku-tw.js';
import { syllabusUrls } from './ncku-tw.discover.js';
import { readNckuSyllabi } from './ncku-tw-syllabus.js';

function text(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}
const QUERY = 'https://course.ncku.edu.tw/index.php?c=qry11215&m=en_query';
const page = (name: string, url = QUERY) => ({ url, body: Buffer.from(text(name)), contentType: 'text/html' });
const SYLLABUS = 'https://class-qry.acad.ncku.edu.tw/syllabus/online_display.php?syear=0115&sem=1&co_no=';
const LIST = 'https://class-qry.acad.ncku.edu.tw/syllabus/syllabus.php?syear=0115&sem=1&co_no=';

describe('liste des cours de NCKU', () => {
  it('est enregistrée sous le nom ncku-tw', () => {
    expect(getReader('ncku-tw')).toBe(readNckuList);
  });

  it('lit toutes les rangées de la table, avec et sans « Course taught in English »', () => {
    const rows = parseRows(text('ncku-tw-csie.html'));
    expect(rows.map((r) => r.code)).toEqual(['F715910', 'F720401', 'F720600', 'F720600', 'F724800', 'E120400']);
    expect(rows.filter((r) => r.taughtInEnglish).map((r) => r.code)).toEqual(['F720401', 'F720600', 'F724800', 'E120400']);
    expect(rows[1]).toMatchObject({
      code: 'F720401',
      classCode: '2',
      attribute: 'CSIE1003',
      title: 'INTRODUCTION TO CIRCUITS THEORY AND DIGITAL ELECTRONICS',
      credits: 3,
      taughtInEnglish: true,
      syllabusUrl: `${LIST}F720401&class_code=2`,
    });
  });

  it('lit le trimestre de la page', () => {
    expect(termOfList(text('ncku-tw-csie.html'))).toBe('fall');
    expect(termOfList('<span>Spring semester of 2026-2027</span>')).toBe('spring');
    expect(() => termOfList('<html></html>')).toThrow(/Trimestre/);
  });

  it('écarte les cours non donnés en anglais, de langue et hors informatique, génie électrique et mathématiques', () => {
    const courses = readNckuList([page('ncku-tw-csie.html')]);
    // F715910 (physique, pas en anglais), F724800 (cours d anglais), E120400 (ME2152) sont écartés.
    expect(courses.map((c) => c.code)).toEqual(['F720401', 'F720600']);
    const rows = parseRows(text('ncku-tw-csie.html'));
    expect(rows.filter((r) => r.taughtInEnglish && !isKept(r)).map((r) => r.code)).toEqual(['F724800', 'E120400']);
  });

  it('lit tous les champs d un cours de la liste', () => {
    const [circuits] = readNckuList([page('ncku-tw-csie.html')]);
    expect(circuits).toEqual({
      code: 'F720401',
      title: 'INTRODUCTION TO CIRCUITS THEORY AND DIGITAL ELECTRONICS',
      description: '',
      outline: null,
      credits: 3,
      contactHours: null,
      language: 'en',
      terms: ['fall'],
      level: 'undergrad',
      sourceUrl: QUERY,
    });
  });

  it('lit les trois fixtures : 2, 1 et 2 cours, un cours de cycles supérieurs en mathématiques, la rangée de pratique ignorée', () => {
    const csie = readNckuList([page('ncku-tw-csie.html')]);
    const ee = readNckuList([page('ncku-tw-ee.html')]);
    const math = readNckuList([page('ncku-tw-math.html')]);
    expect([csie.length, ee.length, math.length]).toEqual([2, 1, 2]);
    expect(ee[0]).toMatchObject({ code: 'E212200', title: 'INTRODUCTION TO COMPUTER SCIENCE', credits: 3, level: 'undergrad' });
    expect(math.map((c) => [c.code, c.credits, c.level])).toEqual([
      ['C120601', 3, 'undergrad'],
      ['C133800', 3, 'grad'],
    ]);
  });

  it('fusionne les sections d un même cours en une seule entrée', () => {
    const courses = readNckuList([page('ncku-tw-ee.html', `${QUERY}&a=1`), page('ncku-tw-ee.html', `${QUERY}&a=2`)]);
    expect(courses.map((c) => c.code)).toEqual(['E212200']);
    expect(courses[0]!.sourceUrl).toBe(`${QUERY}&a=1`);
  });

  it('classe un code d attribut à partir de 5000 comme cycles supérieurs', () => {
    expect(levelOf('MATH5202')).toBe('grad');
    expect(levelOf('CSIE4010')).toBe('undergrad');
    expect(levelOf('')).toBe('undergrad');
  });

  it('refuse une page sans trimestre', () => {
    expect(() => readNckuList([{ url: QUERY, body: Buffer.from('<html><body>vide</body></html>'), contentType: 'text/html' }])).toThrow(/Trimestre/);
  });

  it('donne les adresses des plans de cours des seules rangées retenues', () => {
    expect(syllabusUrls([text('ncku-tw-csie.html'), text('ncku-tw-ee.html'), text('ncku-tw-math.html')])).toEqual([
      `${LIST}F720401&class_code=2`,
      `${LIST}F720600&class_code=2`,
      `${LIST}E212200&class_code=3`,
      `${LIST}C120601&class_code=1`,
      `${LIST}C133800&class_code=`,
    ]);
  });
});

describe('plans de cours de NCKU', () => {
  const circuits = page('ncku-tw-syllabus-F720401.html', `${SYLLABUS}F720401&class_code=2`);
  const complex = page('ncku-tw-syllabus-C133800.html', `${SYLLABUS}C133800&class_code=`);

  it('est enregistré sous le nom ncku-tw-syllabus', () => {
    expect(getReader('ncku-tw-syllabus')).toBe(readNckuSyllabi);
  });

  it('lit tous les champs d un plan de cours, les lignes en chinois étant retirées', () => {
    const [course] = readNckuSyllabi([circuits]);
    expect(course).toMatchObject({
      code: 'F720401',
      title: 'INTRODUCTION TO CIRCUITS THEORY AND DIGITAL ELECTRONICS',
      credits: 3,
      language: 'en',
      terms: ['fall'],
      level: 'undergrad',
      outline: null,
      sourceUrl: circuits.url,
    });
    expect(course!.description).toBe(
      [
        '1. Introduction',
        '2. Basic RLC Circuit Theory',
        '3. Frequency response and Bode plot',
        '4. Semiconductor and Transistors',
        '5. Transistor Circuitry and Amplifier',
        'Logic Circuits',
      ].join('\n'),
    );
  });

  it('ajoute les objectifs devant un contenu de moins de 80 caractères', () => {
    const body = Buffer.from(
      text('ncku-tw-syllabus-F720401.html').replace(/3\. Frequency response[\s\S]*?Logic Circuits/, 'Logic Circuits'),
    );
    const [course] = readNckuSyllabi([{ ...circuits, body }]);
    expect(course!.description).toBe(
      'Basic Circuit Theory\nUnderstanding of Electronics\nBasic Circuit Design\n\n1. Introduction\n2. Basic RLC Circuit Theory\nLogic Circuits',
    );
  });

  it('garde la prose anglaise sans le chinois et lit le plan hebdomadaire', () => {
    const [course] = readNckuSyllabi([complex]);
    expect(course).toMatchObject({ code: 'C133800', title: 'COMPLEX VARIABLES', credits: 3, language: 'en', level: 'grad' });
    expect(course!.description).toContain('This course provides the mathematical foundations');
    expect(course!.description).not.toMatch(/[一-鿿]/);
    expect(course!.outline).toContain('Week 1 : Holomorphicity');
    expect(course!.outline).toContain('Week 2 : Cauchy-Riemann equation');
  });

  it('laisse la langue inconnue quand le plan ne dit pas English', () => {
    const body = Buffer.from(text('ncku-tw-syllabus-F720401.html').replace('英文 English', '中文 Chinese'));
    const [course] = readNckuSyllabi([{ ...circuits, body }]);
    expect(course!.language).toBe('unknown');
  });

  it('fusionne deux plans du même numéro de cours en gardant le plus long', () => {
    const short = Buffer.from(text('ncku-tw-syllabus-F720401.html').replace('Logic Circuits', ''));
    const courses = readNckuSyllabi([{ ...circuits, body: short, url: `${circuits.url}&x=1` }, circuits]);
    expect(courses.map((c) => c.code)).toEqual(['F720401']);
    expect(courses[0]!.description).toContain('Logic Circuits');
    expect(courses[0]!.sourceUrl).toBe(circuits.url);
  });

  it('refuse une page sans numéro de cours', () => {
    expect(() => readNckuSyllabi([{ url: circuits.url, body: Buffer.from('<html></html>'), contentType: 'text/html' }])).toThrow(/illisible/);
  });
});
