import { describe, expect, it } from 'vitest';
import { checkGuards } from './guards.js';

const courses = (n: number, empty = 0) =>
  Array.from({ length: n }, (_, i) => ({ description: i < empty ? '  ' : 'texte' }));

describe('checkGuards', () => {
  it('échoue avec 0 cours', () => {
    expect(checkGuards([], 0)).toEqual({ ok: false, reason: 'Aucun cours lu' });
  });
  it('échoue si plus de 30 % des cours disparaissent', () => {
    expect(checkGuards(courses(69), 100).ok).toBe(false);
    expect(checkGuards(courses(70), 100).ok).toBe(true);
  });
  it('échoue si plus de 30 % des descriptions sont vides', () => {
    expect(checkGuards(courses(10, 4), 0)).toEqual({ ok: false, reason: '4 descriptions vides sur 10' });
    expect(checkGuards(courses(10, 3), 0).ok).toBe(true);
  });
  it('accepte une première collecte sans cours précédents', () => {
    expect(checkGuards(courses(5), 0)).toEqual({ ok: true });
  });
});

describe('checkGuards, source sans descriptions publiées', () => {
  it('ne contrôle pas les descriptions vides', () => {
    expect(checkGuards(courses(10, 10), 0, { descriptionsPublished: false })).toEqual({ ok: true });
  });
  it('garde les autres garde-fous', () => {
    expect(checkGuards([], 0, { descriptionsPublished: false }).ok).toBe(false);
    expect(checkGuards(courses(69, 69), 100, { descriptionsPublished: false }).ok).toBe(false);
  });
  it('contrôle toujours les descriptions par défaut', () => {
    expect(checkGuards(courses(10, 10), 0).ok).toBe(false);
  });
});

describe('checkGuards, baisse voulue', () => {
  it('sans l’option, une perte de plus de 30 % échoue et dit comment la déclarer voulue', () => {
    const res = checkGuards(courses(5), 100);
    expect(res.ok).toBe(false);
    expect(res.ok ? '' : res.reason).toMatch(/perte de plus de 30 %.*--accept-loss/);
  });
  it('avec l’option, la perte passe et le résultat le dit', () => {
    expect(checkGuards(courses(5), 100, { acceptLoss: true })).toEqual({ ok: true, lossAccepted: true });
  });
  it('l’option ne change rien sans perte', () => {
    expect(checkGuards(courses(90), 100, { acceptLoss: true })).toEqual({ ok: true });
  });
  it('l’option ne lève ni le garde-fou du zéro cours ni celui des descriptions vides', () => {
    expect(checkGuards([], 100, { acceptLoss: true }).ok).toBe(false);
    expect(checkGuards(courses(10, 10), 100, { acceptLoss: true })).toEqual({ ok: false, reason: '10 descriptions vides sur 10' });
  });
});
