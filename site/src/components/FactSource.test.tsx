import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Provenance } from '../../../shared/types';
import { FactSource } from './FactSource';

const base: Provenance = {
  url: 'https://example.org/cal',
  retrievedAt: '2026-11-10',
  sha256: 'a'.repeat(64),
  locator: { page: 1, line: 12 },
  quote: '12-14 (Mon) Final exams end',
};

describe('FactSource', () => {
  it('affiche l’extrait de contexte sous l’extrait principal', () => {
    const p: Provenance = { ...base, context: { locator: { page: 1, line: 3 }, quote: '2026 Academic Calendar' } };
    render(<FactSource label="fin des examens" provenance={p} />);
    expect(screen.getByText('« 12-14 (Mon) Final exams end »')).toBeInTheDocument();
    expect(screen.getByText('Contexte : « 2026 Academic Calendar » (ligne 3)')).toBeInTheDocument();
  });
  it('sans contexte, n’affiche aucune ligne de contexte', () => {
    render(<FactSource label="fin des examens" provenance={base} />);
    expect(screen.queryByText(/Contexte/)).toBeNull();
  });
});
