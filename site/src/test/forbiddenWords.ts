const FORBIDDEN = /approuv|équivalent officiel|equivalent officiel/i;

/** Échoue si le texte visible contient un des mots que le site ne doit jamais employer. */
export function expectNoForbiddenWords(container: HTMLElement): void {
  const text = container.textContent ?? '';
  const found = FORBIDDEN.exec(text);
  if (found) throw new Error(`Texte interdit dans l'interface : « ${found[0]} »`);
}
