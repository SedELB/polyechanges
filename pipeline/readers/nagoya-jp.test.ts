import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getReader } from '../collect/readers.js';
import './index.js';
import { readNagoyaSyllabi } from './nagoya-jp.js';
import { parseOverview, selectCourses } from './nagoya-jp.discover.js';

const BASE = 'https://syllabus.adm.nagoya-u.ac.jp/data/2026/';
function fixture(name: string): Buffer {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
}
function syllabus(id: string) {
  return { url: `${BASE}${id}.html`, body: fixture(`nagoya-jp-syllabus-${id}.html`), contentType: 'text/html; charset=UTF-8' };
}

const robotics = syllabus('25_2026_Y003102560095');
const circuits = syllabus('08_2026_X310000849107');
const calculus = syllabus('00_2026_W21000061311');
const topics = syllabus('32_2026_Y002803211092');

describe('lecteur nagoya-jp', () => {
  it('est enregistré sous le nom nagoya-jp', () => {
    expect(getReader('nagoya-jp')).toBe(readNagoyaSyllabi);
  });

  it('lit exactement les 4 cours de la fixture', () => {
    const courses = readNagoyaSyllabi([robotics, circuits, calculus, topics]);
    expect(courses.map((c) => c.code)).toEqual(['2560095', '0849107', '0061311', '3211092']);
  });

  it('lit tous les champs d un cours de cycles supérieurs', () => {
    const [course] = readNagoyaSyllabi([robotics]);
    expect(course).toMatchObject({
      code: '2560095',
      title: 'Intelligent Robotics 1',
      credits: 1,
      contactHours: null,
      language: 'en',
      terms: ['fall'],
      level: 'grad',
      outline: null,
      sourceUrl: robotics.url,
    });
    expect(course!.description).toContain('Robotic technology connects real environments');
    expect(course!.description).toContain('Part 4-5: Introduction to robotics in autonomous driving');
    // Seul l'anglais est gardé : aucun caractère japonais dans la description.
    expect(course!.description).not.toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/);
  });

  it('retire la mention [G30] du titre et lit le trimestre de printemps d un cours de 1er cycle', () => {
    const [course] = readNagoyaSyllabi([circuits]);
    expect(course).toMatchObject({
      code: '0849107',
      title: 'Electronic Circuits',
      credits: 2,
      terms: ['spring'],
      level: 'undergrad',
    });
    expect(course!.description).toContain('This lecture is designed to learn basic knowledge');
    expect(course!.description).toContain('Introduction: diodes and transistors');
  });

  it('lit un cours de l institut d enseignement général (automne, 1er cycle)', () => {
    const [course] = readNagoyaSyllabi([calculus]);
    expect(course).toMatchObject({ code: '0061311', title: 'Calculus I', credits: 2, terms: ['fall'], level: 'undergrad' });
    expect(course!.description).toContain('Limits and continuity');
  });

  it('lit un cours de l école doctorale de mathématiques', () => {
    const [course] = readNagoyaSyllabi([topics]);
    expect(course).toMatchObject({ code: '3211092', title: 'Topics in Mathematical Science Ⅵ', credits: 2, terms: ['fall'], level: 'grad' });
    expect(course!.description).toContain('Mathematical aspects of condensed matter physics');
    expect(course!.description).not.toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/);
  });

  it('retire toutes les mentions entre crochets en tête du titre', () => {
    const body = Buffer.from(calculus.body.toString('utf8').replace('[G30]Calculus I', '[remote][G30]Calculus I'));
    const [course] = readNagoyaSyllabi([{ ...calculus, body }]);
    expect(course!.title).toBe('Calculus I');
  });

  it('fusionne une même fiche lue deux fois', () => {
    expect(readNagoyaSyllabi([robotics, robotics])).toHaveLength(1);
  });

  it('refuse une page sans code de cours', () => {
    expect(() => readNagoyaSyllabi([{ url: robotics.url, body: Buffer.from('<html><body>vide</body></html>'), contentType: 'text/html' }])).toThrow(/illisible/);
  });
});

describe('liste des cours en anglais', () => {
  const html = readFileSync(new URL('./fixtures/nagoya-jp-overview.html', import.meta.url), 'utf8');

  it('rattache chaque lien à sa section et normalise les adresses', () => {
    const entries = parseOverview(html);
    const robotics = entries.find((e) => e.title === 'Intelligent Robotics 1 (Qtr 1)');
    expect(robotics).toMatchObject({ section: 'Informatics', url: `${BASE}25_2026_Y003102560095.html` });
    const net = entries.filter((e) => e.url.endsWith('25_2026_Y010602550045.html'));
    expect(net.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.url.startsWith('https://syllabus.adm.nagoya-u.ac.jp/data/'))).toBe(true);
    expect(entries.every((e) => !/\s/.test(e.url))).toBe(true);
  });

  it('retient informatique, mathématiques et les cours de génie électrique ou de mathématiques listés ailleurs', () => {
    const urls = selectCourses(parseOverview(html));
    expect(urls).toHaveLength(21);
    expect(new Set(urls).size).toBe(21);
    const ids = urls.map((u) => u.split('/').pop());
    expect(ids).toContain('25_2026_Y003102560095.html'); // informatique
    expect(ids).toContain('32_2026_Y002803211092.html'); // mathématiques (école doctorale)
    expect(ids).toContain('08_2026_X310000889111.html'); // Computer Software I (génie)
    expect(ids).toContain('28_2026_Y011402838503.html'); // Semiconductor Devices (génie)
    expect(ids).toContain('00_2026_W21000061311.html'); // Calculus I (enseignement général)
    // Génie civil, chimie et anglais académique restent exclus.
    expect(ids).not.toContain('28_2026_Y001802858518.html');
    expect(ids).not.toContain('08_2026_X320000849304.html');
    expect(ids).not.toContain('00_2026_W13000062511.html');
  });
});
