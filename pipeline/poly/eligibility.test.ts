import { describe, expect, it } from 'vitest';
import type { PolyCourse } from '../../shared/types.js';
import { COMPARED_GROUP_PREFIXES, applyEligibility } from './eligibility.js';

type Input = Omit<PolyCourse, 'eligible' | 'ineligibleReason' | 'compared'>;

const base: Input = {
  sigle: 'LOG3430',
  title: 'Méthodes de test et de validation du logiciel',
  description: 'Tests.',
  credits: 3,
  triplet: [3, 1.5, 4.5],
  prerequisites: '',
  status: 'obligatoire',
  groups: ['Filière classique (93 crédits)'],
  sourceUrl: 'https://www.polymtl.ca/programmes/cours/x',
  collectedAt: '2026-11-10',
};
const course = (over: Partial<Input>): Input => ({ ...base, ...over });
const REASON = "Jamais admissible au contrat d'études (guide du Registrariat)";

describe('applyEligibility', () => {
  it('SSH3501 est grisé avec la raison', () => {
    const ssh3501 = course({ sigle: 'SSH3501', title: "Éthique appliquée à l'ingénierie", credits: 2 });
    expect(applyEligibility(ssh3501)).toMatchObject({ eligible: false, compared: false, ineligibleReason: REASON });
  });

  it('un cours de Communication écrite et orale de 1 crédit est grisé', () => {
    const comm = course({ sigle: 'LOG3005', title: 'Communication écrite et orale', credits: 1 });
    expect(applyEligibility(comm)).toMatchObject({ eligible: false, compared: false, ineligibleReason: REASON });
    const multi = course({ sigle: 'XXX3005', title: 'Communication écrite et orale', credits: 3 });
    expect(applyEligibility(multi)).toMatchObject({ eligible: true, ineligibleReason: null });
  });

  it('un cours de projet est admissible mais pas comparé', () => {
    const projetLog = course({ sigle: 'LOG3900', title: "Projet d'évolution d'un logiciel", credits: 4 });
    expect(applyEligibility(projetLog)).toMatchObject({ eligible: true, ineligibleReason: null, compared: false });
  });

  it('un stage ou un cours SSH est admissible mais pas comparé', () => {
    expect(applyEligibility(course({ title: 'Stage en entreprise' }))).toMatchObject({ eligible: true, compared: false });
    expect(applyEligibility(course({ sigle: 'SSH3201', title: "Économique de l'ingénieur" }))).toMatchObject({
      eligible: true,
      compared: false,
    });
  });

  it('un cours de la filière classique de niveau 2 ou plus est comparé', () => {
    expect(applyEligibility(base)).toMatchObject({ eligible: true, compared: true });
  });

  it("un cours de première année n'est pas comparé", () => {
    expect(applyEligibility(course({ sigle: 'INF1500' }))).toMatchObject({ eligible: true, compared: false });
  });

  it("un cours sans crédit n'est pas comparé", () => {
    expect(applyEligibility(course({ sigle: 'LOG3005I', credits: 0 }))).toMatchObject({ compared: false });
  });

  it('les sous-sections « parmi les cours suivants » comptent avec leur section parente', () => {
    const groups = ['Filière classique (93 crédits) : 3 crédits parmi les cours suivants'];
    expect(applyEligibility(course({ groups })).compared).toBe(true);
    const spec = ['Cours spécialisés de la filière classique (15 crédits) : 6 crédits parmi les cours suivants'];
    expect(applyEligibility(course({ sigle: 'LOG8970', title: 'Cours X', groups: spec })).compared).toBe(true);
  });

  it("les concentrations et l'orientation en technologies de l'information sont comparées", () => {
    for (const g of [
      'Multimédia (27 crédits)',
      'Sécurité et mobilité en logiciel (27 crédits)',
      'Intelligence artificielle et science des données (27 crédits)',
      "6. Technologies de l'information pour ingénieurs (12 crédits)",
      '6. Technologies de l’information pour ingénieurs (12 crédits)',
    ]) {
      expect(applyEligibility(course({ sigle: 'INF8085', groups: [g] })).compared, g).toBe(true);
    }
  });

  it('les autres orientations restent admissibles mais ne sont pas comparées', () => {
    const groups = ['1. Développement durable (12 crédits)', 'Orientation personnalisée (12 crédits)'];
    expect(applyEligibility(course({ sigle: 'DDI8001', groups }))).toMatchObject({ eligible: true, compared: false });
    expect(applyEligibility(course({ groups: [] })).compared).toBe(false);
  });

  it('expose la liste des préfixes de sections comparées', () => {
    expect(COMPARED_GROUP_PREFIXES).toContain('Multimédia');
  });
});
