export type CountryCode = 'CN' | 'JP' | 'KR' | 'TW';
export type HostTerm = 'fall' | 'spring';
export type PolyTerm = 'automne' | 'hiver';
export type Language = 'en' | 'other' | 'unknown';
export type Workload = 'conforme' | 'trop_legere' | 'trop_lourde' | 'inconnue';
export type ContentBand = 'tres' | 'partiel' | 'aucun';
export type Level = 'elevee' | 'moyenne' | 'faible';

/** Dates ISO AAAA-MM-JJ. */
export interface TermDates {
  start: string | null;
  end: string | null;
  examsEnd: string | null;
}

/** Où un fait a été lu : copie brute identifiée par son empreinte, position dans son texte extrait. */
export interface Provenance {
  url: string;
  retrievedAt: string;
  sha256: string;
  /** 1-based, dans le texte extrait (page = 1 pour une page HTML). */
  locator: { page: number; line: number };
  /** Extrait exact, mot pour mot. */
  quote: string;
  /** Un ou deux extraits exacts de la même copie, qui donnent l'année et/ou le mois d'une date éloignée de son extrait principal. */
  context?: { locator: { page: number; line: number }; quote: string }[];
  /** Posé par le rafraîchissement quand l'extrait est introuvable. */
  stale?: true;
}

export const UNIVERSITY_FACTS = [
  'name',
  'city',
  'coordinates',
  'website',
  'catalogUrl',
  'creditSystem',
  'contactHoursPerCredit',
  'terms.fall.start',
  'terms.fall.end',
  'terms.fall.examsEnd',
  'terms.spring.start',
  'terms.spring.end',
  'terms.spring.examsEnd',
  'restrictions',
  'exchangeContact',
  'catalogPublic',
] as const;
export type UniversityFact = (typeof UNIVERSITY_FACTS)[number];

export interface University {
  id: string;
  name: string;
  moveOnName: string;
  countryCode: CountryCode;
  city: string;
  lat: number;
  lng: number;
  website: string;
  catalogUrl: string | null;
  creditSystem: 'ECTS' | 'local';
  contactHoursPerCredit: number | null;
  terms: Record<HostTerm, TermDates | null>;
  restrictions: string | null;
  exchangeContact: string | null;
  catalogPublic: boolean;
  provenance: Partial<Record<UniversityFact, Provenance>>;
}

export interface HostCourseInput {
  code: string;
  title: string;
  description: string;
  outline: string | null;
  credits: number | null;
  contactHours: number | null;
  language: Language;
  terms: HostTerm[];
  level: 'undergrad' | 'grad';
  sourceUrl: string;
  /** Saisie manuelle seulement : d'où vient la position du cours. */
  provenance?: Provenance;
}

export interface PolyCourse {
  sigle: string;
  title: string;
  description: string;
  credits: number;
  triplet: [number, number, number];
  prerequisites: string;
  status: 'obligatoire' | 'optionnel';
  eligible: boolean;
  ineligibleReason: string | null;
  compared: boolean;
  /** Titres des sections du programme où le cours apparaît, dans l'ordre de la page. */
  groups: string[];
  sourceUrl: string;
  collectedAt: string;
  /** Position du sigle dans la copie brute de la page du programme. */
  sourceLocator: { sha256: string; page: number; line: number } | null;
}

export interface Notion {
  id: string;
  fr: string;
  en: string;
}
