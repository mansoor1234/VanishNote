import { describe, expect, it } from 'vitest';
import { generatePassword } from '../../src/lib/crypto';
import {
  buildAlphabet,
  CHARACTER_SETS,
  entropyBits,
  generateFromOptions,
  MAX_LENGTH,
  MIN_LENGTH,
  strengthLabel,
  type CharacterSet,
} from '../../src/lib/password';

const ALL: CharacterSet[] = ['upper', 'lower', 'digits', 'symbols'];

describe('password generator options', () => {
  it('includes at least one character from every chosen set', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateFromOptions({ length: MIN_LENGTH, sets: ALL, avoidLookAlikes: false });
      expect(pw).toHaveLength(MIN_LENGTH);
      for (const set of ALL) expect([...pw].some((c) => CHARACTER_SETS[set].includes(c)), `${pw} has ${set}`).toBe(true);
    }
  });

  it('uses only the chosen sets', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateFromOptions({ length: 32, sets: ['digits'], avoidLookAlikes: false })).toMatch(/^[0-9]{32}$/);
      expect(generateFromOptions({ length: 32, sets: ['lower', 'upper'], avoidLookAlikes: true })).toMatch(/^[A-HJ-NP-Za-km-np-z]{32}$/);
    }
  });

  it('leaves out look-alikes when asked', () => {
    expect(buildAlphabet(ALL, true)).not.toMatch(/[IOlo01]/);
    expect(buildAlphabet(['digits'], true)).toBe('23456789');
  });

  it('clamps the length and rejects an empty selection', () => {
    expect(generateFromOptions({ length: 2, sets: ALL, avoidLookAlikes: false })).toHaveLength(MIN_LENGTH);
    expect(generateFromOptions({ length: 500, sets: ALL, avoidLookAlikes: false })).toHaveLength(MAX_LENGTH);
    expect(() => generateFromOptions({ length: 20, sets: [], avoidLookAlikes: false })).toThrow(RangeError);
  });

  it('reports strength from length and alphabet size', () => {
    expect(entropyBits(20, 64)).toBe(120);
    expect(strengthLabel(entropyBits(8, 10))).toBe('Weak');
    expect(strengthLabel(entropyBits(20, buildAlphabet(ALL, false).length))).toBe('Very strong');
  });

  it('generatePassword accepts a custom alphabet', () => {
    expect(generatePassword(40, 'ab')).toMatch(/^[ab]{40}$/);
    expect(() => generatePassword(10, 'a')).toThrow(RangeError);
  });
});
