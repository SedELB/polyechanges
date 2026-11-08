import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { fixtureData } from './test/fixtures';
import { expectNoForbiddenWords } from './test/forbiddenWords';

describe('App', () => {
  it('affiche le bandeau et la première question', async () => {
    render(<App load={async () => fixtureData} />);
    expect(await screen.findByText('Où voulez-vous aller ?')).toBeInTheDocument();
    expect(screen.getByText(/Projet étudiant non officiel/)).toBeInTheDocument();
    expect(screen.getByText(/critère v0/)).toBeInTheDocument();
    expect(screen.getByText(/Données du 10 novembre 2026/)).toBeInTheDocument();
    expectNoForbiddenWords(document.body);
  });

  it('affiche une erreur claire si les données ne chargent pas', async () => {
    render(<App load={async () => { throw new Error('404'); }} />);
    expect(await screen.findByText('Impossible de charger les données. Recharge la page.')).toBeInTheDocument();
    expect(screen.getByText(/Projet étudiant non officiel/)).toBeInTheDocument();
  });

  it('choisir un pays dans la carte quitte le premier écran', async () => {
    render(<App load={async () => fixtureData} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Taïwan, 3 universités' }));
    expect(screen.queryByText('Où voulez-vous aller ?')).toBeNull();
    expect(screen.getByText(/Projet étudiant non officiel/)).toBeInTheDocument();
  });

  it('de la carte aux cours : choisir des cours active le bouton, et on peut revenir', async () => {
    render(<App load={async () => fixtureData} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Taïwan, 3 universités' }));
    expect(screen.getByRole('heading', { name: 'Quels cours veux-tu faire là-bas ?' })).toBeInTheDocument();
    const next = screen.getByRole('button', { name: 'Voir les universités' });
    expect(next).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /INF3710/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /LOG3430/ }));
    expect(screen.getByText('6 crédits Poly')).toBeInTheDocument();
    expect(next).toBeEnabled();
    expectNoForbiddenWords(document.body);

    fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
    expect(screen.getByText('Où voulez-vous aller ?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Taïwan, 3 universités' }));
    expect(screen.getByText('6 crédits Poly')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Voir les universités' }));
    expect(screen.queryByRole('heading', { name: 'Quels cours veux-tu faire là-bas ?' })).toBeNull();
  });
});
