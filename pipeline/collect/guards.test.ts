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
