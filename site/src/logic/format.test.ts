import { describe, expect, it } from 'vitest';
import { formatDay, formatHigh, formatLow, formatNumber } from './format';

describe('format', () => {
  it('arrondit la borne haute vers le bas', () => expect(formatHigh(74.75)).toBe('74,7'));
  it('arrondit la borne basse vers le haut', () => expect(formatLow(55.25)).toBe('55,3'));
  it('garde une borne déjà au dixième', () => {
    expect(formatLow(5.1)).toBe('5,1');
    expect(formatHigh(6.9)).toBe('6,9');
  });
  it('formate un nombre avec la virgule', () => expect(formatNumber(54.04)).toBe('54'));
});

describe('formatDay', () => {
  it('donne le jour à Montréal d’un horodatage UTC', () => {
    expect(formatDay('2026-11-13T02:28:59.795Z')).toBe('12 novembre 2026');
    expect(formatDay('2026-11-10T17:53:03.177Z')).toBe('10 novembre 2026');
  });
  it('garde tel quel le jour d’une date sans heure', () => {
    expect(formatDay('2026-11-02')).toBe('2 novembre 2026');
    expect(formatDay('2026-11-01')).toBe('1er novembre 2026');
  });
  it('rend tel quel un texte qui n’est pas une date', () => expect(formatDay('bientôt')).toBe('bientôt'));
});
