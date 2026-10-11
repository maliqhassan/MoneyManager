/**
 * Application error model.
 *
 * Internal errors (stack traces, SQL, HTTP bodies) are never shown to users.
 * Every error is normalised into an AppError with a stable `code`; the UI maps
 * codes to translated, user-friendly messages via `errors.<code>` i18n keys.
 */

export const ERROR_CODES = [
  'network',
  'offline',
  'timeout',
  'unauthorized',
  'forbidden',
  'not_found',
  'validation',
  'conflict',
  'rate_limited',
  'storage',
  'config',
  'server_not_ready',
  'auth_invalid_credentials',
  'auth_email_not_confirmed',
  'auth_email_taken',
  'auth_weak_password',
  'auth_cancelled',
  'unknown',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  readonly code: ErrorCode;
  /** True when retrying the same operation may succeed (network blips, 5xx). */
  readonly retryable: boolean;
  /** Field-level validation messages (i18n keys), when applicable. */
  readonly fieldErrors?: Readonly<Record<string, string>>;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      cause?: unknown;
      retryable?: boolean;
      fieldErrors?: Record<string, string>;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.retryable = options.retryable ?? (code === 'network' || code === 'timeout');
    if (options.fieldErrors) this.fieldErrors = options.fieldErrors;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
}

function asErrorLike(error: unknown): ErrorLike {
  return typeof error === 'object' && error !== null ? (error as ErrorLike) : {};
}

/**
 * The server is reachable but its schema is missing what the app needs
 * (table, column or function not deployed yet — e.g. migrations not applied).
 * Not caused by the record being sent, so sync stops instead of giving up on
 * that record. PostgREST: PGRST202/204/205; Postgres: 42P01/42703/42883/3F000.
 */
const SCHEMA_MISSING_CODES = new Set([
  'PGRST202',
  'PGRST204',
  'PGRST205',
  '42P01',
  '42703',
  '42883',
  '3F000',
]);

const AUTH_ERROR_CODES: Record<string, ErrorCode> = {
  invalid_credentials: 'auth_invalid_credentials',
  email_not_confirmed: 'auth_email_not_confirmed',
  user_already_exists: 'auth_email_taken',
  email_exists: 'auth_email_taken',
  weak_password: 'auth_weak_password',
  over_request_rate_limit: 'rate_limited',
  over_email_send_rate_limit: 'rate_limited',
};

/**
 * Converts anything thrown (Supabase/PostgREST errors, fetch failures, Zod
 * errors, plain Errors) into an AppError. Original error kept as `cause`
 * for diagnostics; never surfaced to the user.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  const e = asErrorLike(error);
  const name = typeof e.name === 'string' ? e.name : '';
  const code = typeof e.code === 'string' ? e.code : '';
  const status = typeof e.status === 'number' ? e.status : undefined;
  const message = typeof e.message === 'string' ? e.message : 'Unknown error';

  if (
    name === 'AuthRetryableFetchError' ||
    (error instanceof TypeError && /network/i.test(message))
  ) {
    return new AppError('network', 'Network request failed', { cause: error, retryable: true });
  }
  if (name === 'ZodError') return new AppError('validation', 'Validation failed', { cause: error });
  if (SCHEMA_MISSING_CODES.has(code)) {
    return new AppError('server_not_ready', message, { cause: error, retryable: true });
  }
  const authCode = AUTH_ERROR_CODES[code];
  if (authCode) return new AppError(authCode, message, { cause: error });
  if (code === '23505' || status === 409)
    return new AppError('conflict', message, { cause: error });
  if (code === '42501' || status === 403)
    return new AppError('forbidden', message, { cause: error });
  if (status === 401) return new AppError('unauthorized', message, { cause: error });
  if (status === 404 || code === 'PGRST116') {
    return new AppError('not_found', message, { cause: error });
  }
  if (status === 429)
    return new AppError('rate_limited', message, { cause: error, retryable: true });
  if (code.startsWith('22') || code.startsWith('23') || status === 400 || status === 422) {
    return new AppError('validation', message, { cause: error });
  }
  if (status !== undefined && status >= 500) {
    return new AppError('network', message, { cause: error, retryable: true });
  }
  return new AppError('unknown', message, { cause: error });
}

/** i18n key for a user-facing message describing this error. */
export function errorMessageKey(error: unknown): `errors.${ErrorCode}` {
  return `errors.${toAppError(error).code}`;
}
