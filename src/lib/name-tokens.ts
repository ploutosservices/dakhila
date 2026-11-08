// A NAME AS THE WORDS A PAYMENT IS MATCHED ON: upper case, accents dropped (decomposed, combining marks removed), every
// character that is not a letter in any script or a space removed, split on spaces. "José Müller" and "JOSE MULLER"
// give the same words.
export function nameTokens(name: string): string[] {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^\p{L} ]/gu, '').split(/\s+/).filter(Boolean)
}
