const SPLIT = /[.;:\n。；：]/;
const COMMAS = /[,、，]/g;
const MIN_LENGTH = 3;

const clean = (chunks: string[]): string[] => chunks.map((c) => c.trim()).filter((c) => c.length >= MIN_LENGTH);

/** Découpe le texte d'un cours en passages courts, comparables aux notions de la grille. */
export function splitPassages(t: { title: string; description: string; outline: string | null }): string[] {
  const out: string[] = [];
  out.push(...clean([t.title]));
  for (const text of [t.description, t.outline ?? '']) {
    for (const chunk of clean(text.split(SPLIT))) {
      out.push(chunk);
      if ((chunk.match(COMMAS) ?? []).length >= 3) out.push(...clean(chunk.split(COMMAS)));
    }
  }
  return [...new Set(out)];
}
