// _shared/readEnv.ts — reads an environment variable for module-level configuration.
//
// Modules that read configuration while they load would make every test importing them
// need `--allow-env`; the CI runs the tests with `--allow-read` only. A variable that
// cannot be read is treated as unset, which is also what a deployed function without that
// secret sees.

/** The value of `name`, or `fallback` when it is unset or the runtime denies env access. */
export function readEnv(name: string, fallback = ''): string {
  try {
    return Deno.env.get(name) ?? fallback;
  } catch (error) {
    if (error instanceof Deno.errors.NotCapable || error instanceof Deno.errors.PermissionDenied) return fallback;
    throw error;
  }
}
