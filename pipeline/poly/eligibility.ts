import type { PolyCourse } from '../../shared/types.js';

export const NEVER_ELIGIBLE_REASON = "Jamais admissible au contrat d'études (guide du Registrariat)";

/**
 * Sections du programme dont les cours sont comparés (début du titre, sans numéro de liste,
 * apostrophe droite). Les sous-sections « N crédits parmi les cours suivants » sont nommées
 * avec leur section parente et sont donc couvertes.
 */
export const COMPARED_GROUP_PREFIXES: readonly string[] = [
  'Filière classique',
  'Cours spécialisés de la filière classique',
  'Multimédia',
  'Sécurité et mobilité en logiciel',
  'Intelligence artificielle et science des données',
  "Technologies de l'information pour ingénieurs",
];

const normalizeGroup = (g: string): string =>
  g
    .replace(/[\u2019\u2018]/g, "'")
    .replace(/^\s*\d+\s*\.\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const prefixes = COMPARED_GROUP_PREFIXES.map(normalizeGroup);

type EligibilityInput = Omit<PolyCourse, 'eligible' | 'ineligibleReason' | 'compared'>;

/** Admissibilité au contrat d'études et appartenance à la comparaison. */
export function applyEligibility(c: EligibilityInput): PolyCourse {
  const neverEligible =
    c.sigle === 'SSH3501' ||
    (c.credits === 1 && c.title.toLowerCase().includes('communication écrite et orale'));
  const eligible = !neverEligible;
  const title = c.title.toLowerCase();
  const compared =
    eligible &&
    c.credits > 0 &&
    !c.sigle.startsWith('SSH') &&
    !title.includes('projet') &&
    !title.includes('stage') &&
    Number(c.sigle.charAt(3)) >= 2 &&
    c.groups.some((g) => {
      const n = normalizeGroup(g);
      return prefixes.some((p) => n.startsWith(p));
    });
  return { ...c, eligible, ineligibleReason: eligible ? null : NEVER_ELIGIBLE_REASON, compared };
}
