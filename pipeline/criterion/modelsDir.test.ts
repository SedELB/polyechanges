import { describe, expect, it } from 'vitest';
import { modelsDir } from './modelsDir.js';

describe('modelsDir', () => {
  it('vaut data/models sans POLYECHANGES_MODELS_DIR', () => {
    expect(modelsDir({})).toBe('data/models');
  });
  it('suit POLYECHANGES_MODELS_DIR quand elle est posée', () => {
    expect(modelsDir({ POLYECHANGES_MODELS_DIR: 'C:\\Users\\x\\AppData\\Local\\polyechanges\\models' })).toBe(
      'C:\\Users\\x\\AppData\\Local\\polyechanges\\models',
    );
  });
  it('ignore une valeur vide', () => {
    expect(modelsDir({ POLYECHANGES_MODELS_DIR: '  ' })).toBe('data/models');
  });
});
