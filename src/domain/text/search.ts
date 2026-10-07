/**
 * Locale-safe search normalisation. SQLite's LIKE/lower() only fold ASCII, so
 * text is normalised in JS (Unicode NFKD, diacritics removed, default — not
 * locale-specific — lower-casing, whitespace collapsed) and stored in a
 * local-only `search_text` column; queries are normalised the same way.
 *
 * "Café"/"CAFE" → "cafe", "Straße" → "strasse", "İstanbul" → "istanbul".
 */
export function normalizeSearchText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text indexed for a transaction: payee and notes (categories/tags are matched by id). */
export function buildTransactionSearchText(
  payee: string | null | undefined,
  notes: string | null | undefined,
): string {
  return normalizeSearchText([payee, notes].filter(Boolean).join(' '));
}

/** Escapes LIKE wildcards so user input is matched literally (use with ESCAPE '\'). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
