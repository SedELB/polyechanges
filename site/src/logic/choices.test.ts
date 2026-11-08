import { beforeEach, describe, expect, it } from 'vitest';
import { addChoice, loadChoices, saveChoices, STORAGE_KEY } from './choices';

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
