import { z } from 'zod';
import type { HostCourseInput } from '../../shared/types.js';
import { provenanceSchema } from '../partners/registry.js';
import type { Reader } from './readers.js';

const manualCourseSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  outline: z.string().nullable(),
  credits: z.number().nullable(),
  contactHours: z.number().nullable(),
  language: z.enum(['en', 'other', 'unknown']),
  terms: z.array(z.enum(['fall', 'spring'])),
  level: z.enum(['undergrad', 'grad']),
  sourceUrl: z.string().min(1),
  /** D'où vient la position du cours : copie brute (empreinte) et ligne de son texte extrait. */
  provenance: provenanceSchema,
});

/** Lecteur `manual` : la première page contient le JSON de `data/manual/<sourceId>.json`. */
export const manualReader: Reader = (pages) => {
  const page = pages[0];
  if (!page) throw new Error('Fichier manuel absent');
  const parsed: HostCourseInput[] = z.array(manualCourseSchema).parse(JSON.parse(page.body.toString('utf8')));
  return parsed;
};
