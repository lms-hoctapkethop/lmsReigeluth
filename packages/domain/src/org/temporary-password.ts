import { randomInt } from 'node:crypto'

const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function temporaryPassword(length = 12): string {
  let value = ''
  for (let index = 0; index < length; index += 1) {
    value += alphabet[randomInt(alphabet.length)] ?? ''
  }
  return value
}

export const temporaryPasswordAlphabet = alphabet
