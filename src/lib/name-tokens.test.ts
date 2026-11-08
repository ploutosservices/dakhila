import { describe, expect, test } from 'vitest'
import { nameTokens } from './name-tokens'

// An ASCII-only tokenizer, for comparison: on an ASCII name the two give the same words.
const ascii = (name: string) => name.toUpperCase().replace(/[^A-Z ]/g, '').split(/\s+/).filter(Boolean)

describe('nameTokens', () => {
  test('an ASCII name gives the words it always did', () => {
    for (const n of ['Ann Example',"O'Brien-Smith 3", '  jane   q. public ', 'MARY ANN', 'x1 y2 z3', ''])
      expect(nameTokens(n)).toEqual(ascii(n))
  })

  test('an accented name matches its plain spelling', () => {
    expect(nameTokens('José Müller')).toEqual(['JOSE', 'MULLER'])
    expect(nameTokens('José Müller')).toEqual(nameTokens('JOSE MULLER'))
  })

  test('a name in another script keeps its letters', () => {
    expect(nameTokens('Ζωή Σ.')).toEqual(['ΖΩΗ', 'Σ'])
  })
})
