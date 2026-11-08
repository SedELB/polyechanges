import { describe, expect, it } from 'vitest';
import type { ContentBand, Workload } from '../../shared/types.js';
import { contentBand, contentScore, levelFor } from './levels.js';

describe('levelFor', () => {
  it.each([
    ['tres', 'conforme', 'elevee'],
    ['tres', 'trop_legere', 'moyenne'],
    ['tres', 'inconnue', 'moyenne'],
    ['partiel', 'conforme', 'moyenne'],
    ['partiel', 'trop_lourde', 'faible'],
    ['aucun', 'conforme', null],
  ] as [ContentBand, Workload, string | null][])('%s + %s → %s', (band, w, lvl) => {
    expect(levelFor(band, w)).toBe(lvl);
  });
});

describe('contentScore et contentBand', () => {
  it('7 notions sur 9 donnent 0.778', () => expect(contentScore(7, 9)).toBe(0.778));
  it('0 notion sur 0 donne 0', () => expect(contentScore(0, 0)).toBe(0));
  it('bornes incluses', () => {
    expect(contentBand(0.7, 0.7, 0.3)).toBe('tres');
    expect(contentBand(0.699, 0.7, 0.3)).toBe('partiel');
    expect(contentBand(0.3, 0.7, 0.3)).toBe('partiel');
    expect(contentBand(0.299, 0.7, 0.3)).toBe('aucun');
  });
});
