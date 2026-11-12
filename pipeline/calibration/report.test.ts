import { describe, expect, it } from 'vitest';
import { formatReport, type ReportInput } from './report.js';
import { confusionMatrix } from './score.js';

const input = (agreement: number): ReportInput => ({
  samples: [
    {
      label: 'échantillon 1', file: 'data/calibration/sample.json', judgmentsFile: 'data/calibration/judgments.json', seed: 42,
      draw: 'meilleurs candidats et hasard', size: 60, judged: { elevee: 0, moyenne: 1, faible: 12, pas_equivalent: 47 }, trivial: 0.783,
    },
    {
      label: 'échantillon 2', file: 'data/calibration/sample-2.json', judgmentsFile: 'data/calibration/judgments-2.json', seed: 43,
      draw: 'consensus', size: 60, judged: { elevee: 3, moyenne: 5, faible: 14, pas_equivalent: 38 }, trivial: 0.633,
    },
  ],
  trivial: 0.708,
  grids: 'Grilles de notions : celles de v0 corrigées une fois (2 notions dans 1 cours : LOG3420).',
  candidates: [
    {
      version: 'contest-minilm', modelId: 'Xenova/all-MiniLM-L6-v2', revision: '751bff37182d3f1213fa05d7196b954e230abad9', sizeMillions: 23,
      run: { modelKey: 'k', pairs: 62280, loadSeconds: 2.5, compareSeconds: 61.2, embeddedTexts: 13781, diskBytes: 90_400_000 },
      result: { detectThreshold: 0.5, bandHigh: 0.7, bandLow: 0.4, agreement: 0.7 },
      bySample: [0.75, 0.65],
      kappa: 0.21,
    },
    {
      version: 'contest-bge-base', modelId: 'Xenova/bge-base-en-v1.5', revision: '4d6cd88e18e51a5e020c2c305726d76ada9c03cf', sizeMillions: 109,
      run: null,
      result: { detectThreshold: 0.65, bandHigh: 0.75, bandLow: 0.35, agreement },
      bySample: [0.9, 0.8],
      kappa: 0.55,
    },
  ],
  winner: 'contest-bge-base',
  confusion: confusionMatrix([
    { computed: 'faible', judged: 'moyenne' },
    { computed: 'pas_equivalent', judged: 'pas_equivalent' },
  ]),
  disagreements: [
    { pairId: 'INF3710:12', sample: 'échantillon 2', label: 'INF3710 / NTU CSIE3010 Database Systems', computed: 'moyenne', judged: 'faible', reason: 'Charge trop légère.' },
  ],
  excluded: [{ model: 'org/modele', reason: 'pas de poids ONNX' }],
  v0Levels: { total: 62280, byLevel: { aucun: 62055, faible: 165, moyenne: 55, elevee: 5 } },
});

describe('formatReport', () => {
  it('donne les échantillons, le tableau des candidats, le gagnant, la matrice, les désaccords, les écartés et v0', () => {
    const text = formatReport(input(0.875));
    expect(text).toContain('data/calibration/sample-2.json');
    expect(text).toContain('critère trivial 0.633');
    expect(text).toContain('Ensemble : 120 paires ; critère trivial (tout « pas_equivalent ») 0.708');
    expect(text).toContain('Xenova/bge-base-en-v1.5@4d6cd88');
    expect(text).toContain('61.2 s');
    expect(text).toContain('13781');
    expect(text).toContain('90 Mo');
    expect(text).toContain('0.550');
    expect(text).toContain('Gagnant : contest-bge-base (accord 0.875 sur 120 paires ; cible 0.858 : atteinte)');
    expect(text).toMatch(/moyenne\s+0\s+0\s+1\s+0/);
    expect(text).toContain('INF3710:12');
    expect(text).toContain('[échantillon 2]');
    expect(text).toContain('calculé moyenne, jugé faible');
    expect(text).toContain('org/modele : pas de poids ONNX');
    expect(text).toContain('aucun 62055');
    expect(text).toContain('2 notions dans 1 cours : LOG3420');
  });
  it('signale un accord sous la cible', () => {
    expect(formatReport(input(0.85))).toContain('cible 0.858 : non atteinte');
  });
});

describe('formatReport, choix des étudiants', () => {
  it('ajoute la matrice et les désaccords du candidat choisi, avec ses seuils', () => {
    const text = formatReport({
      ...input(0.875),
      chosen: {
        version: 'contest-minilm',
        reason: 'presque le même accord, bien plus léger',
        confusion: confusionMatrix([{ computed: 'elevee', judged: 'faible' }]),
        disagreements: [
          { pairId: 'LOG3430:9', sample: 'échantillon 1', label: 'LOG3430 / X T1 Testing', computed: 'elevee', judged: 'faible', reason: null },
        ],
      },
    });
    expect(text).toContain('Choix des étudiants : contest-minilm (accord 0.7 ; seuils 0.50 / 0.70 / 0.40) : presque le même accord, bien plus léger');
    expect(text).toContain('Matrice de confusion de contest-minilm');
    expect(text).toMatch(/faible\s+1\s+0\s+0\s+0/);
    expect(text).toContain('Paires en désaccord pour contest-minilm (1)');
    expect(text).toContain('LOG3430:9');
  });
});
