import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { University } from '../../../shared/types';
import { fixtureData } from '../test/fixtures';
import { TermToggle } from './TermToggle';

describe('TermToggle', () => {
  it('affiche « non publiée » pour une date de fin absente', () => {
    const base = fixtureData.universities.find((u) => u.terms.fall !== null)!;
    const university: University = {
      ...base,
      terms: { ...base.terms, fall: { start: '2027-09-06', end: null, examsEnd: '2027-12-24' } },
    };
    render(<TermToggle term="automne" onChange={() => {}} universities={[university]} departureYear={2027} />);
    const group = screen.getByRole('group', { name: `Dates de ${university.name}` });
    expect(within(group).getByText(/fin : non publiée/)).toBeInTheDocument();
    expect(within(group).getByText(/fin des examens : 24 décembre 2027/)).toBeInTheDocument();
  });
});
