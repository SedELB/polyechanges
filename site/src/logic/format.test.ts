import { describe, expect, it } from 'vitest';
import { formatHigh, formatLow, formatNumber } from './format';

describe('format', () => {
  it('arrondit la borne haute vers le bas', () => expect(formatHigh(74.75)).toBe('74,7'));
  it('arrondit la borne basse vers le haut', () => expect(formatLow(55.25)).toBe('55,3'));
  it('garde une borne déjà au dixième', () => {
    expect(formatLow(5.1)).toBe('5,1');
    expect(formatHigh(6.9)).toBe('6,9');
  });
  it('formate un nombre avec la virgule', () => expect(formatNumber(54.04)).toBe('54'));
});
