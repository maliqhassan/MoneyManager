import { normalizeSearchText } from '../text/search';

/**
 * Merchant/payee normalisation for matching (rules, "previously categorised
 * as", search). The original text is always kept for display; only the key
 * is normalised.
 *
 * Deliberately conservative — it removes noise that varies between card
 * statements of the SAME merchant, never words that could distinguish two
 * different merchants:
 *   "WALMART #1234", "Walmart Store 1234", "WAL-MART"  → "walmart"
 *   "SQ *BLUE BOTTLE COFFEE"                          → "blue bottle coffee"
 *   "Netflix.com"                                      → "netflix"
 *   "Shell" vs "Shell Oil"                             → stay different
 */

/** Payment-processor prefixes that precede the real merchant name. */
const PROCESSOR_PREFIXES = /^(sq|tst|sp|pp|paypal|zettle|sumup|izettle)\s*\*\s*/;
/** Legal-entity suffixes at the end of a name. */
const LEGAL_SUFFIXES = /\s+(inc|llc|ltd|limited|co|corp|corporation|gmbh|plc|pty|sa|srl|bv|ag)$/;
/** Store/branch numbers: "#1234", "store 1234", "no. 12", and long trailing digit runs. */
const STORE_NUMBERS = [/\s*#\s*\d+/g, /\s+(store|branch|unit|no)\s*\d+/g, /\s+\d{3,}$/];
const WEB_SUFFIX = /\.(com|net|org|co|io|app)(\/\S*)?$/;

export function normalizeMerchant(name: string | null | undefined): string | null {
  let key = normalizeSearchText(name);
  if (!key) return null;
  const original = key;

  key = key.replace(PROCESSOR_PREFIXES, '');
  key = key.replace(WEB_SUFFIX, '');
  for (const pattern of STORE_NUMBERS) key = key.replace(pattern, '');
  key = key.replace(/[.,'’]/g, ''); // punctuation inside names: "mcdonald's" → "mcdonalds"
  key = key.replace(/(\p{L})-(\p{L})/gu, '$1$2'); // "wal-mart" → "walmart"
  key = key.replace(LEGAL_SUFFIXES, '');
  key = key.replace(/[^\p{L}\p{N}\s&+]/gu, ' ');
  key = key.replace(/\s+/g, ' ').trim();

  // Never normalise a name away entirely ("Store 24" stays "store 24").
  return key.length > 0 ? key : original;
}
