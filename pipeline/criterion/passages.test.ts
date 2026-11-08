import { describe, expect, it } from 'vitest';
import { splitPassages } from './passages.js';

describe('splitPassages', () => {
  it('découpe en passages, y compris la ponctuation chinoise et japonaise', () => {
    expect(
      splitPassages({
        title: 'Database Systems',
        outline: null,
        description: 'Topics include: relational model, SQL, normalization, indexing. Transactions are covered。並行制御',
      }),
    ).toEqual([
      'Database Systems',
      'Topics include',
      'relational model, SQL, normalization, indexing',
      'relational model',
      'SQL',
      'normalization',
      'indexing',
      'Transactions are covered',
      '並行制御',
    ]);
  });
});
