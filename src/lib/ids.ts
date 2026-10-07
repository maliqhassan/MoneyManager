import * as Crypto from 'expo-crypto';

/**
 * Client-generated UUID v4. Records are created offline with their final id,
 * which makes sync upserts idempotent and avoids id remapping.
 */
export function newId(): string {
  return Crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
