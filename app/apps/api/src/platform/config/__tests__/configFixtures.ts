import { ApiConfigError, loadApiConfig } from '../apiConfig';

/** The two required variables; every case adds or overrides on top of them. */
export const REQUIRED = {
  DATABASE_URL: 'postgresql://user:pass@db.internal:5432/kc',
  REDIS_URL: 'rediss://cache.internal:6379',
  KC_AUTH_ISSUER: 'https://auth.internal/auth/v1',
};

/** Runs the loader and returns the configuration error it must throw. */
export function configErrorOf(env: Record<string, string>): ApiConfigError {
  try {
    loadApiConfig({ ...REQUIRED, ...env });
  } catch (error) {
    if (error instanceof ApiConfigError) return error;
    throw error;
  }
  throw new Error('expected loadApiConfig to throw');
}
