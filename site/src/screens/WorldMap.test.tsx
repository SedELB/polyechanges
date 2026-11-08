import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { University } from '../../../shared/types';
import { fixtureData } from '../test/fixtures';
import { expectNoForbiddenWords } from '../test/forbiddenWords';
import { COUNTRY_ISO_NUMERIC, COUNTRY_NAMES_FR, WorldMap } from './WorldMap';

const onSelect = vi.fn();

beforeEach(() => onSelect.mockReset());

describe('WorldMap', () => {
  it('un bouton par pays couvert, avec le nombre d’universités', () => {
    render(<WorldMap universities={fixtureData.universities} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Taïwan, 3 universités' }));
    expect(onSelect).toHaveBeenCalledWith('TW');
    expect(screen.getByRole('button', { name: 'Japon, 1 université' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('cliquer sur le pays dans la carte le choisit aussi', () => {
    const { container } = render(<WorldMap universities={fixtureData.universities} onSelect={onSelect} />);
    fireEvent.click(container.querySelector('[data-country="JP"]')!);
    expect(onSelect).toHaveBeenCalledWith('JP');
  });

  it('un pays non couvert n’est pas cliquable', () => {
    const { container } = render(<WorldMap universities={fixtureData.universities} onSelect={onSelect} />);
    expect(container.querySelector('[data-country="FR"]')).toBeNull();
    expect(container.querySelectorAll('[data-country]')).toHaveLength(4);
    expect(container.querySelector('[data-soon] title')?.textContent).toMatch(/bientôt/);
  });

  it('trouve les quatre pays dans la carte, chemins masqués aux lecteurs d’écran', () => {
    const { container } = render(<WorldMap universities={fixtureData.universities} onSelect={onSelect} />);
    expect(Object.keys(COUNTRY_ISO_NUMERIC)).toHaveLength(4);
    expect(COUNTRY_NAMES_FR.TW).toBe('Taïwan');
    for (const code of ['CN', 'JP', 'KR', 'TW']) {
      const path = container.querySelector(`[data-country="${code}"]`)!;
      expect(path.getAttribute('d')).toMatch(/^M/);
      expect(path.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('dessine un point par université aux coordonnées plausibles et ignore les autres', () => {
    const bad: University = { ...fixtureData.universities[0]!, id: 'bad', lat: 0, lng: 0 };
    const nan: University = { ...fixtureData.universities[0]!, id: 'nan', lat: Number.NaN, lng: 10 };
    const { container } = render(<WorldMap universities={[...fixtureData.universities, bad, nan]} onSelect={onSelect} />);
    expect(container.querySelectorAll('[data-university]')).toHaveLength(fixtureData.universities.length);
    expect(container.querySelector('[data-university="bad"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Taïwan, 5 universités' })).toBeInTheDocument();
  });

  it('Taïwan, trop petit pour le doigt, a une zone de toucher invisible plus grande', () => {
    const { container } = render(<WorldMap universities={fixtureData.universities} onSelect={onSelect} />);
    const hit = container.querySelector('[data-hit="TW"]')!;
    expect(Number(hit.getAttribute('r'))).toBeGreaterThanOrEqual(12);
    expect(container.querySelector('[data-hit="CN"]')).toBeNull();
    fireEvent.click(hit);
    expect(onSelect).toHaveBeenCalledWith('TW');
    expect(container.querySelectorAll('[data-country]')).toHaveLength(4);
    expect(screen.getByText('Touche un pays en couleur sur la carte, ou choisis-le ci-dessous.')).toBeInTheDocument();
  });

  it('retire la mise en évidence quand le pointeur part ou que le toucher se termine', () => {
    const { container } = render(<WorldMap universities={fixtureData.universities} onSelect={onSelect} />);
    const jp = container.querySelector('[data-country="JP"]')!;
    fireEvent.mouseEnter(jp);
    fireEvent.mouseLeave(jp);
    expect(jp).not.toHaveAttribute('data-active');
    fireEvent.mouseEnter(jp);
    fireEvent.touchEnd(jp);
    expect(jp).not.toHaveAttribute('data-active');
  });

  it('indique le pays survolé ou ciblé au clavier, sans mot interdit', () => {
    const { container } = render(<WorldMap universities={fixtureData.universities} onSelect={onSelect} />);
    fireEvent.focus(screen.getByRole('button', { name: 'Japon, 1 université' }));
    expect(container.querySelector('[data-country="JP"]')).toHaveAttribute('data-active', 'true');
    fireEvent.mouseEnter(container.querySelector('[data-country="TW"]')!);
    expect(container.querySelector('[data-country="TW"]')).toHaveAttribute('data-active', 'true');
    expectNoForbiddenWords(container);
  });
});
