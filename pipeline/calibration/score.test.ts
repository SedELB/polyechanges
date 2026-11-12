import { beforeEach, describe, expect, it } from 'vitest';
import { loadCriterion } from '../criterion/loadCriterion.js';
import { upsertCriterionVersion } from '../db/criterion.js';
import { activeHostCourses } from '../db/hostCourses.js';
import { replaceMatches } from '../db/matches.js';
import type { Db } from '../db/open.js';
import { pairIdOf } from './sample.js';
import {
  agreement,
  cohenKappa,
  computedJudgments,
  confusionMatrix,
  gridSearch,
  meetsTarget,
  pickWinner,
  trivialAgreement,
  V0_THRESHOLDS,
  type Judgment,
} from './score.js';
import { matchRow, seedContestDb } from './testDb.js';

describe('agreement', () => {
  it('calcule la part d’accord', () => {
    expect(
      agreement([
        { computed: 'elevee', judged: 'elevee' },
        { computed: 'faible', judged: 'pas_equivalent' },
        { computed: 'moyenne', judged: 'moyenne' },
      ]),
    ).toBe(0.667);
  });
  it('vaut 0 sans paire', () => expect(agreement([])).toBe(0));
});

describe('pickWinner', () => {
  it('à accord égal, le plus petit modèle gagne', () => {
    expect(
      pickWinner([
        { version: 'contest-qwen3-06b', sizeMillions: 600, agreement: 0.817 },
        { version: 'contest-bge-base', sizeMillions: 110, agreement: 0.817 },
        { version: 'contest-minilm', sizeMillions: 23, agreement: 0.783 },
      ]),
    ).toBe('contest-bge-base');
  });
  it('le meilleur accord gagne, même pour un plus gros modèle', () => {
    expect(
      pickWinner([
        { version: 'contest-minilm', sizeMillions: 23, agreement: 0.7 },
        { version: 'contest-qwen3-06b', sizeMillions: 596, agreement: 0.75 },
      ]),
    ).toBe('contest-qwen3-06b');
  });
  it('refuse une liste vide', () => expect(() => pickWinner([])).toThrow());
});

describe('gridSearch', () => {
  let db: Db;
  let id: (code: string) => number;
  beforeEach(() => {
    db = seedContestDb([]);
    const hosts = activeHostCourses(db);
    id = (code) => (hosts.find((h) => h.code === code) as { id: number }).id;
    upsertCriterionVersion(db, 'contest-a', 'h', '{}');
    replaceMatches(db, 'contest-a', [
      // trois notions sur quatre à 0.52 : retrouvées jusqu'au seuil 0.50
      matchRow('INF1001', id('A1'), [0.52, 0.52, 0.52, 0.3]),
      // une notion sur quatre : jamais assez
      matchRow('INF1001', id('A2'), [0.5, 0.2, 0.2, 0.2]),
      // deux notions sur quatre à 0.45, charge trop légère : « faible » jusqu'au seuil 0.45
      matchRow('INF1001', id('A3'), [0.45, 0.45, 0.1, 0.1], 'trop_legere'),
      // rien en commun
      matchRow('INF1001', id('A4'), [0.1, 0.1, 0.1, 0.1]),
    ]);
  });

  it('retient les seuils au meilleur accord, puis les plus proches de v0', () => {
    const judgments: Record<string, Judgment> = {
      [pairIdOf('INF1001', id('A1'))]: 'elevee',
      [pairIdOf('INF1001', id('A2'))]: 'pas_equivalent',
      [pairIdOf('INF1001', id('A3'))]: 'faible',
    };
    expect(gridSearch(db, 'contest-a', judgments)).toEqual({ detectThreshold: 0.45, bandHigh: 0.7, bandLow: 0.4, agreement: 1 });
  });

  it('compte les paires qu’aucun seuil ne peut faire coïncider', () => {
    const judgments: Record<string, Judgment> = {
      [pairIdOf('INF1001', id('A1'))]: 'elevee',
      [pairIdOf('INF1001', id('A2'))]: 'pas_equivalent',
      [pairIdOf('INF1001', id('A3'))]: 'faible',
      [pairIdOf('INF1001', id('A4'))]: 'elevee',
    };
    expect(gridSearch(db, 'contest-a', judgments)).toEqual({ detectThreshold: 0.45, bandHigh: 0.7, bandLow: 0.4, agreement: 0.75 });
  });

  it('garde les seuils v0 quand ils font aussi bien que les autres', () => {
    expect(gridSearch(db, 'contest-a', { [pairIdOf('INF1001', id('A4'))]: 'pas_equivalent' })).toEqual({
      ...V0_THRESHOLDS,
      agreement: 1,
    });
  });

  it('refuse une paire jugée que la version n’a pas comparée', () => {
    expect(() => gridSearch(db, 'contest-a', { [pairIdOf('INF1002', id('A1'))]: 'elevee' })).toThrow(/INF1002/);
  });

  it('donne le niveau calculé de chaque paire, « pas_equivalent » pour la bande « aucun »', () => {
    const pairs = [pairIdOf('INF1001', id('A1')), pairIdOf('INF1001', id('A3')), pairIdOf('INF1001', id('A4'))];
    expect(computedJudgments(db, 'contest-a', pairs, { detectThreshold: 0.45, bandHigh: 0.7, bandLow: 0.4 })).toEqual({
      [pairs[0]]: 'elevee',
      [pairs[1]]: 'faible',
      [pairs[2]]: 'pas_equivalent',
    });
  });
});

