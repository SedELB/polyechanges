import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureData } from '../test/fixtures';
import { expectNoForbiddenWords } from '../test/forbiddenWords';
import { MyChoices } from './MyChoices';

const onRemove = vi.fn();
const onBack = vi.fn();

function renderChoices(ids: string[], data = fixtureData) {
  return render(
    <MyChoices data={data} ids={ids} term="automne" selectedSigles={['INF3710', 'LOG3430']} onRemove={onRemove} onBack={onBack} />,
  );
}

beforeEach(() => {
  localStorage.clear();
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

  it('la carte montre les restrictions publiées, avec leur source', () => {
    const text = 'Graduate courses are restricted to graduate students.';
    const data = {
      ...fixtureData,
      universities: fixtureData.universities.map((u) =>
        u.id === 'ntu-tw' ? { ...u, restrictions: text, provenance: { ...u.provenance, restrictions: { ...u.provenance.name!, quote: text } } } : u,
      ),
    };
    renderChoices(['ntu-tw'], data);
    const card = screen.getByRole('article', { name: 'National Taiwan University' });
    expect(within(card).getByText('Restrictions pour les étudiants d’échange')).toBeInTheDocument();
    expect(within(card).getByText(`: ${text}`)).toBeInTheDocument();
    expect(within(card).getByRole('group', { name: 'Source : restrictions' })).toBeInTheDocument();
  });

  it('sans restriction publiée, la carte n’en montre aucune', () => {
    renderChoices(['ntu-tw']);
    expect(screen.queryByText('Restrictions pour les étudiants d’échange')).toBeNull();
  });

  it('chaque cours d’accueil de l’ébauche montre son cycle d’études, aussi dans la copie', () => {
    renderChoices(['ntu-tw']);
    const table = screen.getByRole('table', { name: /National Taiwan University/ });
    const rowOf = (code: string) => within(table).getByRole('link', { name: code }).closest('tr')!;
    expect(within(rowOf('CSIE3010')).getByText(/1er cycle/)).toBeInTheDocument();
    expect(within(rowOf('CSIE3020')).getByText(/Cycles supérieurs/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copier le tableau' }));
    const lines = vi.mocked(navigator.clipboard.writeText).mock.calls[0]![0].split('\n');
    expect(lines.find((l) => l.startsWith('CSIE3020'))!.split('\t')).toContain('Cycles supérieurs');
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

  it('un cours d’orientation ajouté à la main porte le code ING500x', () => {
    renderChoices(['ntu-tw']);
    expect(screen.getByRole('option', { name: 'Cours d’orientation personnalisée (ING500x)' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Code du cours d’accueil'), { target: { value: 'CSIE5001' } });
    fireEvent.change(screen.getByLabelText('Titre du cours d’accueil'), { target: { value: 'Robotics' } });
    fireEvent.change(screen.getByLabelText('Crédits Poly'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter ce cours' }));
    expect(screen.getByText('ING5003')).toBeInTheDocument();
    expect(screen.queryByText(/LOG500/)).toBeNull();
  });

  function addManual(code: string) {
    fireEvent.change(screen.getByLabelText('Code du cours d’accueil'), { target: { value: code } });
    fireEvent.change(screen.getByLabelText('Titre du cours d’accueil'), { target: { value: 'Titre ' + code } });
    fireEvent.change(screen.getByLabelText('Crédits Poly'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter ce cours' }));
  }

  it('garde les cours ajoutés à la main après rechargement, et retire le bon', () => {
    const first = renderChoices(['ntu-tw']);
    addManual('AAA1');
    addManual('BBB2');
    expect(localStorage.getItem('polyechanges.manuel.v1')).toContain('BBB2');
    first.unmount();
    renderChoices(['ntu-tw']);
    expect(screen.getByText('AAA1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer AAA1' }));
    expect(screen.queryByText('AAA1')).toBeNull();
    expect(screen.getByText('BBB2')).toBeInTheDocument();
  });

  it('oublie les ajouts des universités qui ne sont plus gardées', () => {
    localStorage.setItem(
      'polyechanges.manuel.v1',
      JSON.stringify({ 'nycu-tw': [{ kind: 'orientation', hostCode: 'Z9', hostTitle: 'Z', hostCredits: null, polyCredits: 3 }] }),
    );
    renderChoices(['ntu-tw']);
    expect(localStorage.getItem('polyechanges.manuel.v1')).toBe('{}');
  });

  it('copie avec un champ temporaire quand le presse-papiers est absent', () => {
    Object.assign(navigator, { clipboard: undefined });
    document.execCommand = vi.fn().mockReturnValue(true);
    renderChoices(['ntu-tw']);
    fireEvent.click(screen.getByRole('button', { name: 'Copier le tableau' }));
    return screen.findByText('Tableau copié.').then(() => {
      expect(document.execCommand).toHaveBeenCalledWith('copy');
      expect(document.querySelector('textarea[readonly]')).toBeNull();
    });
  });

  it('signale la copie impossible si les deux méthodes échouent', async () => {
    Object.assign(navigator, { clipboard: undefined });
    document.execCommand = vi.fn().mockReturnValue(false);
    renderChoices(['ntu-tw']);
    fireEvent.click(screen.getByRole('button', { name: 'Copier le tableau' }));
    expect(await screen.findByText(/Copie impossible/)).toBeInTheDocument();
  });
});
