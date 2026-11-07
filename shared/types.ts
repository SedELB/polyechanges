export type CountryCode = 'CN' | 'JP' | 'KR' | 'TW';
export type HostTerm = 'fall' | 'spring';
export type PolyTerm = 'automne' | 'hiver';
export type Language = 'en' | 'other' | 'unknown';
export type Workload = 'conforme' | 'trop_legere' | 'trop_lourde' | 'inconnue';
export type ContentBand = 'tres' | 'partiel' | 'aucun';
export type Level = 'elevee' | 'moyenne' | 'faible';

/** Dates ISO AAAA-MM-JJ. */
export interface TermDates {
  start: string;
  end: string;
  examsEnd: string;
}

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
}

export interface Notion {
  id: string;
  fr: string;
  en: string;
}
