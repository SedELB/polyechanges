import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getReader } from '../collect/readers.js';
import './index.js';
import { readNtuSyllabi } from './ntu-tw.js';
import { dedupeByCodeAndSemester, matchesPrefix, parseListPage } from './ntu-tw.discover.js';

const BASE = 'https://nol.ntu.edu.tw/nol/coursesearch/print_table.php';
function fixture(name: string): Buffer {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
}
function page(name: string, query: string, body?: Buffer) {
  return { url: `${BASE}?${query}`, body: body ?? fixture(name), contentType: 'text/html; charset=UTF-8' };
}

const csieFall = page('ntu-tw-csie3110-115-1.html', 'course_id=902%2043500&class=01&dpt_code=9020&ser_no=28040&semester=115-1&lang=EN');
const csieSpring = page('ntu-tw-csie3110-115-1.html', 'course_id=902%2043500&class=01&dpt_code=9020&ser_no=28041&semester=114-2&lang=EN');
const mathSpring = page('ntu-tw-math1008-114-2.html', 'course_id=201%2010600&class=&dpt_code=2010&ser_no=43257&semester=114-2&lang=EN');
const mathFall = page('ntu-tw-math4006-115-1.html', 'course_id=201%2049810&class=03&dpt_code=9010&ser_no=21319&semester=115-1&lang=EN');

describe('lecteur ntu-tw', () => {
  it('est enregistré sous le nom ntu-tw', () => {
    expect(getReader('ntu-tw')).toBe(readNtuSyllabi);
  });

  it('lit exactement les 3 cours de la fixture, un cours présent aux deux trimestres étant fusionné', () => {
    const courses = readNtuSyllabi([csieFall, mathSpring, mathFall, csieSpring]);
    expect(courses.map((c) => c.code)).toEqual(['CSIE3110', 'MATH1008', 'MATH4006']);
  });

  it('lit tous les champs du cours CSIE3110', () => {
    const [csie] = readNtuSyllabi([csieFall, csieSpring]);
    expect(csie).toMatchObject({
      code: 'CSIE3110',
      title: 'Formal Languages and Automata Theory',
      credits: 3,
      contactHours: null,
      language: 'en',
      terms: ['fall', 'spring'],
      level: 'undergrad',
      sourceUrl: csieFall.url,
    });
    expect(csie!.description).toContain('https://www.csie.ntu.edu.tw/~cjlin/courses/comptheory2026/');
    expect(csie!.description).toContain('Automata and Languages');
    expect(csie!.outline).toContain('Deterministic finite automata');
    expect(csie!.outline).toContain('Regular expressions');
  });

  it('lit le trimestre de printemps et les crédits d un cours de mathématiques', () => {
    const [math] = readNtuSyllabi([mathSpring]);
    expect(math).toMatchObject({
      code: 'MATH1008',
      title: 'Elementary Analysis: Introduction to Metric Spaces',
      credits: 2,
      terms: ['spring'],
      level: 'undergrad',
      outline: null,
    });
  });

  it('classe un code à partir de 5000 comme cycles supérieurs', () => {
    const body = Buffer.from(fixture('ntu-tw-math4006-115-1.html').toString('utf8').replaceAll('MATH4006', 'EE5184'));
    const [course] = readNtuSyllabi([page('', 'semester=115-1', body)]);
    expect(course).toMatchObject({ code: 'EE5184', level: 'grad' });
  });

  it('refuse une page sans numéro de cours', () => {
    expect(() => readNtuSyllabi([page('', 'semester=115-1', Buffer.from('<html><body>vide</body></html>'))])).toThrow();
  });

  it('refuse une adresse sans trimestre', () => {
    expect(() => readNtuSyllabi([page('ntu-tw-math4006-115-1.html', 'course_id=1')])).toThrow(/Trimestre/);
  });
});

describe('liste des cours en anglais', () => {
  const html = readFileSync(new URL('./fixtures/ntu-tw-list.html', import.meta.url), 'utf8');

  it('retient les départements utiles et lit le total annoncé', () => {
    const { total, courses } = parseListPage(html);
    expect(total).toBe(177);
    expect(courses.map((c) => c.code)).toEqual(['CSIE3110', 'CSIE3110', 'EE5184', 'EEE5011']);
    expect(courses[0]!.syllabusUrl).toBe(
      'https://nol.ntu.edu.tw/nol/coursesearch/print_table.php?course_id=902%2043500&class=01&dpt_code=9020&ser_no=28040&semester=115-1&lang=EN',
    );
  });

  it('garde une seule classe par code et par trimestre', () => {
    const { courses } = parseListPage(html);
    expect(dedupeByCodeAndSemester(courses).map((c) => c.code)).toEqual(['CSIE3110', 'EE5184', 'EEE5011']);
  });

  it('reconnaît les préfixes sans confondre EE et EEE', () => {
    expect(['CSIE5047', 'EE5002', 'EEE5011', 'MATH4006'].every(matchesPrefix)).toBe(true);
    expect(['FL8071', 'OE5011', 'EEX1000', 'CSIE'].some(matchesPrefix)).toBe(false);
  });
});

describe('fusion des trimestres d un même code', () => {
  const longer = Buffer.from(
    fixture('ntu-tw-csie3110-115-1.html')
      .toString('utf8')
      .replace('See course page:', 'Longue description du printemps : ' + 'un cours complet sur les automates et les langages formels. '.repeat(10) + 'See course page:'),
  );
  const springLonger = page('', 'course_id=902%2043500&class=01&semester=114-2', longer);

  it('garde la description la plus longue et l adresse de sa page', () => {
    const [course] = readNtuSyllabi([csieFall, springLonger]);
    expect(course!.terms).toEqual(['fall', 'spring']);
    expect(course!.description).toContain('Longue description du printemps');
    expect(course!.sourceUrl).toBe(springLonger.url);
  });

  it('garde la première page quand la seconde n a pas de description plus longue', () => {
    const [course] = readNtuSyllabi([springLonger, csieFall]);
    expect(course!.description).toContain('Longue description du printemps');
    expect(course!.sourceUrl).toBe(springLonger.url);
    expect(course!.terms).toEqual(['fall', 'spring']);
  });
});
