import type { HostCourseInput } from '../../shared/types.js';
import { manualReader } from './manualReader.js';

type Pages = { url: string; body: Buffer; contentType: string }[];

export type Reader = (pages: Pages) => HostCourseInput[];
/** Lecteur asynchrone : l'extraction du texte d'un PDF l'est. */
export type AsyncReader = (pages: Pages) => Promise<HostCourseInput[]>;

const readers = new Map<string, Reader | AsyncReader>();

export function registerReader(name: string, reader: Reader | AsyncReader): void {
  readers.set(name, reader);
}

export function getReader(name: string): Reader | AsyncReader {
  const reader = readers.get(name);
  if (!reader) throw new Error(`Lecteur inconnu : ${name}`);
  return reader;
}

registerReader('manual', manualReader);
