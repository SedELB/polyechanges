import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fixtureData } from '../test/fixtures';
import type { PairResult } from '../logic/rank';
import { PairDetail } from './PairDetail';

const MESSAGE = 'Description non publiée par l’université : seul le titre a été comparé.';

function renderWith(description: string, textUsed: 'description' | 'titre', descriptionsDated?: string) {
  const match = fixtureData.matches[0];
  const course = {
    ...fixtureData.hostCourses.find((c) => c.id === match.hostCourseId)!,
    description,
    ...(descriptionsDated === undefined ? {} : { descriptionsDated }),
  };
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
  it('indique l’année du catalogue quand la description est datée', () => {
    renderWith('Relational model and SQL queries.', 'description', '2020');
    expect(screen.getByText('Description tirée du catalogue 2020')).toBeInTheDocument();
  });
  it('n’indique aucun catalogue quand la description n’est pas datée', () => {
    renderWith('Relational model and SQL queries.', 'description');
    expect(screen.queryByText(/Description tirée du catalogue/)).toBeNull();
  });
  it('n’indique aucun catalogue quand la description est vide', () => {
    renderWith('', 'titre', '2020');
    expect(screen.queryByText(/Description tirée du catalogue/)).toBeNull();
  });
});

describe('PairDetail, source du cours de Poly', () => {
  function renderPoly(over: Partial<(typeof fixtureData.polyCourses)[number]> = {}) {
    const match = fixtureData.matches[0];
    const course = fixtureData.hostCourses.find((c) => c.id === match.hostCourseId)!;
    const pair: PairResult = { polySigle: match.polySigle, best: { course, match, termUnknown: false }, alternatives: [] };
    const poly = { ...fixtureData.polyCourses.find((p) => p.sigle === match.polySigle)!, collectedAt: '2026-11-10T17:53:03.177Z', ...over };
    const university = fixtureData.universities.find((u) => u.id === course.universityId)!;
    render(<PairDetail pair={pair} poly={poly} university={university} data={fixtureData} />);
    return poly;
  }
  it('donne le lien de la page du programme, sa date d’enregistrement et la ligne du cours', () => {
    const poly = renderPoly();
    const link = screen.getByRole('link', { name: 'page du programme' });
    expect(link).toHaveAttribute('href', poly.pageUrl);
    expect(link.closest('p')).toHaveTextContent(
      `Source : page du programme, enregistrée le 10 novembre 2026 · ligne ${poly.sourceLocator!.line} de la copie conservée`,
    );
  });
  it('sans page connue, renvoie à la fiche du cours', () => {
    const poly = renderPoly({ pageUrl: null, sourceLocator: null });
    const link = screen.getByRole('link', { name: `${poly.sigle}, fiche du cours` });
    expect(link).toHaveAttribute('href', poly.sourceUrl);
    expect(link.closest('p')).toHaveTextContent('collecté le 10 novembre 2026');
  });
});

describe('PairDetail, cycle d’études du cours d’accueil', () => {
  function renderLevel(level: 'undergrad' | 'grad') {
    const match = fixtureData.matches[0];
    const course = { ...fixtureData.hostCourses.find((c) => c.id === match.hostCourseId)!, level };
    const pair: PairResult = { polySigle: match.polySigle, best: { course, match, termUnknown: false }, alternatives: [] };
    const poly = fixtureData.polyCourses.find((p) => p.sigle === match.polySigle)!;
    const university = fixtureData.universities.find((u) => u.id === course.universityId)!;
    render(<PairDetail pair={pair} poly={poly} university={university} data={fixtureData} />);
  }
  it('un cours de cycles supérieurs l’affiche', () => {
    renderLevel('grad');
    expect(screen.getByText('Cycles supérieurs')).toBeInTheDocument();
    expect(screen.queryByText('1er cycle')).toBeNull();
  });
  it('un cours de 1er cycle l’affiche', () => {
    renderLevel('undergrad');
    expect(screen.getByText('1er cycle')).toBeInTheDocument();
    expect(screen.queryByText('Cycles supérieurs')).toBeNull();
  });
});
