/**
 * Strict JSON reader that keeps every number as its ORIGINAL TEXT.
 *
 * `JSON.parse` turns numbers into binary floats; exchange rates must stay
 * exact decimals, so provider responses are read with this instead. Numbers
 * come back as `JsonNumber` instances. Anything that is not valid JSON
 * (RFC 8259) throws `JsonSyntaxError`. Depth and size are bounded.
 */

/** A JSON number, kept as its literal text (e.g. "1.0834", "2.5e-7"). */
export class JsonNumber {
  constructor(readonly literal: string) {}
}
export type JsonValue =
  null | boolean | string | JsonNumber | JsonValue[] | { [key: string]: JsonValue };

export class JsonSyntaxError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(`${message} at ${position}`);
    this.name = 'JsonSyntaxError';
  }
}

export const MAX_JSON_LENGTH = 5_000_000;
const MAX_DEPTH = 32;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const WHITESPACE = /[ \t\n\r]*/y;

export function isJsonNumber(value: JsonValue | undefined): value is JsonNumber {
  return value instanceof JsonNumber;
}

export function isJsonObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof JsonNumber)
  );
}

export function parseJsonExact(text: string): JsonValue {
  if (text.length > MAX_JSON_LENGTH) throw new JsonSyntaxError('Response too large', 0);
  let i = 0;

  const skip = () => {
    WHITESPACE.lastIndex = i;
    WHITESPACE.exec(text);
    i = WHITESPACE.lastIndex;
  };
  const fail = (message: string): never => {
    throw new JsonSyntaxError(message, i);
  };

  const readString = (): string => {
    // text[i] === '"'
    i += 1;
    let out = '';
    for (;;) {
      if (i >= text.length) fail('Unterminated string');
      const c = text[i]!;
      if (c === '"') {
        i += 1;
        return out;
      }
      if (c === '\\') {
        const e = text[i + 1];
        const simple: Record<string, string> = {
          '"': '"',
          '\\': '\\',
          '/': '/',
          b: '\b',
          f: '\f',
          n: '\n',
          r: '\r',
          t: '\t',
        };
        if (e !== undefined && e in simple) {
          out += simple[e];
          i += 2;
        } else if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
          out += String.fromCharCode(Number.parseInt(text.slice(i + 2, i + 6), 16));
          i += 6;
        } else fail('Invalid escape');
        continue;
      }
      if (c < ' ') fail('Control character in string');
      out += c;
      i += 1;
    }
  };

  const readValue = (depth: number): JsonValue => {
    if (depth > MAX_DEPTH) fail('Nesting too deep');
    skip();
    const c = text[i];
    if (c === '{') {
      i += 1;
      const obj: { [key: string]: JsonValue } = {};
      skip();
      if (text[i] === '}') {
        i += 1;
        return obj;
      }
      for (;;) {
        skip();
        if (text[i] !== '"') fail('Expected key');
        const key = readString();
        skip();
        if (text[i] !== ':') fail('Expected ":"');
        i += 1;
        Object.defineProperty(obj, key, {
          value: readValue(depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
        skip();
        if (text[i] === ',') {
          i += 1;
          continue;
        }
        if (text[i] === '}') {
          i += 1;
          return obj;
        }
        fail('Expected "," or "}"');
      }
    }
    if (c === '[') {
      i += 1;
      const arr: JsonValue[] = [];
      skip();
      if (text[i] === ']') {
        i += 1;
        return arr;
      }
      for (;;) {
        arr.push(readValue(depth + 1));
        skip();
        if (text[i] === ',') {
          i += 1;
          continue;
        }
        if (text[i] === ']') {
          i += 1;
          return arr;
        }
        fail('Expected "," or "]"');
      }
    }
    if (c === '"') return readString();
    if (text.startsWith('true', i)) {
      i += 4;
      return true;
    }
    if (text.startsWith('false', i)) {
      i += 5;
      return false;
    }
    if (text.startsWith('null', i)) {
      i += 4;
      return null;
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (m) {
      i = NUMBER.lastIndex;
      return new JsonNumber(m[0]);
    }
    return fail('Unexpected token');
  };

  const value = readValue(0);
  skip();
  if (i !== text.length) fail('Unexpected trailing content');
  return value;
}
