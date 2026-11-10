import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fixtureData } from '../test/fixtures';
import type { PairResult } from '../logic/rank';
import { PairDetail } from './PairDetail';

const MESSAGE = 'Description non publiée par l’université : seul le titre a été comparé.';

function renderWith(description: string, textUsed: 'description' | 'titre') {
  const match = fixtureData.matches[0];
  const course = { ...fixtureData.hostCourses.find((c) => c.id === match.hostCourseId)!, description };
  const pair: PairResult = {
    polySigle: match.polySigle,
    best: { course, match: { ...match, textUsed }, termUnknown: false },
    alternatives: [],
  };
  const poly = fixtureData.polyCourses.find((p) => p.sigle === match.polySigle)!;
  const university = fixtureData.universities.find((u) => u.id === course.universityId)!;
  render(<PairDetail pair={pair} poly={poly} university={university} data={fixtureData} />);
  return course;
}

describe('PairDetail, description du cours d’accueil', () => {
  it('annonce que seul le titre a été comparé quand la description est vide', () => {
    renderWith('', 'titre');
    expect(screen.getByText(MESSAGE)).toBeInTheDocument();
  });
  it('affiche la description quand elle existe', () => {
    const course = renderWith('Relational model and SQL queries.', 'description');
    expect(screen.getByText(course.description)).toBeInTheDocument();
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });
});
