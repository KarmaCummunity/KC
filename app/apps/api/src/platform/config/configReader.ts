// The pieces every configuration reader shares: the error, and reading one variable.

/** The process environment, or a stand-in for it in tests. */
export type Env = Readonly<Record<string, string | undefined>>;

/**
 * A configuration variable is missing or malformed.
 * The message names the variable and the rule, never the value: values of
 * later variables are secrets, and this message reaches the process log.
 */
export class ApiConfigError extends Error {
  constructor(
    readonly variable: string,
    reason: string,
  ) {
    super(`Invalid configuration: ${variable} ${reason}`);
    this.name = 'ApiConfigError';
  }
}

/** Reads a variable; blank counts as unset, so `PORT=` falls back to the default. */
export function readVariable(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === '' ? undefined : value;
}

/** Reads an optional whole number within a range. */
export function parseInteger(variable: string, value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ApiConfigError(variable, `must be an integer between ${min} and ${max}`);
  }
  return parsed;
}
