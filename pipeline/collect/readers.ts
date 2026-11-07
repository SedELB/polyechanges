import type { HostCourseInput } from '../../shared/types.js';
import { manualReader } from './manualReader.js';

export type Reader = (pages: { url: string; body: Buffer; contentType: string }[]) => HostCourseInput[];

const readers = new Map<string, Reader>();

export function registerReader(name: string, reader: Reader): void {
  readers.set(name, reader);
}

export function getReader(name: string): Reader {
  const reader = readers.get(name);
  if (!reader) throw new Error(`Lecteur inconnu : ${name}`);
  return reader;
}

registerReader('manual', manualReader);
