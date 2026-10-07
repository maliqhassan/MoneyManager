import { z } from 'zod';

/**
 * Typed, validated runtime configuration.
 *
 * Expo inlines EXPO_PUBLIC_* variables at build time, and only when they are
 * referenced statically as `process.env.EXPO_PUBLIC_NAME` — do not access them
 * dynamically. Every value here ships inside the app bundle: never add secrets.
 */

const APP_ENVS = ['development', 'preview', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const envSchema = z.object({
  appEnv: z.enum(APP_ENVS).default('development'),
  supabaseUrl: z.url({ message: 'EXPO_PUBLIC_SUPABASE_URL must be a valid URL' }),
  supabasePublishableKey: z
    .string()
    .min(20, { message: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing or malformed' }),
  sentryDsn: z
    .string()
    .optional()
    .transform((v) => (v ? v : null)),
});

export type Env = z.infer<typeof envSchema>;

export type EnvResult = { ok: true; env: Env } | { ok: false; issues: string[] };

const PLACEHOLDER_VALUES = new Set([
  'https://your-project-ref.supabase.co',
  'your-publishable-key',
]);

function readEnv(): EnvResult {
  const raw = {
    appEnv: process.env.EXPO_PUBLIC_APP_ENV || undefined,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  };

  const issues: string[] = [];
  if (raw.supabaseUrl && PLACEHOLDER_VALUES.has(raw.supabaseUrl)) {
    issues.push('EXPO_PUBLIC_SUPABASE_URL still contains the .env.example placeholder');
  }
  if (raw.supabasePublishableKey && PLACEHOLDER_VALUES.has(raw.supabasePublishableKey)) {
    issues.push('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY still contains the .env.example placeholder');
  }

  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    issues.push(...parsed.error.issues.map((i) => i.message));
  }
  if (issues.length > 0 || !parsed.success) return { ok: false, issues };
  return { ok: true, env: parsed.data };
}

/** Evaluated once at startup. The root layout renders a config error screen if invalid. */
export const envResult: EnvResult = readEnv();

/**
 * Returns the validated environment or throws. Only call from code that runs
 * after the root layout has confirmed `envResult.ok`.
 */
export function getEnv(): Env {
  if (!envResult.ok) {
    throw new Error(`Invalid environment configuration: ${envResult.issues.join('; ')}`);
  }
  return envResult.env;
}

export const isDev = __DEV__;
