import { beforeEach, describe, expect, it } from 'vitest';
import { upsertCriterionVersion } from '../db/criterion.js';
import { activeHostCourses } from '../db/hostCourses.js';
import { replaceMatches } from '../db/matches.js';
import type { Db } from '../db/open.js';
import { drawSample, pairIdOf, parsePairId, sampleFile, topCandidates } from './sample.js';
import { matchRow, seedContestDb, UNIVERSITIES } from './testDb.js';

const universityOf = (db: Db, hostCourseId: number): string =>
  (db.prepare('SELECT university_id FROM host_courses WHERE id = ?').get(hostCourseId) as { university_id: string }).university_id;

describe('pairIdOf et parsePairId', () => {
  it('se répondent', () => {
    expect(parsePairId(pairIdOf('INF8245AE', 42))).toEqual({ polySigle: 'INF8245AE', hostCourseId: 42 });
  });
});

describe('drawSample', () => {
  let db: Db;
  beforeEach(() => {
    db = seedContestDb(['contest-a', 'contest-b']);
  });

  it('le tirage est le même avec la même graine, 60 paires, sans doublon ni paire « titre »', () => {
    const a = drawSample(db, ['contest-a', 'contest-b'], 42);
    expect(a).toEqual(drawSample(db, ['contest-a', 'contest-b'], 42));
    expect(a).toHaveLength(60);
    expect(new Set(a.map((p) => p.pairId)).size).toBe(60);
    const textUsed = db.prepare('SELECT DISTINCT text_used FROM matches WHERE poly_sigle = ? AND host_course_id = ?');
    for (const p of a) {
      const used = (textUsed.all(p.polySigle, p.hostCourseId) as { text_used: string }[]).map((r) => r.text_used);
      expect(used).not.toContain('titre');
    }
  });

  it('chaque université qui a des paires décrites en a au moins une, avec son pays', () => {
    const a = drawSample(db, ['contest-a', 'contest-b'], 42);
    const drawn = new Set(a.map((p) => universityOf(db, p.hostCourseId)));
    expect([...drawn].sort()).toEqual(UNIVERSITIES.filter((u) => u.described).map((u) => u.id));
    for (const p of a) {
      const u = UNIVERSITIES.find((x) => x.id === universityOf(db, p.hostCourseId));
      expect(p.countryCode).toBe(u?.country);
    }
  });

  it('répartit les paires également, 4 sur 5 parmi les 3 meilleurs candidats de chaque version', () => {
    const a = drawSample(db, ['contest-a', 'contest-b'], 42);
    const top = topCandidates(db, ['contest-a', 'contest-b']);
    const beta = a.filter((p) => universityOf(db, p.hostCourseId) === 'beta-jp');
    // 3 universités décrites : 20 paires chacune ; gamma-kr n'a que 18 paires, ses 2 restantes reviennent à alpha-tw
    expect(beta).toHaveLength(20);
    expect(beta.filter((p) => top.has(p.pairId))).toHaveLength(16);
    expect(a.filter((p) => universityOf(db, p.hostCourseId) === 'gamma-kr')).toHaveLength(18);
    expect(a.filter((p) => universityOf(db, p.hostCourseId) === 'alpha-tw')).toHaveLength(22);
  });

  it('une autre graine donne un autre tirage', () => {
    expect(drawSample(db, ['contest-a', 'contest-b'], 43)).not.toEqual(drawSample(db, ['contest-a', 'contest-b'], 42));
  });

  it('refuse de tirer moins de 60 paires décrites', () => {
    db.prepare("UPDATE host_courses SET active = 0 WHERE university_id IN ('alpha-tw', 'beta-jp')").run();
    expect(() => drawSample(db, ['contest-a', 'contest-b'], 42)).toThrow(/60/);
  });
});

describe('topCandidates', () => {
  it('réunit les 3 meilleurs de chaque version, par cours de Poly et par université ; à score égal, la similarité moyenne départage', () => {
    const db = seedContestDb([]);
    const id = (code: string) => (activeHostCourses(db).find((h) => h.code === code) as { id: number }).id;
    upsertCriterionVersion(db, 'contest-a', 'h', '{}');
    upsertCriterionVersion(db, 'contest-b', 'h', '{}');
    const low = [0.1, 0.1, 0.1, 0.1];
    replaceMatches(db, 'contest-a', [
      matchRow('INF1001', id('A1'), [0.9, 0.9, 0.9, 0.9]),
      matchRow('INF1001', id('A2'), [0.9, 0.9, 0.1, 0.1]),
      // même score que A4 (aucune notion), mais similarité moyenne plus haute
      matchRow('INF1001', id('A3'), [0.5, 0.5, 0.5, 0.5]),
      matchRow('INF1001', id('A4'), low),
      matchRow('INF1001', id('A5'), low),
    ]);
    replaceMatches(db, 'contest-b', [
      matchRow('INF1001', id('A1'), low),
      matchRow('INF1001', id('A2'), low),
      matchRow('INF1001', id('A3'), low),
      matchRow('INF1001', id('A4'), [0.9, 0.9, 0.9, 0.9]),
      matchRow('INF1001', id('A5'), low),
    ]);
    const top = topCandidates(db, ['contest-a', 'contest-b']);
    // contest-b : A4 puis, à égalité parfaite, les plus petits identifiants A1 et A2
    expect([...top].sort()).toEqual(['A1', 'A2', 'A3', 'A4'].map((c) => pairIdOf('INF1001', id(c))).sort());
  });
});

describe('sampleFile', () => {
  it('donne les deux descriptions et les données de charge, sans score, niveau ni nom de modèle', () => {
    const db = seedContestDb(['contest-a', 'contest-b']);
    const pairs = drawSample(db, ['contest-a', 'contest-b'], 42);
    const file = sampleFile(db, pairs, 42, 13);
    expect(file.pairs).toHaveLength(60);
    const first = file.pairs[0];
    expect(first.pairId).toBe(pairs[0].pairId);
    expect(first.polyCourse.description).toMatch(/^Description officielle/);
    expect(first.hostCourse.description).toMatch(/^Topics of/);
    expect(first.workload.polyContactHours).toBe(58.5);
    expect(first.workload.hostContactHours).toBe(48);
    const text = JSON.stringify(file);
    for (const forbidden of ['contest-', 'score', 'Score', 'notion', 'level', '"tres"', 'conforme', 'MiniLM']) {
      expect(text).not.toContain(forbidden);
    }
  });
});
