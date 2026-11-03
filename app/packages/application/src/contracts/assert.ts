// Framework-agnostic assertions for contract cases (G39). Each failure throws a
// `ContractViolation` whose message names the behaviour, so the runner's report
// reads the same for the fake and for the adapter.

export class ContractViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractViolation';
  }
}

function show(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function assertTrue(condition: boolean, what: string): void {
  if (!condition) throw new ContractViolation(what);
}

export function assertEqual<T>(actual: T, expected: T, what: string): void {
  if (actual !== expected) {
    throw new ContractViolation(`${what}: expected ${show(expected)}, got ${show(actual)}`);
  }
}

/** Order-sensitive comparison of two arrays of primitives (ids, statuses). */
export function assertSameList<T>(actual: readonly T[], expected: readonly T[], what: string): void {
  const same = actual.length === expected.length && actual.every((v, i) => v === expected[i]);
  if (!same) throw new ContractViolation(`${what}: expected ${show(expected)}, got ${show(actual)}`);
}

export function assertDefined<T>(value: T | null | undefined, what: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new ContractViolation(`${what}: expected a value, got ${show(value)}`);
  }
}

/** The promise must reject; used where the port surfaces a refusal without a typed code (RLS, FK). */
export async function assertRejects(promise: Promise<unknown>, what: string): Promise<void> {
  let rejected = false;
  try {
    await promise;
  } catch {
    rejected = true;
  }
  if (!rejected) throw new ContractViolation(`${what}: expected a rejection, but it resolved`);
}

/** The promise must reject with an error carrying `code` (the port's typed error class). */
export async function assertRejectsWithCode(
  promise: Promise<unknown>,
  code: string,
  what: string,
): Promise<void> {
  let thrown: unknown;
  let rejected = false;
  try {
    await promise;
  } catch (error) {
    thrown = error;
    rejected = true;
  }
  if (!rejected) throw new ContractViolation(`${what}: expected rejection with code ${code}, but it resolved`);
  const actual = (thrown as { code?: unknown } | null)?.code;
  if (actual !== code) {
    throw new ContractViolation(`${what}: expected code ${code}, got ${show(actual)} (${show(thrown)})`);
  }
}
