import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PolyCourse } from '../../../shared/types';
import { fixtureData } from '../test/fixtures';
import { expectNoForbiddenWords } from '../test/forbiddenWords';
import { CoursePicker, isOpenByDefault } from './CoursePicker';

const onChange = vi.fn();
const onNext = vi.fn();
const courses = fixtureData.polyCourses;

function renderPicker(selected: string[], list: PolyCourse[] = courses) {
  return render(<CoursePicker courses={list} selected={selected} onChange={onChange} onNext={onNext} />);
}

beforeEach(() => {
  onChange.mockReset();
  onNext.mockReset();
});

describe('CoursePicker', () => {
  it('affiche le titre', () => {
    renderPicker([]);
    expect(screen.getByRole('heading', { name: 'Quels cours veux-tu faire là-bas ?' })).toBeInTheDocument();
    expectNoForbiddenWords(document.body);
  });

  it('grise SSH3501 avec la raison', () => {
    renderPicker([]);
    expect(screen.getByRole('checkbox', { name: /SSH3501/ })).toBeDisabled();
    expect(screen.getByText('Ce cours ne peut pas être suivi en échange.')).toBeInTheDocument();
  });

  it('additionne les crédits et rappelle le minimum de 12', () => {
    const { rerender } = renderPicker(['INF3710', 'LOG3430']);
    expect(screen.getByText('6 crédits Poly')).toBeInTheDocument();
    expect(screen.getByText('Il te faut au moins 12 crédits pour être à temps plein.')).toBeInTheDocument();
    rerender(<CoursePicker courses={courses} selected={['INF3710', 'LOG3430', 'INF2610', 'INF3405']} onChange={onChange} onNext={onNext} />);
    expect(screen.getByText('12 crédits Poly')).toBeInTheDocument();
    expect(screen.queryByText(/Il te faut au moins 12 crédits/)).toBeNull();
  });

  it('désactive « Voir les universités » sans cours coché', () => {
    const { rerender } = renderPicker([]);
    expect(screen.getByRole('button', { name: 'Voir les universités' })).toBeDisabled();
    rerender(<CoursePicker courses={courses} selected={['INF3710']} onChange={onChange} onNext={onNext} />);
    fireEvent.click(screen.getByRole('button', { name: 'Voir les universités' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('cocher et décocher un cours appelle onChange', () => {
    renderPicker(['INF3710']);
    fireEvent.click(screen.getByRole('checkbox', { name: /LOG3430/ }));
    expect(onChange).toHaveBeenCalledWith(['INF3710', 'LOG3430']);
    fireEvent.click(screen.getByRole('checkbox', { name: /INF3710/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('un cours admissible non comparé reste sélectionnable avec sa mention', () => {
    renderPicker([]);
    const box = screen.getByRole('checkbox', { name: /LOG3900/ });
    expect(box).toBeEnabled();
    expect(screen.getAllByText('Pas de recherche d\'équivalent : à ajouter à la main dans l\'ébauche de contrat.')).toHaveLength(1);
  });

  it('la recherche filtre par sigle ou par mot du titre', () => {
    renderPicker([]);
    const search = screen.getByRole('searchbox', { name: 'Chercher un cours' });
    fireEvent.change(search, { target: { value: 'réseaux' } });
    expect(screen.getByRole('checkbox', { name: /INF3405/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /INF3710/ })).toBeNull();
    fireEvent.change(search, { target: { value: 'log3430' } });
    expect(screen.getByRole('checkbox', { name: /LOG3430/ })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'zzzz' } });
    expect(screen.getByText('Aucun cours ne correspond.')).toBeInTheDocument();
  });

  it('liste les cours cochés en pastilles retirables, dans l’ordre où ils ont été cochés', () => {
    renderPicker(['LOG3430', 'INF3710']);
    const chips = within(screen.getByRole('list', { name: 'Cours choisis' })).getAllByRole('button');
    expect(chips.map((b) => b.getAttribute('aria-label'))).toEqual(['Retirer LOG3430', 'Retirer INF3710']);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer LOG3430' }));
    expect(onChange).toHaveBeenCalledWith(['INF3710']);
  });

  it('une pastille reste visible quand la recherche masque le cours', () => {
    renderPicker(['INF3710']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'réseaux' } });
    expect(screen.queryByRole('checkbox', { name: /INF3710/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retirer INF3710' })).toBeInTheDocument();
  });

  it('la recherche ignore les accents', () => {
    const sys = { ...courses[0]!, sigle: 'SYS1000', title: 'Système embarqué' };
    renderPicker([], [...courses, sys]);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'systeme' } });
    expect(screen.getByRole('checkbox', { name: /SYS1000/ })).toBeInTheDocument();
  });

  describe('sections', () => {
    const mk = (sigle: string, groups: string[]): PolyCourse => ({ ...courses[0]!, sigle, title: `Titre ${sigle}`, groups });
    const list = [
      mk('AAA1000', ['Filière classique (93 crédits)']),
      mk('BBB1000', ['7. Génie énergétique ( 12 crédits)', 'Multimédia (27 crédits)']),
      mk('CCC1000', ['Multimédia (27 crédits)', '7. Génie énergétique ( 12 crédits)']),
      mk('DDD1000', ['6. Technologies de l’information pour ingénieurs (12 crédits)']),
    ];

    it('ouvre les sections principales, replie les autres orientations avec leur nombre', () => {
      renderPicker([], list);
      expect(isOpenByDefault('Filière classique (93 crédits) : 3 crédits parmi les cours suivants')).toBe(true);
      expect(isOpenByDefault('Cours spécialisés de la filière classique (15 crédits)')).toBe(true);
      expect(isOpenByDefault('Multimédia (27 crédits)')).toBe(true);
      expect(isOpenByDefault('6. Technologies de l’information pour ingénieurs (12 crédits)')).toBe(true);
      expect(isOpenByDefault('7. Génie énergétique ( 12 crédits)')).toBe(false);
      const energy = screen.getByText(/^7. Génie énergétique/).closest('details')!;
      expect(energy).not.toHaveAttribute('open');
      expect(within(energy).getByText('1 cours')).toBeInTheDocument();
      expect(screen.getByText(/^Multimédia/).closest('details')).toHaveAttribute('open');
    });

    it('le résumé de section indique combien de cours sont cochés', () => {
      renderPicker(['CCC1000', 'AAA1000'], list);
      expect(screen.getByText(/^Multimédia/).closest('summary')).toHaveTextContent('1 coché · 1 cours');
      expect(screen.getByText(/^Filière classique/).closest('summary')).toHaveTextContent('1 coché · 1 cours');
      expect(screen.getByText(/^7. Génie/).closest('summary')).not.toHaveTextContent('coché');
    });

    it('une section ouverte à la main reste ouverte après une recherche effacée', () => {
      renderPicker([], list);
      const energy = () => screen.getByText(/^7. Génie énergétique/).closest('details')!;
      energy().open = true;
      fireEvent(energy(), new Event('toggle'));
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'AAA' } });
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
      expect(energy()).toHaveAttribute('open');
    });

    it('un cours présent dans plusieurs sections n’apparaît qu’une fois, avec une mention', () => {
      renderPicker([], list);
      expect(screen.getAllByRole('checkbox', { name: /BBB1000/, hidden: true })).toHaveLength(1);
      expect(screen.getByText(/Aussi dans : Multimédia/, { exact: false })).toBeInTheDocument();
    });

    it('la recherche ouvre les sections repliées qui contiennent un résultat', () => {
      renderPicker([], list);
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'BBB' } });
      expect(screen.getByText(/^7. Génie énergétique/).closest('details')).toHaveAttribute('open');
    });
  });
});
