// Port contract tests (G39, docs/architecture/target.md §5.1).
//
// A contract is a list of named cases written once against a port interface and
// run twice: against the in-memory fake the use-case tests rely on, and against
// the Supabase adapter on the local stack. The cases know nothing about the test
// framework; a runner maps each case to one `it(...)`. That keeps the contract a
// plain module of this package (no vitest import) that any adapter package can
// import, and keeps the fakes honest: a fake that drifts from the adapter fails
// the same case the adapter passes.

/** One behaviour a port implementation must exhibit. Throws `ContractViolation` on failure. */
export interface ContractCase<Ctx> {
  readonly name: string;
  run(ctx: Ctx): Promise<void>;
}
