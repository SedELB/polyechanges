import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Db } from '../db/open.js';
import { upsertUniversity } from '../db/universities.js';
import { UNIVERSITY_FACTS, type University } from '../../shared/types.js';
import { normalizeName, type MoveOnPartner } from './moveOn.js';

export const UNIVERSITIES_PATH = 'data/universities.json';

const termDatesSchema = z.object({ start: z.string(), end: z.string(), examsEnd: z.string() });

export const provenanceSchema = z.object({
  url: z.string().min(1),
  retrievedAt: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'empreinte sha256 de 64 caractères hexadécimaux'),
  locator: z.object({ page: z.number().int().min(1), line: z.number().int().min(1) }),
  quote: z.string().min(1),
  stale: z.literal(true).optional(),
});

const universitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  moveOnName: z.string().min(1),
  countryCode: z.enum(['CN', 'JP', 'KR', 'TW']),
  city: z.string(),
  lat: z.number(),
  lng: z.number(),
  website: z.string(),
  catalogUrl: z.string().nullable(),
  creditSystem: z.enum(['ECTS', 'local']),
  contactHoursPerCredit: z.number().nullable(),
  terms: z.object({ fall: termDatesSchema.nullable(), spring: termDatesSchema.nullable() }),
  restrictions: z.string().nullable(),
  exchangeContact: z.string().nullable(),
  catalogPublic: z.boolean(),
  /** Facultatif dans le fichier : absent = aucune source. */
  provenance: z.partialRecord(z.enum(UNIVERSITY_FACTS), provenanceSchema).default({}),
});

export function parseUniversities(raw: unknown): University[] {
  const list = z.array(universitySchema).parse(raw);
  const ids = new Set<string>();
  for (const u of list) {
    if (ids.has(u.id)) throw new Error(`Identifiant d'université en double : ${u.id}`);
    ids.add(u.id);
  }
  return list.map((u) => ({ ...u, moveOnName: normalizeName(u.moveOnName) }));
}

/** Lit et valide le registre des universités. */
export function loadUniversities(path: string = UNIVERSITIES_PATH): University[] {
  return parseUniversities(JSON.parse(readFileSync(path, 'utf8')));
}

/** Le fichier JSON est la source de vérité : chaque université est écrite dans la base. */
export function syncUniversities(db: Db, path: string = UNIVERSITIES_PATH): void {
  const list = loadUniversities(path);
  db.transaction(() => {
    for (const u of list) upsertUniversity(db, u);
  })();
}

// Ordre significatif : le préfixe le plus précis passe avant le plus court (ntust avant ntu).
const ID_BY_NAME_PREFIX: [string, string][] = [
  ['City University of Hong Kong', 'cityu-hk'],
  ['Shanghai Jiao Tong University', 'sjtu-cn'],
  ['Tongji University', 'tongji-cn'],
  ['Doshisha University', 'doshisha-jp'],
  ['Institute of Science Tokyo', 'sciencetokyo-jp'],
  ['Nagoya University', 'nagoya-jp'],
  ['Tohoku University', 'tohoku-jp'],
  ['Korea Advanced Institute', 'kaist-kr'],
  ['Korea University', 'korea-kr'],
  ['Pohang University', 'postech-kr'],
  ['Seoul National University', 'snu-kr'],
  ['National Cheng Kung University', 'ncku-tw'],
  ['National Taiwan University of Science and Technology', 'ntust-tw'],
  ['National Taiwan University', 'ntu-tw'],
  ['National Yang Ming Chiao Tung University', 'nycu-tw'],
];

/** Squelette du registre à partir de la liste MoveOn ; les champs à remplir plus tard restent vides ou nuls. */
export function buildSkeleton(partners: MoveOnPartner[]): University[] {
  return partners.map((p) => {
    const name = normalizeName(p.moveOnName);
    const match = ID_BY_NAME_PREFIX.find(([prefix]) => name.startsWith(prefix));
    if (!match) throw new Error(`Aucun identifiant connu pour le partenaire MoveOn « ${name} »`);
    return {
      id: match[1],
      name,
      moveOnName: name,
      countryCode: p.countryCode,
      city: '',
      lat: p.lat,
      lng: p.lng,
      website: '',
      catalogUrl: null,
      creditSystem: 'local',
      contactHoursPerCredit: null,
      terms: { fall: null, spring: null },
      restrictions: null,
      exchangeContact: null,
      catalogPublic: true,
      provenance: {},
    };
  });
}
