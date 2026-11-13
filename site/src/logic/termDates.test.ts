import { describe, expect, it } from 'vitest';
import { outdatedYears } from './termDates';

describe('outdatedYears', () => {
  it('date de début d’une année antérieure au départ : à confirmer', () => {
    expect(outdatedYears({ start: '2026-09-07', end: '2027-01-08', examsEnd: null }, 'automne', 2027)).toBe('2026-2027');
    expect(outdatedYears({ start: '2027-02-22', end: null, examsEnd: null }, 'hiver', 2028)).toBe('2026-2027');
  });

  it('dates de l’année du départ : rien à signaler', () => {
    expect(outdatedYears({ start: '2027-09-06', end: null, examsEnd: null }, 'automne', 2027)).toBeNull();
  });

  it('sans début publié, la fin d’hiver de l’an dernier est signalée', () => {
    expect(outdatedYears({ start: null, end: '2026-06-11', examsEnd: null }, 'hiver', 2028)).toBe('2025-2026');
    expect(outdatedYears({ start: null, end: null, examsEnd: '2026-06-25' }, 'hiver', 2028)).toBe('2025-2026');
  });

  it('sans début publié, une fin d’automne en janvier compte pour l’année commencée avant', () => {
    expect(outdatedYears({ start: null, end: '2027-01-08', examsEnd: null }, 'automne', 2027)).toBe('2026-2027');
    expect(outdatedYears({ start: null, end: '2027-12-20', examsEnd: null }, 'automne', 2027)).toBeNull();
  });

  it('aucune date publiée : rien à signaler', () => {
    expect(outdatedYears({ start: null, end: null, examsEnd: null }, 'automne', 2027)).toBeNull();
  });
});
