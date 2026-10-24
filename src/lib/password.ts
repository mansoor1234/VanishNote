/**
 * Options for the password generator page (/password-generator). Generation itself is
 * generatePassword in crypto.ts: Web Crypto randomness with rejection sampling, in the browser.
 */
import { generatePassword } from './crypto';

export const CHARACTER_SETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*-_=+?.:~',
} as const;
export type CharacterSet = keyof typeof CHARACTER_SETS;

/** Characters easily confused with another when read aloud or copied by hand. */
const LOOK_ALIKES = /[IOlo01]/g;

export const MIN_LENGTH = 8;
export const MAX_LENGTH = 64;
export const DEFAULT_LENGTH = 20;

export interface PasswordOptions {
  length: number;
  sets: CharacterSet[];
  avoidLookAlikes: boolean;
}

function setChars(set: CharacterSet, avoidLookAlikes: boolean): string {
  return avoidLookAlikes ? CHARACTER_SETS[set].replace(LOOK_ALIKES, '') : CHARACTER_SETS[set];
}

export function buildAlphabet(sets: CharacterSet[], avoidLookAlikes: boolean): string {
  return sets.map((set) => setChars(set, avoidLookAlikes)).join('');
}

/** Bits of entropy of a uniformly random password of `length` characters from `alphabet`. */
export function entropyBits(length: number, alphabetSize: number): number {
  return alphabetSize < 2 ? 0 : length * Math.log2(alphabetSize);
}

export function strengthLabel(bits: number): 'Weak' | 'Fair' | 'Strong' | 'Very strong' {
  if (bits < 60) return 'Weak';
  if (bits < 80) return 'Fair';
  if (bits < 100) return 'Strong';
  return 'Very strong';
}

/**
 * A random password with at least one character from every chosen set (many sites require
 * that). Drawing again until the rule holds keeps every qualifying password equally likely.
 */
export function generateFromOptions({ length, sets, avoidLookAlikes }: PasswordOptions): string {
  if (sets.length === 0) throw new RangeError('Choose at least one character set');
  const size = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.round(length)));
  const alphabet = buildAlphabet(sets, avoidLookAlikes);
  const groups = sets.map((set) => setChars(set, avoidLookAlikes));
  for (;;) {
    const password = generatePassword(size, alphabet);
    if (groups.every((chars) => [...password].some((c) => chars.includes(c)))) return password;
  }
}
