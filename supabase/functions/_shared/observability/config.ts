// _shared/observability/config.ts
// Reporter configuration from the Edge Function environment (G41). Secrets are
// referenced by name only; the deploy workflows set them per Supabase project:
//   SENTRY_DSN          — Sentry project DSN (absent → log-only mode)
//   SENTRY_ENVIRONMENT  — `prod` | `dev`; derived from SUPABASE_URL when unset
//   SENTRY_RELEASE      — e.g. `functions@<git sha>`; optional
// SB_REGION / SB_EXECUTION_ID are provided by the Supabase Edge Runtime.

import type { ReporterConfig } from './reporter.ts';

export type EnvReader = (key: string) => string | undefined;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'kong']);

/**
 * Environment name when `SENTRY_ENVIRONMENT` is not set: `local` for a local stack,
 * the project ref for a hosted project (unambiguous, no refs hard-coded in code).
 */
export function deriveEnvironment(supabaseUrl: string | undefined): string {
  if (!supabaseUrl) return 'unknown';
  try {
    const host = new URL(supabaseUrl).hostname;
    if (LOCAL_HOSTS.has(host) || host.endsWith('.kong')) return 'local';
    const [ref] = host.split('.');
    return ref || 'unknown';
  } catch {
    return 'unknown';
  }
}

function pick(env: EnvReader, key: string): string | undefined {
  const value = env(key)?.trim();
  return value ? value : undefined;
}

/** Builds the reporter config from `env`; defaults to `Deno.env.get`. */
export function configFromEnv(env: EnvReader = (k) => Deno.env.get(k)): ReporterConfig {
  const tags: Record<string, string> = { runtime: 'deno' };
  const region = pick(env, 'SB_REGION');
  const executionId = pick(env, 'SB_EXECUTION_ID');
  if (region) tags.region = region;
  if (executionId) tags.execution_id = executionId;
  return {
    dsn: pick(env, 'SENTRY_DSN'),
    environment: pick(env, 'SENTRY_ENVIRONMENT') ?? deriveEnvironment(pick(env, 'SUPABASE_URL')),
    release: pick(env, 'SENTRY_RELEASE'),
    tags,
  };
}
