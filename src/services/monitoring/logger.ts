/**
 * Logging and error-reporting facade.
 *
 * All app code logs through `logger` — never directly to console — so that:
 * 1. sensitive values are redacted before leaving the function;
 * 2. a crash-reporting backend (Sentry) can be plugged in via
 *    `setErrorReporter` without touching call sites.
 *
 * NEVER log passwords, tokens, or financial details (amounts, balances,
 * payees, notes, account names). Log ids and error codes instead.
 */

type LogContext = Record<string, unknown>;

export interface ErrorReporter {
  captureException(error: unknown, context?: LogContext): void;
  captureMessage(message: string, context?: LogContext): void;
  setUser(user: { id: string } | null): void;
}

const noopReporter: ErrorReporter = {
  captureException: () => undefined,
  captureMessage: () => undefined,
  setUser: () => undefined,
};

let reporter: ErrorReporter = noopReporter;

export function setErrorReporter(next: ErrorReporter): void {
  reporter = next;
}

/**
 * Keys whose values are always replaced, at any depth. A key is sensitive when
 * it ends with one of these (case-insensitive), so `baseAmountMinor`,
 * `accountName` and `refresh_token` are all caught. Errs on the side of
 * redacting too much.
 */
const SENSITIVE_KEYS = [
  'password',
  'token',
  'access_token',
  'refresh_token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'apikey',
  'secret',
  'code_verifier',
  'email',
  'amount',
  'amountminor',
  'amount_minor',
  'balance',
  'payee',
  'notes',
  'note',
  'name',
  'iban',
  'account_number',
];

const REDACTED = '[redacted]';
const MAX_DEPTH = 4;

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => k.endsWith(s));
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (typeof value === 'string') return redactString(value);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        isSensitiveKey(k) ? REDACTED : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}

/** Strips bearer tokens / JWTs and email addresses from free text. */
function redactString(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, `Bearer ${REDACTED}`)
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, REDACTED);
}

function devLog(level: 'debug' | 'info' | 'warn' | 'error', message: string, context?: LogContext) {
  if (!__DEV__ && (level === 'debug' || level === 'info')) return;
  const payload = context ? redact(context) : undefined;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log; // eslint-disable-line no-console
  if (payload === undefined) fn(`[${level}] ${message}`);
  else fn(`[${level}] ${message}`, payload);
}

export const logger = {
  debug: (message: string, context?: LogContext) => devLog('debug', message, context),
  info: (message: string, context?: LogContext) => devLog('info', message, context),
  warn: (message: string, context?: LogContext) => {
    devLog('warn', message, context);
    reporter.captureMessage(message, context ? (redact(context) as LogContext) : undefined);
  },
  error: (message: string, error?: unknown, context?: LogContext) => {
    devLog('error', message, { ...context, error });
    reporter.captureException(error ?? new Error(message), {
      message,
      ...(context ? (redact(context) as LogContext) : {}),
    });
  },
  setUser: (user: { id: string } | null) => reporter.setUser(user),
};
