import { beforeEach, describe, expect, it } from 'vitest';
import { addChoice, loadChoices, loadManual, MANUAL_STORAGE_KEY, saveChoices, saveManual, STORAGE_KEY } from './choices';

beforeEach(() => localStorage.clear());

describe('choix', () => {
  it('refuse un 4e choix', () => expect(addChoice(['a', 'b', 'c'], 'd')).toEqual({ ids: ['a', 'b', 'c'], error: 'max' }));
  it('ajoute un choix, sans doublon', () => {
    expect(addChoice(['a'], 'b')).toEqual({ ids: ['a', 'b'], error: null });
    expect(addChoice(['a'], 'a')).toEqual({ ids: ['a'], error: null });
  });
  it('marche sans stockage du navigateur', () => {
    const broken = { getItem() { throw new Error('bloqué'); }, setItem() { throw new Error('bloqué'); } } as unknown as Storage;
    expect(loadChoices(broken)).toEqual([]);
    expect(() => saveChoices(['ntu-tw'], broken)).not.toThrow();
  });
  it('enregistre et relit', () => {
    saveChoices(['ntu-tw', 'nycu-tw'], localStorage);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('["ntu-tw","nycu-tw"]');
    expect(loadChoices(localStorage)).toEqual(['ntu-tw', 'nycu-tw']);
  });
  it('ignore un contenu invalide et borne à 3', () => {
    localStorage.setItem(STORAGE_KEY, '{oups');
    expect(loadChoices(localStorage)).toEqual([]);
    localStorage.setItem(STORAGE_KEY, '[1,"a"]');
    expect(loadChoices(localStorage)).toEqual([]);
    localStorage.setItem(STORAGE_KEY, '["a","b","c","d"]');
    expect(loadChoices(localStorage)).toEqual(['a', 'b', 'c']);
  });
});

describe('cours ajoutés à la main', () => {
  const entry = { kind: 'hors_genie' as const, hostCode: 'CHN101', hostTitle: 'Mandarin', hostCredits: null, polyCredits: 2 };
  it('enregistre et relit', () => {
    saveManual({ 'ntu-tw': [entry] }, localStorage);
    expect(localStorage.getItem(MANUAL_STORAGE_KEY)).toContain('CHN101');
    expect(loadManual(localStorage)).toEqual({ 'ntu-tw': [entry] });
  });
  it('écarte le contenu invalide', () => {
    localStorage.setItem(MANUAL_STORAGE_KEY, '{oups');
    expect(loadManual(localStorage)).toEqual({});
    localStorage.setItem(MANUAL_STORAGE_KEY, '[1]');
    expect(loadManual(localStorage)).toEqual({});
    const bad = [
      { ...entry, kind: 'autre' },
      { ...entry, hostCode: ' ' },
      { ...entry, hostCredits: -1 },
      { ...entry, hostCredits: 'x' },
      { ...entry, polyCredits: 0 },
      { ...entry, polyCredits: 10 },
      { ...entry, polyCredits: 2.5 },
      null,
    ];
    localStorage.setItem(MANUAL_STORAGE_KEY, JSON.stringify({ 'ntu-tw': [...bad, entry], 'nycu-tw': bad, x: 3 }));
    expect(loadManual(localStorage)).toEqual({ 'ntu-tw': [entry] });
  });
  it('marche sans stockage du navigateur', () => {
    const broken = { getItem() { throw new Error('bloqué'); }, setItem() { throw new Error('bloqué'); } } as unknown as Storage;
    expect(loadManual(broken)).toEqual({});
    expect(() => saveManual({ 'ntu-tw': [entry] }, broken)).not.toThrow();
  });
});
