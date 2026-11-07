import * as cheerio from 'cheerio';
import type { PolyCourse } from '../../shared/types.js';
import { applyEligibility } from './eligibility.js';

/** Cours lu sur la page du programme, avant les règles d'admissibilité. */
export type ParsedPolyCourse = Omit<PolyCourse, 'eligible' | 'ineligibleReason' | 'compared'>;

const clean = (s: string): string => s.replace(/[\s\u00a0]+/g, ' ').trim();

/** Section dont les cours sont obligatoires : « Filière classique (93 crédits) » elle-même, sans ses sous-sections. */
const OBLIGATORY_GROUP = /^Filière classique \(\d+ crédits\)$/;

const TRIPLET = /\(\s*(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*\)/;

const num = (s: string): number => Number(s.replace(',', '.'));

/**
 * Lit tous les cours d'une page de programme de Polytechnique (fiche complète sous chaque ligne de cours).
 * Un cours par sigle ; ses `groups` sont les titres des sections où il apparaît, dans l'ordre de la page.
 * Les sigles dont le premier chiffre est 0 (année préparatoire) sont ignorés.
 */
export function parseProgramCourses(html: string, programUrl: string): ParsedPolyCourse[] {
  const $ = cheerio.load(html);
  const bySigle = new Map<string, ParsedPolyCourse>();
  let section = ''; // titre h2 courant
  let subsection = ''; // titre h3 de sous-groupe courant (orientation, concentration)
  let group = '';

  $('h2.field-titre-groupe, h3.field-titre-sous-groupe, h3.field-sous-titre, tr.titre').each((_, el) => {
    const node = $(el);
    if (el.tagName === 'h2') {
      section = clean(node.text());
      subsection = '';
      group = section;
      return;
    }
    if (el.tagName === 'h3') {
      if (node.hasClass('field-titre-sous-groupe')) {
        subsection = clean(node.text());
        group = subsection;
      } else {
        group = `${subsection || section} : ${clean(node.text())}`;
      }
      return;
    }

    const sigleCell = node.children('td.sigle').first();
    const contenu = node.next('tr.contenu');
    if (sigleCell.length === 0 || contenu.length === 0) return; // ligne libre (stage, « Cours au choix »…)
    const sigle = clean(sigleCell.clone().children().remove().end().text());
    if (!/^[A-Z]{3}\d{4}[A-Z]{0,2}$/.test(sigle) || sigle[3] === '0') return;

    const existing = bySigle.get(sigle);
    if (existing) {
      if (group && !existing.groups.includes(group)) existing.groups.push(group);
      return;
    }

    const creditsText = clean(contenu.find('.triplet').first().text());
    // Le nombre de crédits est vide pour les activités sans crédit (par exemple les épreuves de communication).
    const creditsMatch = /Nombre de crédits\s*:\s*(\d+(?:[.,]\d+)?)/.exec(creditsText);
    const tripletMatch = TRIPLET.exec(creditsText);
    if (!tripletMatch) throw new Error(`Triplet illisible pour ${sigle}`);

    let prerequisites = '';
    contenu.find('.details > div').each((_i, d) => {
      const div = $(d);
      if (/^Préalables?/i.test(clean(div.children('strong').first().text()))) {
        prerequisites = clean(div.clone().children('strong').remove().end().text());
      }
    });

    const desc = contenu.find('.desc').first().clone();
    desc.find('.lien-cours, strong').remove();
    const detailsHref = contenu.find('.lien-cours a').first().attr('href');

    bySigle.set(sigle, {
      sigle,
      title: clean(node.children('td.titre').first().text()),
      description: clean(desc.text()),
      credits: creditsMatch ? num(creditsMatch[1]) : 0,
      triplet: [num(tripletMatch[1]), num(tripletMatch[2]), num(tripletMatch[3])],
      prerequisites,
      status: 'optionnel',
      sourceUrl: detailsHref ? new URL(detailsHref, programUrl).href : programUrl,
      collectedAt: '',
      groups: group ? [group] : [],
    });
  });

  for (const c of bySigle.values()) {
    if (c.groups.some((g) => OBLIGATORY_GROUP.test(g))) c.status = 'obligatoire';
  }
  return [...bySigle.values()];
}

/** Sigle et statut de chaque cours de la page du programme. */
export function parseProgramPage(html: string): { sigle: string; status: 'obligatoire' | 'optionnel' }[] {
  return parseProgramCourses(html, 'https://www.polymtl.ca/').map(({ sigle, status }) => ({ sigle, status }));
}

/** Lit les cours de Poly et applique les règles d'admissibilité. `collectedAt` est la date de la copie brute. */
export function readPolyCourses(html: string, programUrl: string, collectedAt: string): PolyCourse[] {
  return parseProgramCourses(html, programUrl).map((c) => applyEligibility({ ...c, collectedAt }));
}

