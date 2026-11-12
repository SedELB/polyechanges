import { describe, expect, it } from 'vitest';
import { formatReport, type ReportInput } from './report.js';

const input = (agreement: number): ReportInput => ({
  sampleSize: 60,
  seed: 42,
  judged: { elevee: 5, moyenne: 10, faible: 15, pas_equivalent: 30 },
  candidates: [
    {
      version: 'contest-minilm', modelId: 'Xenova/all-MiniLM-L6-v2', revision: '751bff37182d3f1213fa05d7196b954e230abad9', sizeMillions: 23,
      run: { modelKey: 'k', pairs: 62280, loadSeconds: 2.5, compareSeconds: 61.2, embeddedTexts: 13781, diskBytes: 90_400_000 },
      result: { detectThreshold: 0.5, bandHigh: 0.7, bandLow: 0.4, agreement: 0.7 },
    },
    {
      version: 'contest-bge-base', modelId: 'Xenova/bge-base-en-v1.5', revision: '4d6cd88e18e51a5e020c2c305726d76ada9c03cf', sizeMillions: 109,
      run: null,
      result: { detectThreshold: 0.65, bandHigh: 0.75, bandLow: 0.35, agreement },
    },
  ],
  winner: 'contest-bge-base',
  disagreements: [{ pairId: 'INF3710:12', label: 'INF3710 / ntu-tw CSIE3010 Database Systems', computed: 'moyenne', judged: 'faible', reason: 'Charge trop légère.' }],
  excluded: [{ model: 'org/modele', reason: 'pas de poids ONNX' }],
  v0Levels: { total: 62280, byLevel: { aucun: 62055, faible: 165, moyenne: 55, elevee: 5 } },
});

describe('formatReport', () => {
  it('donne le tableau des candidats, le gagnant, les désaccords, les écartés et les niveaux v0', () => {
    const text = formatReport(input(0.817));
    expect(text).toContain('contest-minilm');
    expect(text).toContain('Xenova/bge-base-en-v1.5@4d6cd88');
    expect(text).toContain('61.2 s');
    expect(text).toContain('13781');
    expect(text).toContain('90 Mo');
    expect(text).toContain('Gagnant : contest-bge-base (accord 0.817 ; accord visé 0.8 : atteint)');
    expect(text).toContain('INF3710:12');
    expect(text).toContain('calculé moyenne, jugé faible');
    expect(text).toContain('org/modele : pas de poids ONNX');
    expect(text).toContain('aucun 62055');
    expect(text).toContain('ne retiendrait aucune paire obtiendrait un accord de 0.5.');
  });
  it('signale un accord sous la cible', () => {
    expect(formatReport(input(0.75))).toContain('accord visé 0.8 : non atteint');
  });
});
