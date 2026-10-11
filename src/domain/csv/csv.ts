/**
 * CSV reading and writing (RFC 4180 with the variations real bank exports
 * have). The reader is a character state machine — never `split(',')` — so
 * quoted delimiters, escaped quotes ("") and line breaks inside quotes are
 * handled. Errors carry the 1-based line number where the record started.
 */

export const CSV_DELIMITERS = [',', ';', '\t', '|'] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

export interface CsvRecord {
  /** 1-based line on which the record starts. */
  line: number;
  cells: string[];
}

export interface CsvError {
  line: number;
  code: 'unterminated_quote' | 'field_count' | 'text_after_quote';
  /** For 'field_count': expected and found. */
  expected?: number;
  found?: number;
}

export interface ParsedCsv {
  delimiter: CsvDelimiter;
  /** Unique, non-empty headers ("Column 3" for blanks, "Amount (2)" for repeats). */
  headers: string[];
  /** Original header texts, trimmed. */
  rawHeaders: string[];
  records: CsvRecord[];
  errors: CsvError[];
}

/** Removes a UTF-8 byte-order mark. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * The delimiter that splits the first lines most consistently (outside
 * quotes). Defaults to a comma.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const sample = stripBom(text).slice(0, 20_000);
  let best: CsvDelimiter = ',';
  let bestScore = 0;
  for (const d of CSV_DELIMITERS) {
    const counts: number[] = [];
    let inQuotes = false;
    let count = 0;
    for (let i = 0; i < sample.length && counts.length < 10; i += 1) {
      const c = sample[i]!;
      if (c === '"') inQuotes = !inQuotes;
      else if (!inQuotes && c === d) count += 1;
      else if (!inQuotes && (c === '\n' || c === '\r')) {
        if (c === '\r' && sample[i + 1] === '\n') i += 1;
        if (count > 0 || counts.length > 0) counts.push(count);
        count = 0;
      }
    }
    if (count > 0) counts.push(count);
    if (counts.length === 0 || counts[0] === 0) continue;
    const consistent = counts.filter((n) => n === counts[0]).length;
    const score = consistent * 1000 + counts[0]!;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/**
 * Raw records (no header handling). Empty lines are skipped. A record with a
 * read error is reported and left out, never guessed at.
 */
export function readRecords(
  input: string,
  delimiter: CsvDelimiter,
): { records: CsvRecord[]; errors: CsvError[] } {
  const text = stripBom(input);
  const records: CsvRecord[] = [];
  const errors: CsvError[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let quotedField = false;
  let afterQuote = false;
  let unreadable = false;
  let line = 1;
  let recordLine = 1;

  const endField = () => {
    cells.push(quotedField ? field : field.trim());
    field = '';
    quotedField = false;
    afterQuote = false;
  };
  const endRecord = () => {
    endField();
    const empty = cells.every((c) => c === '');
    if (!empty && !unreadable) records.push({ line: recordLine, cells });
    cells = [];
    unreadable = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        // Line breaks inside quotes belong to the value; keep counting lines.
        if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line += 1;
        field += c;
      }
      continue;
    }
    if (c === delimiter) {
      endField();
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      recordLine = line;
    } else if (c === '"' && field.trim() === '' && !quotedField) {
      inQuotes = true;
      quotedField = true;
      field = '';
    } else if (afterQuote) {
      if (c !== ' ' && c !== '\t') {
        errors.push({ line: recordLine, code: 'text_after_quote' });
        unreadable = true;
        afterQuote = false;
        field += c;
      }
    } else {
      field += c;
    }
  }
  if (inQuotes) {
    errors.push({ line: recordLine, code: 'unterminated_quote' });
    unreadable = true;
  }
  if (field !== '' || cells.length > 0 || quotedField) endRecord();
  return { records, errors };
}

function uniqueHeaders(raw: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, index) => {
    const base = h.trim() === '' ? `Column ${index + 1}` : h.trim();
    const key = base.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

/**
 * Parses a CSV with a header row. A record with MORE fields than the header
 * (an unquoted delimiter in the data) is reported and excluded, never
 * guessed at. A record with fewer fields is padded with empty values — many
 * exports omit trailing empty fields — and missing required values are then
 * reported by the field mapping.
 */
export function parseCsv(input: string, delimiter?: CsvDelimiter): ParsedCsv {
  const d = delimiter ?? detectDelimiter(input);
  const { records, errors } = readRecords(input, d);
  const [header, ...rows] = records;
  const rawHeaders = (header?.cells ?? []).map((h) => h.trim());
  const headers = uniqueHeaders(rawHeaders);
  const good: CsvRecord[] = [];
  for (const r of rows) {
    if (r.cells.length > headers.length) {
      errors.push({
        line: r.line,
        code: 'field_count',
        expected: headers.length,
        found: r.cells.length,
      });
    } else {
      const padding = Array.from({ length: headers.length - r.cells.length }, () => '');
      good.push({ line: r.line, cells: [...r.cells, ...padding] });
    }
  }
  return {
    delimiter: d,
    headers,
    rawHeaders,
    records: good,
    errors: errors.sort((a, b) => a.line - b.line),
  };
}

// ----------------------------------------------------------------- write ----

const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Protects a FREE-TEXT value against spreadsheet formula injection: a value
 * starting with = + - @ TAB or CR is prefixed with an apostrophe, which
 * spreadsheets show as text. Only for user-entered text (names, notes) —
 * never for numbers or dates the app writes itself.
 */
export function protectText(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** Quotes a cell when needed (delimiter, quote, line break, edge spaces). */
export function quoteCell(value: string, delimiter: string = ','): string {
  const needs =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r') ||
    value !== value.trim();
  return needs ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialises rows (header first) with CRLF line endings, per RFC 4180. */
export function toCsv(rows: readonly (readonly string[])[], delimiter: string = ','): string {
  return (
    rows.map((r) => r.map((c) => quoteCell(c, delimiter)).join(delimiter)).join('\r\n') + '\r\n'
  );
}
