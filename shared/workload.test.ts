import { describe, expect, it } from 'vitest';
import { checkWorkload, hostContactHours } from './workload.js';

describe('règle de charge', () => {
const T = 0.15;
it.each([[6, 'conforme'], [5.2, 'conforme'], [5, 'trop_legere'], [7, 'trop_lourde'], [null, 'inconnue']])
  ('ECTS %s pour 3 crédits Poly → %s', (ects, attendu) => {
    expect(checkWorkload({ system: 'ECTS', hostEcts: ects, polyCredits: 3 }, T)).toBe(attendu);
  });
it.each([[60, 'conforme'], [74.75, 'conforme'], [54, 'trop_legere'], [75, 'trop_lourde'], [null, 'inconnue']])
  ('%s h pour un triplet 3-2-4 sur 13 semaines (65 h) → %s', (h, attendu) => {
    expect(checkWorkload({ system: 'local', hostContactHours: h, polyTriplet: [3, 2, 4], polyWeeks: 13 }, T)).toBe(attendu);
  });
it('déduit les heures des crédits locaux', () => {
  expect(hostContactHours({ contactHours: null, credits: 3 }, 18)).toBe(54);
  expect(hostContactHours({ contactHours: 40, credits: 3 }, 18)).toBe(40);
  expect(hostContactHours({ contactHours: null, credits: null }, 18)).toBeNull();
});
});
