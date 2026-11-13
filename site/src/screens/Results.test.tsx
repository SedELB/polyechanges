import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fixtureData } from '../test/fixtures';
import { expectNoForbiddenWords } from '../test/forbiddenWords';
import { Results } from './Results';

function renderResults(over: Partial<Parameters<typeof Results>[0]> = {}) {
  const props = {
    data: fixtureData,
    countryCode: 'TW' as const,
    term: 'automne' as const,
    selectedSigles: ['INF3710', 'LOG3430'],
    departureYear: 2026,
    onTermChange: vi.fn(),
    onOtherCountry: vi.fn(),
    ...over,
  };
  return { props, ...render(<Results {...props} />) };
}

const card = (name: string) => screen.getByRole('article', { name: new RegExp(name) });

describe('Results', () => {
  it('affiche la mention de vérification et aucun mot interdit', () => {
    renderResults();
    expect(screen.getByText('Niveaux calculés automatiquement, non vérifiés par un humain')).toBeInTheDocument();
    expectNoForbiddenWords(document.body);
  });

  it('classe les universités et indique les cours couverts', () => {
    renderResults();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(within(card('National Taiwan University')).getByText('2 cours sur 2 couverts')).toBeInTheDocument();
    expect(within(card('Yang Ming')).getByText('1 cours sur 2 couvert')).toBeInTheDocument();
  });

  it('une carte sans catalogue public le dit et donne le contact', () => {
    const data = {
      ...fixtureData,
      universities: fixtureData.universities.map((u) =>
        u.id === 'ncku-tw' ? { ...u, exchangeContact: 'echange@ncku.example.tw' } : u,
      ),
    };
    renderResults({ data });
    const c = card('Cheng Kung');
    expect(within(c).getByText('Catalogue non public')).toBeInTheDocument();
    expect(within(c).getByText(/echange@ncku\.example\.tw/)).toBeInTheDocument();
  });

  it('le détail montre le lien source et la date de collecte', () => {
    renderResults();
    const c = card('National Taiwan University');
    fireEvent.click(within(c).getByRole('button', { name: /INF3710/ }));
    const link = within(c).getByRole('link', { name: /CSIE3010/ });
    expect(link).toHaveAttribute('href', 'https://www.ntu.example/catalog/CSIE3010');
    expect(within(c).getAllByText(/collecté le 2026-11-20/i).length).toBeGreaterThan(0);
    expect(within(c).getByText(/ligne 10 de la copie conservée/)).toBeInTheDocument();
    expect(within(c).getAllByText('Relational model, SQL, normalization and transactions.').length).toBeGreaterThan(0);
    expect(within(c).getByText('Normalisation')).toBeInTheDocument();
    expect(within(c).getAllByText(/langue : anglais/i).length).toBeGreaterThan(0);
    expectNoForbiddenWords(document.body);
  });

  it('la liste des paires montre le cycle d’études de chaque cours trouvé', () => {
    renderResults();
    const c = card('National Taiwan University');
    expect(within(c).getByRole('button', { name: /CSIE3010 · niveau élevée · 1er cycle/ })).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: /CSIE3020 · niveau moyenne · Cycles supérieurs/ })).toBeInTheDocument();
  });

  it('une université avec restriction l’affiche avec sa source', () => {
    const text = 'Exchange students are not allowed to enroll in graduate courses.';
    const data = {
      ...fixtureData,
      universities: fixtureData.universities.map((u) =>
        u.id === 'ntu-tw'
          ? { ...u, restrictions: text, provenance: { ...u.provenance, restrictions: { ...u.provenance.name!, quote: text, locator: { page: 1, line: 40 } } } }
          : u,
      ),
    };
    renderResults({ data });
    const c = card('National Taiwan University');
    expect(within(c).getByText('Restrictions pour les étudiants d’échange')).toBeInTheDocument();
    expect(within(c).getByText(`: ${text}`)).toBeInTheDocument();
    const src = within(c).getByRole('group', { name: 'Source : restrictions' });
    fireEvent.click(within(src).getByText('source'));
    expect(within(src).getByText(`« ${text} »`)).toBeInTheDocument();
  });

  it('sans restriction publiée, la carte n’en montre aucune', () => {
    const data = {
      ...fixtureData,
      universities: fixtureData.universities.map((u) => (u.id === 'nycu-tw' ? { ...u, restrictions: '  ' } : u)),
    };
    renderResults({ data });
    expect(screen.queryByText('Restrictions pour les étudiants d’échange')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Source : restrictions' })).toBeNull();
  });

  it('montre les notions manquantes et la charge insuffisante', () => {
    renderResults({ selectedSigles: ['INF3405'] });
    const c = card('National Taiwan University');
    fireEvent.click(within(c).getByRole('button', { name: /INF3405/ }));
    expect(within(c).getAllByText('Routage').length).toBeGreaterThan(0);
    expect(
      within(c).getByText('Charge insuffisante : il faudra peut-être combiner avec un autre cours'),
    ).toBeInTheDocument();
    expect(within(c).getByText(/Ici : 30 h/)).toBeInTheDocument();
  });

  it('détaille le calcul de charge : attendu, ici, bornes et écart', () => {
    renderResults({ selectedSigles: ['INF3405'] });
    const c = card('National Taiwan University');
    fireEvent.click(within(c).getByRole('button', { name: /INF3405/ }));
    expect(within(c).getAllByText("Attendu : 65 h de contact (3 h de cours + 2 h de labo × 13 semaines)")[0]).toBeInTheDocument();
    expect(within(c).getAllByText('Ici : 30 h (heures de contact publiées)')[0]).toBeInTheDocument();
    expect(within(c).getAllByText("Accepté : entre 55,3 h et 74,7 h (tolérance 15 %)")[0]).toBeInTheDocument();
    expect(within(c).getAllByText('Écart : −53,8 %')[0]).toBeInTheDocument();
  });

  it('signale un cours sans trimestre et une langue inconnue', () => {
    renderResults({ selectedSigles: ['LOG3430', 'INF3405'] });
    const c = card('National Taiwan University');
    fireEvent.click(within(c).getByRole('button', { name: /LOG3430/ }));
    fireEvent.click(within(c).getByRole('button', { name: /INF3405/ }));
    expect(within(c).getByText(/trimestre non publié/)).toBeInTheDocument();
    expect(within(c).getByText(/langue inconnue/)).toBeInTheDocument();
  });

  it('message clair quand rien n’est couvert', () => {
    const { props } = renderResults({ countryCode: 'JP', selectedSigles: ['INF2610'] });
    expect(screen.getByText('Aucun équivalent trouvé dans ce pays pour les cours choisis.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choisir un autre pays' }));
    expect(props.onOtherCountry).toHaveBeenCalled();
    expectNoForbiddenWords(document.body);
  });

  it('le sélecteur de départ change le trimestre', () => {
    const { props } = renderResults();
    expect(screen.getByRole('button', { name: 'automne' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'hiver' }));
    expect(props.onTermChange).toHaveBeenCalledWith('hiver');
  });

  it('la date de début du trimestre donne accès à son extrait et sa source', () => {
    renderResults();
    const group = screen.getByRole('group', { name: 'Dates de National Taiwan University' });
    expect(within(group).getByText(/14 septembre 2026/)).toBeInTheDocument();
    const src = within(group).getByRole('group', { name: 'Source : début du trimestre' });
    fireEvent.click(within(src).getByText('source'));
    expect(within(src).getByText('« Fall semester begins Sep 14 »')).toBeInTheDocument();
    expect(within(src).getByRole('link')).toHaveAttribute('href', 'https://www.ntu.example.tw/calendar');
    expect(within(src).getByText(/consulté le 2026-11-02/)).toBeInTheDocument();
  });

  it('un fait sans source affiche « source non disponible »', () => {
    const data = {
      ...fixtureData,
      universities: fixtureData.universities.map((u) => (u.id === 'tohoku-jp' ? { ...u, provenance: {} } : u)),
    };
    renderResults({ data, countryCode: 'JP', selectedSigles: ['INF2610'] });
    expect(screen.getAllByText('source non disponible').length).toBeGreaterThan(0);
  });

  it('avertit quand les dates datent d’une année antérieure au départ', () => {
    renderResults({ departureYear: 2027 });
    expect(screen.getAllByText('dates de l’année 2026-2027, à confirmer').length).toBeGreaterThan(0);
    expect(screen.queryByText(/dates de l’année 2027-2028/)).toBeNull();
  });

  it('affiche les dates du trimestre d’hiver après bascule', () => {
    renderResults({ term: 'hiver', departureYear: 2027 });
    const group = screen.getByRole('group', { name: 'Dates de National Taiwan University' });
    expect(within(group).getByText(/22 février 2027/)).toBeInTheDocument();
    expect(within(group).queryByText(/dates de l’année/)).toBeNull();
  });
});
