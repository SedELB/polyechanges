import type { HostTerm, Level, Notion, PolyCourse, University, Workload } from './types.js';

export interface SiteMeta {
  criterionVersion: string;
  generatedAt: string;
  polyWeeks: number;
  workloadTolerance: number;
  /**
   * Universités au catalogue public dont aucun cours n'est en base (pages enregistrées absentes cette année, par
   * exemple) : le site dit « catalogue non lu cette année » au lieu d'une liste vide présentée comme complète.
   */
  unreadCatalogs: string[];
}

export interface HostCourseOut {
  id: number;
  universityId: string;
  code: string;
  title: string;
  description: string;
  credits: number | null;
  contactHours: number | null;
  language: 'en' | 'unknown';
  terms: HostTerm[];
  /** Cycle d'études du cours : 1er cycle ou cycles supérieurs. */
  level: 'undergrad' | 'grad';
  sourceUrl: string;
  collectedAt: string;
  /** Position du code du cours dans le texte de sa copie brute (1-based). */
  sourcePage: number | null;
  sourceLine: number | null;
  /** Empreinte de la copie brute d'où vient le cours. */
  snapshotSha256: string | null;
  /** Année du catalogue d'où vient la description, quand elle est plus ancienne que la liste des cours (absent sinon). */
  descriptionsDated?: string;
}

/** Cours de Poly exporté, avec l'adresse de la page d'où il a été lu. */
export interface PolyCourseOut extends PolyCourse {
  /**
   * Adresse de la copie brute où se trouve le cours (la page du programme, enregistrée à la main), retrouvée par
   * l'empreinte de sa position ; nulle si la position est inconnue.
   */
  pageUrl: string | null;
}

export interface MatchOut {
  polySigle: string;
  hostCourseId: number;
  notionsFound: string[];
  notionsMissing: string[];
  contentScore: number;
  workload: Workload;
  level: Level;
  textUsed: 'description' | 'description+plan' | 'titre';
}

export interface SiteData {
  meta: SiteMeta;
  universities: University[];
  polyCourses: PolyCourseOut[];
  hostCourses: HostCourseOut[];
  matches: MatchOut[];
  notions: Record<string, Notion[]>;
}

/** Un fichier JSON par clé de `SiteData` : `poly-courses.json` pour `polyCourses`, etc. */
export const SITE_DATA_FILES = ['meta', 'universities', 'poly-courses', 'host-courses', 'matches', 'notions'] as const;
