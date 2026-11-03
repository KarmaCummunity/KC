import { assertEquals } from 'jsr:@std/assert@1';
import { configFromEnv, deriveEnvironment } from './config.ts';

const envOf = (vars: Record<string, string | undefined>) => (key: string) => vars[key];

Deno.test('deriveEnvironment: local stack → local, hosted project → its ref, garbage → unknown', () => {
  assertEquals(deriveEnvironment('http://127.0.0.1:54321'), 'local');
  assertEquals(deriveEnvironment('http://kong:8000'), 'local');
  assertEquals(deriveEnvironment('https://enbqriuxvvuontiwslun.supabase.co'), 'enbqriuxvvuontiwslun');
  assertEquals(deriveEnvironment(undefined), 'unknown');
  assertEquals(deriveEnvironment('not-a-url'), 'unknown');
});

Deno.test('configFromEnv: explicit SENTRY_* values win; runtime tags only when the platform sets them', () => {
  const cfg = configFromEnv(envOf({
    SENTRY_DSN: ' https://k@host/1 ',
    SENTRY_ENVIRONMENT: 'prod',
    SENTRY_RELEASE: 'functions@abc',
    SUPABASE_URL: 'https://kdqtbdbzwvlugkhonexg.supabase.co',
    SB_REGION: 'eu-west-1',
    SB_EXECUTION_ID: 'exec-1',
  }));
  assertEquals(cfg, {
    dsn: 'https://k@host/1',
    environment: 'prod',
    release: 'functions@abc',
    tags: { runtime: 'deno', region: 'eu-west-1', execution_id: 'exec-1' },
  });
});

Deno.test('configFromEnv: nothing set → log-only mode with the environment derived from SUPABASE_URL', () => {
  const cfg = configFromEnv(envOf({ SUPABASE_URL: 'http://localhost:54321', SENTRY_DSN: '' }));
  assertEquals(cfg, { dsn: undefined, environment: 'local', release: undefined, tags: { runtime: 'deno' } });
});
