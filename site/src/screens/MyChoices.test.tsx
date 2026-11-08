import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureData } from '../test/fixtures';
import { expectNoForbiddenWords } from '../test/forbiddenWords';
import { MyChoices } from './MyChoices';

const onRemove = vi.fn();
const onBack = vi.fn();

function renderChoices(ids: string[]) {
  return render(
    <MyChoices data={fixtureData} ids={ids} term="automne" selectedSigles={['INF3710', 'LOG3430']} onRemove={onRemove} onBack={onBack} />,
  );
}

beforeEach(() => {
  onRemove.mockReset();
  onBack.mockReset();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  window.print = vi.fn();
});

describe('MyChoices', () => {
  it('sans choix, invite à revenir aux résultats', () => {
    renderChoices([]);
    expect(screen.getByText('Tu n’as encore gardé aucune université.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voir les résultats' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('montre une ébauche par université gardée, avec lien source et rappel', () => {
    renderChoices(['ntu-tw']);
    expect(screen.getByRole('heading', { name: 'Mes choix' })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: /National Taiwan University/ });
    expect(within(table).getByText('CSIE3010')).toBeInTheDocument();
    expect(within(table).getByText('INF3710')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: /CSIE3010/ })).toHaveAttribute('href', expect.stringContaining('ntu.example/catalog/CSIE3010'));
    expect(
      screen.getByText('Ébauche à recopier dans le formulaire officiel de contrat d’études ; seule la personne coordonnatrice des échanges du département décide.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Moins de 12 crédits Poly : temps plein non atteint/)).toBeInTheDocument();
    expect(screen.getByText(/Attendu :/)).toBeInTheDocument();
    expectNoForbiddenWords(document.body);
  });

  it('retire un choix', () => {
    renderChoices(['ntu-tw']);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer National Taiwan University' }));
    expect(onRemove).toHaveBeenCalledWith('ntu-tw');
  });

  it('copie le tableau en texte tabulé', () => {
    renderChoices(['ntu-tw']);
    fireEvent.click(screen.getByRole('button', { name: 'Copier le tableau' }));
    const text = vi.mocked(navigator.clipboard.writeText).mock.calls[0]![0];
    const row = text.split('\n')[1]!.split('\t');
    expect(row).toContain('CSIE3010');
    expect(row).toContain('INF3710');
  });

  it('imprime', () => {
    renderChoices(['ntu-tw']);
    fireEvent.click(screen.getByRole('button', { name: 'Imprimer' }));
    expect(window.print).toHaveBeenCalled();
  });

  it('ajoute un cours à la main et avertit', () => {
    renderChoices(['ntu-tw']);
    fireEvent.change(screen.getByLabelText('Code du cours d’accueil'), { target: { value: 'CHN101' } });
    fireEvent.change(screen.getByLabelText('Titre du cours d’accueil'), { target: { value: 'Mandarin' } });
    fireEvent.change(screen.getByLabelText('Crédits Poly'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Type de cours'), { target: { value: 'hors_genie' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter ce cours' }));
    expect(screen.getByText('SSH5002')).toBeInTheDocument();
    expect(screen.getByText(/ne sont pas inclus dans la vérification de charge/)).toBeInTheDocument();
  });
});