it('les seuils de référence sont ceux de data/criterion/v0', () => {
  const { detectThreshold, bandHigh, bandLow } = loadCriterion('v0').params;
  expect(V0_THRESHOLDS).toEqual({ detectThreshold, bandHigh, bandLow });
});

describe('cohenKappa', () => {
  it('vaut 1 pour un accord parfait entre plusieurs classes', () => {
    expect(cohenKappa([{ computed: 'elevee', judged: 'elevee' }, { computed: 'faible', judged: 'faible' }])).toBe(1);
  });
  it('corrige l’accord dû au hasard (4 classes, non pondéré)', () => {
    // po = 3/4 ; calculé : faible 1/4, pas_equivalent 3/4 ; jugé : faible 2/4, pas_equivalent 2/4
    // pe = 1/4 x 2/4 + 3/4 x 2/4 = 1/2 ; kappa = (3/4 - 1/2) / (1 - 1/2) = 0.5
    const pairs: { computed: Judgment; judged: Judgment }[] = [
      { computed: 'faible', judged: 'faible' },
      { computed: 'pas_equivalent', judged: 'faible' },
      { computed: 'pas_equivalent', judged: 'pas_equivalent' },
      { computed: 'pas_equivalent', judged: 'pas_equivalent' },
    ];
    expect(cohenKappa(pairs)).toBe(0.5);
  });
  it('vaut 0 pour un critère qui répond toujours pareil', () => {
    expect(cohenKappa([{ computed: 'pas_equivalent', judged: 'pas_equivalent' }, { computed: 'pas_equivalent', judged: 'faible' }])).toBe(0);
  });
});

describe('confusionMatrix', () => {
  it('compte les paires par jugement (lignes) et par niveau calculé (colonnes)', () => {
    const m = confusionMatrix([
      { computed: 'faible', judged: 'moyenne' },
      { computed: 'faible', judged: 'moyenne' },
      { computed: 'elevee', judged: 'elevee' },
    ]);
    expect(m.moyenne.faible).toBe(2);
    expect(m.elevee.elevee).toBe(1);
    expect(m.pas_equivalent.pas_equivalent).toBe(0);
  });
});

describe('trivialAgreement et meetsTarget', () => {
  it('le critère trivial répond « pas_equivalent » partout', () => {
    expect(trivialAgreement(['pas_equivalent', 'faible', 'pas_equivalent'])).toBe(0.667);
  });
  it('exige 0.80 et au moins 0.15 de plus que le critère trivial', () => {
    expect(meetsTarget(0.858, 0.708)).toBe(true);
    expect(meetsTarget(0.85, 0.708)).toBe(false);
    expect(meetsTarget(0.81, 0.6)).toBe(true);
    expect(meetsTarget(0.79, 0.5)).toBe(false);
  });
});
